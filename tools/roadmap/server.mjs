/**
 * AWKIT Program Status & Roadmap dashboard — local server.
 *
 * Pure node:http with zero dependencies, following mock-site/server.mjs so that it runs in the
 * offline environment and adds nothing to the shipped app. This tool lives under tools/ and is
 * never packaged: see README.md.
 *
 * Security posture — these are requirements, not preferences:
 *   - binds 127.0.0.1 only. The payload includes unfixed security findings from the issue tracker.
 *   - routes are an explicit allowlist. No path is ever joined from request input, so path
 *     traversal is impossible by construction rather than by validation.
 *   - repository data remains read-only. The sole mutation endpoint starts the repository's exact
 *     portable packaging script; the browser cannot supply a command, arguments, path, or env.
 *
 * Liveness is a stat() fingerprint poll rather than fs.watch: on Windows, editors and `bd` write
 * via temp-file + rename, which silently detaches a file-bound watch handle. A dashboard that has
 * stopped updating while still claiming to be live is the worst available outcome.
 */

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { spawn } from "node:child_process";

import { buildSnapshot } from "./lib/model.mjs";
import { clearReadCache, contentHash, fingerprintSources } from "./lib/read-cache.mjs";
import { ASSIGNMENTS_PATH, REPO_ROOT, ROADMAP_ROOT, WATCHED_SOURCE_IDS, sourcePath } from "./lib/sources.mjs";

const PORT = Number(process.env.ROADMAP_PORT ?? 4380);
const HOST = "127.0.0.1";
const POLL_MS = Number(process.env.ROADMAP_POLL_MS ?? 1500);
const KEEPALIVE_MS = 20_000;
const PORTABLE_ACTION_HEADER = "package-portable";
const RELEASE_VERSION_POLICY = "patch";
const PACKAGE_SCRIPT = join(REPO_ROOT, "scripts", "release-portable.ps1");

/** Static files this server will serve, by exact request path. */
const STATIC_ROUTES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/dashboard.css", "dashboard.css"],
  ["/dashboard.js", "dashboard.js"],
  ["/dom.js", "dom.js"],
  ["/icons.js", "icons.js"],
  ["/views.js", "views.js"],
  ["/graph.js", "graph.js"]
]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

/**
 * Sources cheap enough to content-hash on every poll. OneDrive can rewrite a file with an
 * unchanged mtime and size, which the fingerprint alone would miss.
 */
const HOT_SOURCES = ["beads", "ledger"];

