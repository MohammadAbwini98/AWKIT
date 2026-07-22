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
 * Status codes `/api/status` is allowed to return. Allow-listed so the endpoint stays deterministic
 * and can never be turned into an open redirect (3xx is intentionally excluded — `/login` and
 * `/submit` already cover the redirect path).
 */
const ALLOWED_STATUS_CODES = new Set([200, 201, 202, 204, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504]);

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

function sendJson(res, body) {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const path = url.pathname;

  if (req.method === "GET" && path === "/") return serveStatic(res, "index.html");

  if (req.method === "GET" && path === "/login") return serveStatic(res, "login.html");
  if (req.method === "GET" && path === "/form") return serveStatic(res, "form.html");
  if (req.method === "GET" && path === "/details") return serveStatic(res, "details.html");
  if (req.method === "GET" && path === "/smart-waits") return serveStatic(res, "smart-waits.html");
  if (req.method === "GET" && path === "/recorder-lab") return serveStatic(res, "recorder-lab.html");
  if (req.method === "GET" && path === "/designer-lab") return serveStatic(res, "designer-lab.html");
  if (req.method === "GET" && path === "/async-results") return serveStatic(res, "async-results.html");
  // ── Multi-Window / Popup Lab ───────────────────────────────────────────────
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
