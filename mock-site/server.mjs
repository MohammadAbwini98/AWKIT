// Offline mock test website for AWTKIT / Playwright Flow Studio.
// Pure Node.js http server (no dependencies) so it runs in the offline package.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "public");
const port = Number(process.env.MOCK_SITE_PORT ?? 4321);

/** In-memory submission store: submissionId -> field values. */
const submissions = new Map();
let counter = 1000;

/**
 * REC-018 replay oracle. The Recorder lab posts only its fixed synthetic values here when the
 * `?rec018=1` scenario's Save button is clicked. The focused verifier resets this state after
 * capture, so a subsequent submission can only come from the production replay (the page harness
 * is deliberately inert without the Recorder binding).
 */
let rec018Submissions = [];

/**
 * Status codes `/api/status` is allowed to return. Allow-listed so the endpoint stays deterministic
 * and can never be turned into an open redirect (3xx is intentionally excluded — `/login` and
 * `/submit` already cover the redirect path).
 */
const ALLOWED_STATUS_CODES = new Set([200, 201, 202, 204, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504]);

/** Per-id poll counters for `/api/job` (202 → poll-to-terminal, awkit-4km C1). */
const jobPolls = new Map();

/** Fixed rows for the populated branch of `/api/results` (stable values for assertions). */
const RESULT_ROWS = [
  { id: "INV-1001", customer: "Acme Ltd", amount: "120.00", status: "Paid" },
  { id: "INV-1002", customer: "Globex", amount: "84.50", status: "Pending" },
  { id: "INV-1003", customer: "Initech", amount: "310.75", status: "Paid" }
];

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function parseBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      const params = new URLSearchParams(raw);
      const values = {};
      for (const [key, value] of params.entries()) values[key] = value;
      resolve(values);
    });
  });
}