/** @type {{fingerprint: string, snapshot: Record<string, unknown>, json: string, etag: string}|null} */
let cached = null;
/** @type {Set<import("node:http").ServerResponse>} */
const sseClients = new Set();
/** @type {{state: "idle"|"running"|"succeeded"|"failed", versionPolicy: "patch", startedAt: string|null, finishedAt: string|null, exitCode: number|null, artifact: string|null, errorCode: string|null}} */
let portableBuild = {
  state: "idle",
  versionPolicy: RELEASE_VERSION_POLICY,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  artifact: null,
  errorCode: null
};
/** @type {() => import("node:child_process").ChildProcess} */
let spawnPortableProcess = () =>
  spawn(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      PACKAGE_SCRIPT,
      "-BumpType",
      RELEASE_VERSION_POLICY,
      "-Force"
    ],
    {
      cwd: REPO_ROOT,
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

/**
 * @param {boolean} [force]
 * @returns {{snapshot: Record<string, unknown>, json: string, etag: string, fingerprint: string}}
 */
function snapshot(force = false) {
  const fingerprint = currentFingerprint();
  if (!force && cached && cached.fingerprint === fingerprint) return cached;

  const built = buildSnapshot();
  const json = JSON.stringify(built);
  cached = {
    fingerprint,
    snapshot: built,
    json,
    etag: `W/"${createHash("sha1").update(json).digest("hex")}"`
  };
  return cached;
}

function currentFingerprint() {
  const base = fingerprintSources(WATCHED_SOURCE_IDS).fingerprint;
  const hot = HOT_SOURCES.map((id) => contentHash(id)).join("|");
  return createHash("sha1").update(`${base}|${hot}|${assignmentsSignature()}`).digest("hex");
}

/**
 * assignments.json is not a repository source, so it is absent from WATCHED_SOURCE_IDS — but it is
 * the only file this tool asks an agent to edit. Left out of the fingerprint, a new claim would sit
 * unread behind the snapshot cache until some unrelated document happened to change.
 */
function assignmentsSignature() {
  try {
    const stat = statSync(ASSIGNMENTS_PATH);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return "absent";
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  const path = url.pathname;

  try {
    if (path === "/api/snapshot") return sendSnapshot(req, res);
    if (path === "/api/sources") return sendJson(res, 200, snapshot().snapshot.sources);
    if (path === "/api/events") return openEventStream(res);
    if (path === "/healthz") return sendJson(res, 200, { ok: true, port: PORT });

    if (path === "/api/package-portable") return handlePortableBuild(req, res);

    if (path === "/api/refresh") {
      if (req.method !== "POST") {
        res.writeHead(405, { Allow: "POST", "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Method Not Allowed");
      }
      clearReadCache();
      const next = snapshot(true);
      broadcast(next.fingerprint);
      return sendJson(res, 200, { ok: true, generatedAt: next.snapshot.generatedAt });
    }

    // The application stylesheet, served verbatim from its single registered path. This is what
    // makes the dashboard use the app's real design tokens and classes instead of a copy that
    // silently drifts.
    if (path === "/app.css") {
      const body = await readFile(sourcePath("globalCss"));
      return sendBuffer(req, res, body, MIME[".css"]);
    }

    const file = STATIC_ROUTES.get(path);
    if (file) {
      const body = await readFile(join(ROADMAP_ROOT, "public", file));
      return sendBuffer(req, res, body, MIME[extname(file)] ?? "application/octet-stream");
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`Internal error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

/**
 * The browser can request exactly one predeclared operation. Requiring a non-simple custom header
 * means a hostile webpage cannot start packaging with a cross-origin HTML form; browsers preflight
 * cross-origin fetches carrying this header, and this server exposes no CORS permission.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
function handlePortableBuild(req, res) {
  if (req.method === "GET") return sendJson(res, 200, portableBuild);
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "GET, POST", "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Method Not Allowed");
  }

  const expectedOrigin = `http://${HOST}:${req.socket.localPort}`;
  const origin = req.headers.origin;
  const action = req.headers["x-awkit-roadmap-action"];
  if (action !== PORTABLE_ACTION_HEADER || (origin && origin !== expectedOrigin)) {
    return sendJson(res, 403, { ok: false, error: "Portable build request was not authorized." });
  }
  if (portableBuild.state === "running") {
    return sendJson(res, 409, { ok: false, error: "A portable build is already running.", build: portableBuild });
  }

  portableBuild = {
    state: "running",
    versionPolicy: RELEASE_VERSION_POLICY,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    artifact: null,
    errorCode: null
  };

  let child;
  try {
    child = spawnPortableProcess();
  } catch {
    finishPortableBuild(null, "SPAWN_FAILED");
    return sendJson(res, 500, { ok: false, error: "Portable packaging could not be started.", build: portableBuild });
  }

  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  child.once("error", () => finishPortableBuild(null, "SPAWN_FAILED"));
  child.once("close", (code) => finishPortableBuild(typeof code === "number" ? code : null, null));

  return sendJson(res, 202, { ok: true, build: portableBuild });
}

/** @param {number|null} exitCode @param {string|null} errorCode */
function finishPortableBuild(exitCode, errorCode) {
  if (portableBuild.state !== "running") return;
  const succeeded = errorCode === null && exitCode === 0;
  portableBuild = {
    ...portableBuild,
    state: succeeded ? "succeeded" : "failed",
    finishedAt: new Date().toISOString(),
    exitCode,
    artifact: succeeded ? currentPortableArtifact() : null,
    errorCode
  };
}

function currentPortableArtifact() {
  const version = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).version;
  return `dist/SpecterStudio ${version}.exe`;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
function sendSnapshot(req, res) {
  const current = snapshot();
  if (req.headers["if-none-match"] === current.etag) {
    res.writeHead(304, { ETag: current.etag });
    return res.end();
  }
  res.writeHead(200, {
    "Content-Type": MIME[".json"],
    ETag: current.etag,
    "Cache-Control": "no-cache"
  });
  res.end(current.json);
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {Buffer} body
 * @param {string} contentType
 */
function sendBuffer(req, res, body, contentType) {
  const etag = `W/"${createHash("sha1").update(body).digest("hex")}"`;
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, { ETag: etag });
    return res.end();
  }
  res.writeHead(200, { "Content-Type": contentType, ETag: etag, "Cache-Control": "no-cache" });
  res.end(body);
}

/**
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": MIME[".json"], "Cache-Control": "no-cache" });
  res.end(body);
}

/** @param {import("node:http").ServerResponse} res */
function openEventStream(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write(`event: hello\ndata: ${JSON.stringify({ fingerprint: snapshot().fingerprint })}\n\n`);
  sseClients.add(res);
  res.on("close", () => sseClients.delete(res));
}

/** @param {string} fingerprint */
function broadcast(fingerprint) {
  const frame = `event: snapshot\ndata: ${JSON.stringify({ fingerprint })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(frame);
    } catch {
      sseClients.delete(client);
    }
  }
}

let lastFingerprint = "";
const poll = setInterval(() => {
  const fingerprint = currentFingerprint();
  if (fingerprint === lastFingerprint) return;
  const first = lastFingerprint === "";
  lastFingerprint = fingerprint;
  if (!first) broadcast(fingerprint);
}, POLL_MS);
poll.unref();

const keepalive = setInterval(() => {
  for (const client of sseClients) {
    try {
      client.write(": ping\n\n");
    } catch {
      sseClients.delete(client);
    }
  }
}, KEEPALIVE_MS);
keepalive.unref();

server.listen(PORT, HOST, () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : PORT;
  process.stdout.write(`AWKIT roadmap dashboard: http://${HOST}:${port}\n`);
});

/**
 * Verifier-only process injection. This is an in-process module API, not an HTTP route; production
 * callers always use the fixed PowerShell command above and the browser cannot reach this setter.
 * @param {() => import("node:child_process").ChildProcess} factory
 */
function setPortableBuildProcessFactoryForTests(factory) {
  if (portableBuild.state !== "idle") throw new Error("Portable build factory cannot change after a build starts.");
  spawnPortableProcess = factory;
}

export { server, setPortableBuildProcessFactoryForTests };
