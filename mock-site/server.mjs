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

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const path = url.pathname;

  if (req.method === "GET" && path === "/") {
    res.writeHead(302, { Location: "/login" });
    res.end();
    return;
  }

  if (req.method === "GET" && path === "/login") return serveStatic(res, "login.html");
  if (req.method === "GET" && path === "/form") return serveStatic(res, "form.html");
  if (req.method === "GET" && path === "/details") return serveStatic(res, "details.html");
  if (req.method === "GET" && (path === "/styles.css")) return serveStatic(res, "styles.css");
  if (req.method === "GET" && path === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
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