async function serveStatic(res, fileName) {
  try {
    const filePath = join(publicDir, fileName);
    const body = await readFile(filePath);
    res.writeHead(200, { "Content-Type": mime[extname(filePath)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}

function renderSuccess(submission) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Submission successful</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main class="card">
      <h1 id="successMessage">Submission successful</h1>
      <dl class="result">
        <dt>Submission ID</dt><dd id="submissionId">${escapeHtml(submission.id)}</dd>
        <dt>First name</dt><dd id="submittedFirstName">${escapeHtml(submission.firstName)}</dd>
        <dt>Last name</dt><dd id="submittedLastName">${escapeHtml(submission.lastName)}</dd>
        <dt>Email</dt><dd id="submittedEmail">${escapeHtml(submission.email)}</dd>
        <dt>Country</dt><dd id="submittedCountry">${escapeHtml(submission.country)}</dd>
        <dt>Account type</dt><dd id="submittedAccountType">${escapeHtml(submission.accountType)}</dd>
      </dl>
      <a id="backToForm" href="/form">Submit another</a>
    </main>
  </body>
</html>`;
}

function sendJson(res, body, status = 200, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
}

/** Raw request body as a Buffer. Needed for multipart, which is not text-safe. */
function readRawBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 5_000_000) {
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

/**
 * Minimal `multipart/form-data` parser — Node built-ins only, per the offline rule.
 * Handles exactly what the upload fixture needs: simple fields plus one file part. Not a
 * general-purpose parser (no nested multipart, no base64 transfer-encoding).
 */
function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? "");
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary) return { fields: {}, files: [] };

  const delimiter = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = [];

  let start = buffer.indexOf(delimiter);
  while (start !== -1) {
    const partStart = start + delimiter.length;
    // `--` immediately after the delimiter marks the closing boundary.
    if (buffer.slice(partStart, partStart + 2).toString() === "--") break;

    const next = buffer.indexOf(delimiter, partStart);
    if (next === -1) break;

    const part = buffer.slice(partStart, next);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headers = part.slice(0, headerEnd).toString("utf8");
      // Strip the CRLF that precedes the next delimiter.
      const content = part.slice(headerEnd + 4, part.length - 2);
      const nameMatch = /name="([^"]*)"/i.exec(headers);
      const fileMatch = /filename="([^"]*)"/i.exec(headers);
      const name = nameMatch?.[1] ?? "";
      if (fileMatch) {
        files.push({ field: name, filename: fileMatch[1], size: content.length, text: content.toString("utf8") });
      } else if (name) {
        fields[name] = content.toString("utf8");
      }
    }
    start = next;
  }

  return { fields, files };
}

/** Downloadable fixture bodies, keyed by the `type` query parameter. */
const DOWNLOAD_FIXTURES = {
  csv: {
    filename: "awkit-report.csv",
    contentType: "text/csv; charset=utf-8",
    body: "id,name,status\n1,lab-alpha,passed\n2,lab-bravo,failed\n3,lab-charlie,passed\n"
  },
  txt: {
    filename: "awkit-notes.txt",
    contentType: "text/plain; charset=utf-8",
    body: "AWKIT mock download fixture.\nDeterministic content for downloadFile verification.\n"
  },
  json: {
    filename: "awkit-payload.json",
    contentType: "application/json; charset=utf-8",
    body: `${JSON.stringify({ ok: true, rows: [{ id: 1, name: "lab-alpha" }], source: "mock-site" }, null, 2)}\n`
  }
};

/**
 * Per-key call counters for `/api/flaky`, so a scenario can fail N times and then succeed.
 * Deterministic and resettable — never random.
 */
const flakyCalls = new Map();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const path = url.pathname;

  if (req.method === "GET" && path === "/") return serveStatic(res, "index.html");

  if (req.method === "GET" && path === "/login") return serveStatic(res, "login.html");
  if (req.method === "GET" && path === "/form") return serveStatic(res, "form.html");
  if (req.method === "GET" && path === "/details") return serveStatic(res, "details.html");
  if (req.method === "GET" && path === "/smart-waits") return serveStatic(res, "smart-waits.html");
  if (req.method === "GET" && path.startsWith("/smart-waits/shorts/")) return serveStatic(res, "smart-waits.html");
  if (req.method === "GET" && path === "/recorder-lab") return serveStatic(res, "recorder-lab.html");
  if (req.method === "GET" && path === "/blueprint-recovery-lab") return serveStatic(res, "blueprint-recovery-lab.html");
  if (req.method === "GET" && path === "/shadow-frame-child") return serveStatic(res, "shadow-frame-child.html");
  if (req.method === "GET" && path === "/recorder-sensitive") return serveStatic(res, "recorder-sensitive.html");
  if (req.method === "GET" && path === "/designer-lab") return serveStatic(res, "designer-lab.html");
  if (req.method === "GET" && path === "/async-results") return serveStatic(res, "async-results.html");
  if (req.method === "GET" && path === "/dialog-lab") return serveStatic(res, "dialog-lab.html");
  if (req.method === "GET" && path === "/storage-lab") return serveStatic(res, "storage-lab.html");
  // ── Recorder Navigation Lab ────────────────────────────────────────────────
  /**
   * A server redirect whose destination is a hardcoded constant — nothing from the request reaches
   * `Location`, so this can never become an open redirect (same shape as the popup lab's J2 hop).
   * The Recorder must record the FINAL url and never the intermediate one.
   *
   * MUST stay ahead of the two static handlers below, which would otherwise try to serve a file
   * named `redirect` and 404 before this is reached.
   */
  if (req.method === "GET" && path === "/navigation-lab/redirect") {
    res.writeHead(302, { Location: "/navigation-lab/arrived?via=redirect" });
    res.end();
    return;
  }
  if (req.method === "GET" && path === "/navigation-lab/arrived") return serveStatic(res, "navigation-lab-arrived.html");
  // SPA routes pushed by the lab's own script (`/navigation-lab/route-a`, `route-b`) must still
  // serve the lab on a reload, or the reload check would land on a 404 instead of the same URL.
  if (req.method === "GET" && (path === "/navigation-lab" || path.startsWith("/navigation-lab/route"))) {
    return serveStatic(res, "navigation-lab.html");
  }
  // ── Multi-Window / Popup Lab ───────────────────────────────────────────────
  /**
   * Scenario J2: a popup that redirects once BEFORE the user can interact with it. The destination
   * is a hardcoded constant — nothing from the request reaches `Location`, so this can never become
   * an open redirect (same shape as the fixed `/login` → `/form` hop). The Recorder must treat the
   * FINAL url as the popup's identity, never this intermediate hop.
   *
   * MUST stay ahead of the `/popup` and `/mock/popup` static handlers below: they map any
   * `/popup/*` path straight to a file and would 404 this route before it is ever reached.
   */
  if (req.method === "GET" && (path === "/popup/redirect-entry.html" || path === "/mock/popup/redirect-entry.html")) {
    res.writeHead(302, { Location: "/popup/redirect-final.html" });
    res.end();
    return;
  }
  if (req.method === "GET" && path.startsWith("/mock/popup")) {
    let file = path.slice("/mock/popup".length);
    if (!file || file === "/") file = "/index.html";
    if (!file.endsWith(".html") && !file.includes(".")) file += ".html";
    return serveStatic(res, `popup${file}`);
  }
  if (req.method === "GET" && path.startsWith("/popup")) {
    let file = path.slice("/popup".length);
    if (!file || file === "/") file = "/index.html";
    if (!file.endsWith(".html") && !file.includes(".")) file += ".html";
    return serveStatic(res, `popup${file}`);
  }
  // ── Secure Login / Protected Popup Lab ─────────────────────────────────────
  // Protected login + protected popup + session-reuse scenarios for the Recorder secure-login
  // manual Chrome handoff. Served from `public/secure-login/<name>.html` (stable, offline-only).
  // Placed after the /mock/popup handler so it never swallows the popup lab routes.
  if (req.method === "GET" && path.startsWith("/mock/")) {
    const name = path.slice("/mock/".length).replace(/[^a-zA-Z0-9-]/g, "");
    if (name) return serveStatic(res, `secure-login/${name}.html`);
  }
  if (req.method === "GET" && (path === "/styles.css")) return serveStatic(res, "styles.css");
  if (req.method === "GET" && path === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && path === "/runner-lab") return serveStatic(res, "runner-lab.html");
  if (req.method === "GET" && path === "/iframe-lab") return serveStatic(res, "iframe-lab.html");
  if (req.method === "GET" && path === "/iframe-child") return serveStatic(res, "iframe-child.html");
  // Nested frame chain (main → outer → inner → leaf) for the guaranteed-unique frame-chain feature.
  if (req.method === "GET" && path === "/iframe-nested") return serveStatic(res, "iframe-nested.html");
  if (req.method === "GET" && path === "/iframe-nested-mid") return serveStatic(res, "iframe-nested-mid.html");
  if (req.method === "GET" && path === "/iframe-nested-leaf") return serveStatic(res, "iframe-nested-leaf.html");
  // Instrumented closed-shadow feature lab (Phase C2).
  if (req.method === "GET" && path === "/closed-shadow-lab") return serveStatic(res, "closed-shadow-lab.html");

  // Drag-and-drop feature lab (native HTML5 DnD → `drag` step capture + replay).
  if (req.method === "GET" && path === "/drag-lab") return serveStatic(res, "drag-lab.html");

  // ── REC-018 record → save → replay oracle ─────────────────────────────────
  // Local, in-memory and resettable. It records only the deterministic synthetic Recorder-lab
  // fields; no credentials, cookies, headers, or browser/session state are accepted or returned.
  if (req.method === "GET" && path === "/api/rec018/state") {
    return sendJson(res, {
      ok: true,
      count: rec018Submissions.length,
      latest: rec018Submissions.at(-1) ?? null
    });
  }

  if (req.method === "POST" && path === "/api/rec018/reset") {
    rec018Submissions = [];
    return sendJson(res, { ok: true, count: 0 });
  }

  if (req.method === "POST" && path === "/api/rec018/submit") {
    const values = await parseBody(req);
    const submission = {
      fullName: String(values.fullName ?? "").slice(0, 100),
      email: String(values.email ?? "").slice(0, 160),
      plan: String(values.plan ?? "").slice(0, 40),
      newsletter: values.newsletter === "true"
    };
    rec018Submissions.push(submission);
    if (rec018Submissions.length > 20) rec018Submissions = rec018Submissions.slice(-20);
    return sendJson(res, { ok: true, count: rec018Submissions.length, latest: submission });
  }

  // REC-007 — accepts a secret-shaped POST so the Recorder's network observer has a real signal to
  // classify. The values are COUNTED and discarded: nothing is stored, logged, or echoed back, so
  // the fixture itself can never become the place a canary leaks from.
  if (req.method === "POST" && path === "/api/recorder/sensitive") {
    let received = 0;
    try {
      const parsed = JSON.parse((await readRawBody(req)).toString("utf8"));
      received = parsed && typeof parsed === "object" ? Object.keys(parsed).length : 0;
    } catch {
      received = 0;
    }
    return sendJson(res, { ok: true, receivedFields: received });
  }

  // ── Download fixture (Content-Disposition) ─────────────────────────────────
  // Gives `downloadFile` steps a real download event to capture. Deterministic bodies.
  if (req.method === "GET" && path === "/api/download") {
    const fixture = DOWNLOAD_FIXTURES[url.searchParams.get("type") ?? "csv"] ?? DOWNLOAD_FIXTURES.csv;
    res.writeHead(200, {
      "Content-Type": fixture.contentType,
      "Content-Disposition": `attachment; filename="${fixture.filename}"`,
      "Content-Length": Buffer.byteLength(fixture.body)
    });
    res.end(fixture.body);
    return;
  }

  // ── Controlled HTTP failures ───────────────────────────────────────────────
  // Fixed status on demand, with Retry-After where the status calls for it.
  if (req.method === "GET" && path === "/api/http-status") {
    const requested = Number(url.searchParams.get("code") ?? 500);
    const code = [400, 401, 403, 404, 409, 422, 429, 500, 502, 503].includes(requested) ? requested : 500;
    const retryAfter = url.searchParams.get("retryAfter");
    const headers = {};
    if (code === 429 || code === 503) headers["Retry-After"] = String(retryAfter ?? 1);
    return sendJson(res, { ok: false, status: code, message: `Mock failure with status ${code}` }, code, headers);
  }

  // Fails a bounded number of times per key, then succeeds — the retry-policy fixture.
  if (req.method === "GET" && path === "/api/flaky") {
    const key = (url.searchParams.get("key") ?? "default").slice(0, 40);
    const failures = Math.max(0, Math.min(Number(url.searchParams.get("failures") ?? 1) || 0, 5));
    const seen = (flakyCalls.get(key) ?? 0) + 1;
    flakyCalls.set(key, seen);
    if (seen <= failures) {
      return sendJson(
        res,
        { ok: false, attempt: seen, remainingFailures: failures - seen, message: `Attempt ${seen} fails by design` },
        503,
        { "Retry-After": "1" }
      );
    }
    return sendJson(res, { ok: true, attempt: seen, message: `Attempt ${seen} succeeded after ${failures} failure(s)` });
  }

  if (req.method === "GET" && path === "/api/flaky/reset") {
    const key = url.searchParams.get("key");
    if (key) flakyCalls.delete(key.slice(0, 40));
    else flakyCalls.clear();
    return sendJson(res, { ok: true, reset: key ?? "all" });
  }

  // ── Multipart upload ───────────────────────────────────────────────────────
  if (req.method === "POST" && path === "/api/upload") {
    const raw = await readRawBody(req);
    const { fields, files } = parseMultipart(raw, req.headers["content-type"]);
    const file = files[0];
    if (!file || !file.filename) {
      return sendJson(res, { ok: false, message: "No file part was received" }, 400);
    }
    return sendJson(res, {
      ok: true,
      filename: file.filename,
      size: file.size,
      // Echoed so an assertion can prove the file content survived the round trip.
      preview: file.text.slice(0, 120),
      note: fields.note ?? ""
    });
  }

  if (req.method === "GET" && path === "/api/delay") {
    const requested = Number(url.searchParams.get("ms") ?? 300);
    const delayMs = Math.max(0, Math.min(Number.isFinite(requested) ? requested : 300, 3000));
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return sendJson(res, { ok: true, delayMs, message: "Delayed mock response complete" });
  }

  // Deterministic HTTP status control. Lets the runner prove it distinguishes "the API answered with
  // an error status" from "the response never arrived" — an immediate 500 must be reported as a
  // status failure, never as a wait timeout.
  if (req.method === "GET" && path === "/api/status") {
    const requestedCode = Number(url.searchParams.get("code") ?? 500);
    const code = ALLOWED_STATUS_CODES.has(requestedCode) ? requestedCode : 500;
    const requestedMs = Number(url.searchParams.get("ms") ?? 0);
    const delayMs = Math.max(0, Math.min(Number.isFinite(requestedMs) ? requestedMs : 0, 3000));
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
    // 204 must not carry a body.
    res.end(code === 204 ? undefined : JSON.stringify({ ok: code < 400, status: code, delayMs, message: `Mock endpoint returned HTTP ${code}` }));
    return;
  }

  // Populated vs VALID-EMPTY result sets. Both are HTTP 200 successes: the difference is the UI
  // outcome, which is what an empty-state completion contract has to distinguish.
  if (req.method === "GET" && path === "/api/results") {
    const mode = url.searchParams.get("mode") === "empty" ? "empty" : "populated";
    const requestedMs = Number(url.searchParams.get("ms") ?? 300);
    const delayMs = Math.max(0, Math.min(Number.isFinite(requestedMs) ? requestedMs : 300, 3000));
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const rows = mode === "empty" ? [] : RESULT_ROWS;
    return sendJson(res, { ok: true, mode, count: rows.length, rows });
  }

  // Finite SSE lifecycle fixture (awkit-4km C2). It emits one deterministic status event and ends;
  // the UI outcome remains the completion signal while the stream is supporting diagnostic evidence.
  if (req.method === "GET" && path === "/api/events") {
    const requestedMs = Number(url.searchParams.get("ms") ?? 100);
    const delayMs = Math.max(0, Math.min(Number.isFinite(requestedMs) ? requestedMs : 100, 3000));
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    res.end(`id: awkit-4km-1\nevent: status\ndata: ${JSON.stringify({ state: "complete" })}\n\n`);
    return;
  }

  // 202 → poll-to-terminal job (awkit-4km C1). Deterministic + repeatable: the first `after` polls
  // for an id return HTTP 202 `{status:"processing"}`; the next returns HTTP 200 `{status:"succeeded"}`
  // and resets the counter. Lets the runner prove it keeps polling past 202 and completes on the
  // terminal status/field (never treating an in-progress 202 as done).
  if (req.method === "GET" && path === "/api/job") {
    const id = (url.searchParams.get("id") ?? "default").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "default";
    const requestedAfter = Number(url.searchParams.get("after") ?? 2);
    const after = Math.max(0, Math.min(Number.isFinite(requestedAfter) ? requestedAfter : 2, 20));
    const n = (jobPolls.get(id) ?? 0) + 1;
    if (n <= after) {
      jobPolls.set(id, n);
      res.writeHead(202, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ status: "processing", poll: n }));
      return;
    }
    jobPolls.delete(id); // reset so the scenario is repeatable
    return sendJson(res, { status: "succeeded", poll: n, result: "done" });
  }

  if (req.method === "POST" && path === "/login") {
    const body = await parseBody(req);
    if (body.username && body.password) {
      res.writeHead(303, { Location: "/form" });
      res.end();
    } else {
      res.writeHead(303, { Location: "/login?error=1" });
      res.end();
    }
    return;
  }

  if (req.method === "POST" && path === "/submit") {
    const body = await parseBody(req);
    const id = `SUB-${(counter += 1)}`;
    const submission = { id, ...body };
    submissions.set(id, submission);
    res.writeHead(303, { Location: `/success?id=${encodeURIComponent(id)}` });
    res.end();
    return;
  }

  if (req.method === "GET" && path === "/success") {
    const id = url.searchParams.get("id") ?? "";
    const submission = submissions.get(id) ?? { id, firstName: "", lastName: "", email: "", country: "", accountType: "" };
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderSuccess(submission));
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Mock test site running at http://localhost:${port}/login`);
});
