"use strict";
/**
 * N7.1a feasibility harness — Electron 33 main process. Started by scripts/benchmark-ocr-feasibility.mjs with one
 * argument: the path of a JSON config. It never touches the product: no app code is loaded, nothing is written
 * outside its own temp directories and the result file.
 *
 * For each host kind (probe = harness self-test, wrapper = candidate A, core = candidate B) it measures, in an Electron
 * utilityProcess:
 *   runtime        Windows x64 utility process (x64 under emulation on an ARM64 host is recorded, not hidden)
 *   init           cold first-run start with empty cwd and cache folders, local data only
 *   recognition    three rendered fixtures must read back their expected text
 *   memory         working set after init and after N repeated recognitions, and the peak, from app.getAppMetrics
 *   cancellation   cooperative cancel (ack within the deadline, no late result) or abort by kill; next job succeeds
 *   crash, hang    the host crashes or hangs; the main process stays responsive, detects it, recovers
 *   network        zero attempts on the host thread and in worker threads (tripwire), zero Chromium requests
 *   cleanup        clean shutdown, process gone, no file left in the cwd or cache folders
 */
const { app, BrowserWindow, session, utilityProcess } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const config = JSON.parse(fs.readFileSync(process.argv[process.argv.length - 1], "utf8"));
const T = config.thresholds;

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.on("window-all-closed", () => {});

const FIXTURES = [
  { id: "label", lines: ["SpecterStudio"], px: 40, w: 480, h: 80, expected: "specterstudio" },
  { id: "invoice", lines: ["Invoice 4471 Total 1284.50"], px: 32, w: 720, h: 72, expected: "invoice 4471 total 1284.50" },
  { id: "date", lines: ["Order shipped 2026-10-26"], px: 32, w: 640, h: 72, expected: "order shipped 2026-10-26" },
  {
    id: "page",
    lines: Array.from({ length: 40 }, (_, i) => `Line ${i + 1} the quick brown fox jumps over the lazy dog 0123456789`),
    px: 22,
    w: 1400,
    h: 1140,
    expected: null
  }
];

const chromiumRequests = [];
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalize = (text) => String(text).toLowerCase().replace(/\s+/g, " ").trim();
const tail = (text) => String(text || "").slice(-600);

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`timeout after ${ms} ms`)), ms)))]).finally(() => clearTimeout(timer));
}

async function renderFixtures() {
  const win = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent("<!doctype html><meta charset=utf-8><title>fixtures</title>")}`);
  const fixtures = [];
  for (const f of FIXTURES) {
    const script = `(() => {
      const c = document.createElement("canvas");
      c.width = ${f.w}; c.height = ${f.h};
      const g = c.getContext("2d");
      g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = "#000000"; g.font = "${f.px}px Arial"; g.textBaseline = "top";
      ${JSON.stringify(f.lines)}.forEach((line, i) => g.fillText(line, 16, 16 + i * ${Math.round(f.px * 1.25)}));
      return c.toDataURL("image/png");
    })()`;
    const dataUrl = await win.webContents.executeJavaScript(script);
    const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
    fixtures.push({ ...f, png: new Uint8Array(png), sha256: sha256(png), bytes: png.length });
  }
  return { win, fixtures };
}

async function mainResponsive(win) {
  const started = Date.now();
  try {
    const two = await withTimeout(win.webContents.executeJavaScript("1 + 1"), 2000);
    return { ok: two === 2, roundTripMs: Date.now() - started };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function processMetric(pid) {
  const metric = app.getAppMetrics().find((entry) => entry.pid === pid);
  if (!metric) return null;
  return {
    type: metric.type,
    workingSetMB: Math.round(metric.memory.workingSetSize / 1024),
    peakWorkingSetMB: metric.memory.peakWorkingSetSize ? Math.round(metric.memory.peakWorkingSetSize / 1024) : null
  };
}

const allHosts = [];

function spawnHost(kind) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `awkit-ocr-${kind}-cwd-`));
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), `awkit-ocr-${kind}-cache-`));
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (key !== "ELECTRON_RUN_AS_NODE" && typeof value === "string") env[key] = value;
  Object.assign(env, { AWKIT_OCR_SPIKE_DIR: config.spikeDir, AWKIT_OCR_SPIKE_DATA: config.dataFile || "", AWKIT_OCR_SPIKE_CACHE: cache });
  const child = utilityProcess.fork(path.join(__dirname, `host-${kind}.cjs`), [], { stdio: "pipe", serviceName: `awkit-ocr-spike-${kind}`, cwd, env });
  const host = { kind, child, cwd, cache, pid: null, ready: null, exited: null, pending: new Map(), cancelled: new Set(), late: [], output: "", nextId: 1, attempts: [] };
  host.readyPromise = new Promise((resolve) => (host.onReady = resolve));
  host.exitPromise = new Promise((resolve) =>
    child.once("exit", (code) => {
      host.exited = { code, at: Date.now() };
      for (const [, pending] of host.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`host exited (${code})`));
      }
      host.pending.clear();
      resolve(code);
    })
  );
  const keep = (chunk) => (host.output = (host.output + chunk).slice(-4000));
  child.stdout && child.stdout.on("data", keep);
  child.stderr && child.stderr.on("data", keep);
  child.on("message", (message) => {
    if (!message) return;
    if (message.type === "ready") {
      host.ready = message;
      host.pid = message.pid;
      host.onReady(message);
      return;
    }
    if (message.type !== "reply") return;
    if (host.cancelled.has(message.id)) {
      host.late.push({ id: message.id, at: Date.now() });
      return;
    }
    const pending = host.pending.get(message.id);
    if (!pending) return;
    host.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.ok) pending.resolve(message);
    else pending.reject(Object.assign(new Error(message.error), { code: message.code }));
  });
  allHosts.push(host);
  return host;
}

function request(host, message, timeoutMs) {
  const id = host.nextId++;
  let settled = false;
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      host.pending.delete(id);
      reject(Object.assign(new Error(`timeout after ${timeoutMs} ms`), { code: "TIMEOUT" }));
    }, timeoutMs);
    host.pending.set(id, { resolve, reject, timer });
    host.child.postMessage({ ...message, id });
  });
  promise.then(() => (settled = true), () => (settled = true));
  return { id, promise, isSettled: () => settled };
}
const call = (host, message, timeoutMs) => request(host, message, timeoutMs).promise;

/** Abandon a request locally: any reply that still arrives for it is a late result. */
function abandon(host, id) {
  host.cancelled.add(id);
  const pending = host.pending.get(id);
  if (pending) {
    clearTimeout(pending.timer);
    host.pending.delete(id);
  }
}

async function collectAttempts(host) {
  try {
    const stats = await call(host, { type: "stats" }, 3000);
    host.attempts = stats.networkAttempts || [];
  } catch {
    // Unresponsive host: its attempts so far are lost, which the network row reports as unverified.
    host.attemptsUnverified = true;
  }
}

async function startHost(kind) {
  const host = spawnHost(kind);
  const ready = await withTimeout(host.readyPromise, 30000).catch(() => null);
  if (!ready) return { host, error: `host never became ready: ${tail(host.output)}` };
  try {
    const init = await call(host, { type: "init" }, T.initMs);
    return { host, init };
  } catch (error) {
    return { host, error: `${error.message} ${tail(host.output)}`.trim() };
  }
}

async function recognizeLabel(host, fixtures) {
  const label = fixtures.find((f) => f.id === "label");
  try {
    const result = await call(host, { type: "recognize", png: label.png }, T.recognizeMs);
    return host.kind === "probe" ? true : normalize(result.text).includes(label.expected);
  } catch {
    return false;
  }
}

async function terminate(host) {
  if (!host.exited) {
    host.child.kill();
    await withTimeout(host.exitPromise, T.killDeadlineMs).catch(() => {});
  }
}

async function evaluate(kind, fixtures, win) {
  const rows = {};
  const row = (name, pass, detail = {}) => (rows[name] = { pass: Boolean(pass), ...detail });
  const isProbe = kind === "probe";

  let { host, init, error } = await startHost(kind);
  row("runtime", host.ready && host.ready.platform === "win32" && host.ready.arch === "x64", host.ready ? { arch: host.ready.arch, platform: host.ready.platform, node: host.ready.node, electron: host.ready.electron } : { error });
  row("init", Boolean(init), init ? { initMs: init.initMs, integration: init.integration, flavor: init.flavor ?? null, simd: init.simd ?? null } : { error });
  if (!init) {
    await collectAttempts(host);
    await terminate(host);
    return finish(kind, rows);
  }

  // Recognition of the three labelled fixtures. The recognized text itself is not recorded.
  const recognition = [];
  for (const f of fixtures.filter((x) => x.expected)) {
    try {
      const result = await call(host, { type: "recognize", png: f.png }, T.recognizeMs);
      recognition.push({ id: f.id, matched: isProbe ? null : normalize(result.text).includes(f.expected), recognizeMs: result.recognizeMs, confidence: result.confidence ?? null, characters: String(result.text).length });
    } catch (e) {
      recognition.push({ id: f.id, matched: false, error: e.message });
    }
  }
  row("recognition", isProbe ? recognition.every((r) => !r.error) : recognition.every((r) => r.matched), { fixtures: recognition });

  // Memory: working set after init, after N repeated recognitions, and the peak.
  const afterInit = processMetric(host.pid);
  for (let i = 0; i < T.repeat; i += 1) await recognizeLabel(host, fixtures);
  const afterRepeat = processMetric(host.pid);
  const hostMemory = await call(host, { type: "stats" }, 3000).then((s) => s.memory, () => null);
  const engine = await call(host, { type: "engineStats" }, 3000).catch(() => null);
  const growth = afterInit && afterRepeat ? afterRepeat.workingSetMB - afterInit.workingSetMB : null;
  const peak = afterRepeat ? afterRepeat.peakWorkingSetMB ?? afterRepeat.workingSetMB : null;
  row("memory", peak !== null && growth !== null && peak <= T.peakWorkingSetMB && growth <= T.growthMB, { afterInit, afterRepeat, growthMB: growth, peakMB: peak, repeat: T.repeat, hostMemory, engine: engine ? { flavor: engine.flavor ?? null, heapBytes: engine.heapBytes ?? null } : null });

  // Cooperative cancellation of a large job.
  const page = fixtures.find((f) => f.id === "page");
  const coopJob = request(host, { type: "recognize", png: page.png, slow: true }, T.recognizeMs);
  coopJob.promise.catch(() => {});
  await sleep(T.cancelAfterMs);
  const finishedBeforeCancel = coopJob.isSettled();
  abandon(host, coopJob.id);
  const cancelSent = Date.now();
  const ack = await call(host, { type: "cancel", target: coopJob.id }, T.cancelDeadlineMs).catch(() => null);
  const ackMs = ack ? Date.now() - cancelSent : null;
  let killedForCancel = false;
  if (!ack) {
    await collectAttempts(host);
    killedForCancel = true;
    await terminate(host);
  }
  await sleep(T.lateGraceMs);
  const coopLate = host.late.filter((l) => l.id === coopJob.id).length;
  const settledAfterCancel = !killedForCancel ? await call(host, { type: "engineStats" }, 3000).then((s) => s.engineSettledAfterCancel ?? null, () => null) : null;
  let coopNext = false;
  let coopRecoveryMs = null;
  const recoverStarted = Date.now();
  if (killedForCancel) {
    ({ host, init } = await startHost(kind));
    coopNext = Boolean(init) && (await recognizeLabel(host, fixtures));
  } else {
    const reinit = await call(host, { type: "reinit" }, T.initMs).catch(() => null);
    coopNext = Boolean(reinit) && (await recognizeLabel(host, fixtures));
  }
  coopRecoveryMs = Date.now() - recoverStarted;
  const cooperative = { ackMs, mode: ack ? ack.mode : "no ack: killed", killed: killedForCancel, lateResults: coopLate, engineSettledAfterCancel: settledAfterCancel, finishedBeforeCancel, nextJobOk: coopNext, recoveryMs: coopRecoveryMs };
  cooperative.pass = !finishedBeforeCancel && Boolean(ack) && ackMs <= T.cancelDeadlineMs && coopLate === 0 && coopNext;

  // Abort by kill: the manager kills the host mid-job; no result may arrive; a fresh host serves the next job.
  const killJob = request(host, { type: "recognize", png: page.png, slow: true }, T.recognizeMs);
  killJob.promise.catch(() => {});
  await sleep(T.cancelAfterMs);
  const killFinishedEarly = killJob.isSettled();
  await collectAttempts(host);
  abandon(host, killJob.id);
  const killStarted = Date.now();
  await terminate(host);
  const killExitMs = host.exited ? Date.now() - killStarted : null;
  await sleep(T.lateGraceMs);
  const killLate = host.late.filter((l) => l.id === killJob.id).length;
  const respawnStarted = Date.now();
  ({ host, init } = await startHost(kind));
  const killNext = Boolean(init) && (await recognizeLabel(host, fixtures));
  const byKill = { exitMs: killExitMs, lateResults: killLate, finishedBeforeAbort: killFinishedEarly, nextJobOk: killNext, recoveryMs: Date.now() - respawnStarted };
  byKill.pass = !killFinishedEarly && killExitMs !== null && killExitMs <= T.killDeadlineMs && killLate === 0 && killNext;
  row("cancellation", cooperative.pass || byKill.pass, { mode: cooperative.pass ? "cooperative" : byKill.pass ? "abort-by-kill" : "none", cooperative, byKill });

  // Crash isolation.
  await collectAttempts(host);
  call(host, { type: "crash" }, 1000).catch(() => {});
  const crashCode = await withTimeout(host.exitPromise, T.killDeadlineMs).catch(() => "timeout");
  const crashResponsive = await mainResponsive(win);
  const crashRecovery = await startHost(kind);
  host = crashRecovery.host;
  const crashNext = Boolean(crashRecovery.init) && (await recognizeLabel(host, fixtures));
  row("crashIsolation", crashCode !== "timeout" && crashResponsive.ok && crashNext, { exitCode: crashCode, mainResponsive: crashResponsive, recovered: crashNext });

  // Hang isolation.
  await collectAttempts(host);
  call(host, { type: "hang" }, 1000).catch(() => {});
  await sleep(100);
  const answered = await call(host, { type: "stats" }, T.cancelDeadlineMs).then(() => true, () => false);
  const hangKillStarted = Date.now();
  await terminate(host);
  const hangExitMs = host.exited ? Date.now() - hangKillStarted : null;
  const hangResponsive = await mainResponsive(win);
  const hangRecovery = await startHost(kind);
  host = hangRecovery.host;
  const hangNext = Boolean(hangRecovery.init) && (await recognizeLabel(host, fixtures));
  row("hangIsolation", !answered && hangExitMs !== null && hangResponsive.ok && hangNext, { hungHostAnswered: answered, exitMs: hangExitMs, mainResponsive: hangResponsive, recovered: hangNext });

  // Harness self-test only: a reply to an abandoned job must be counted as late, and the tripwire must catch
  // host-thread and worker-thread attempts.
  if (isProbe) {
    const lateJob = request(host, { type: "recognize", png: page.png, slow: true }, T.recognizeMs);
    lateJob.promise.catch(() => {});
    abandon(host, lateJob.id);
    await sleep(3500);
    row("lateResultDetection", host.late.some((l) => l.id === lateJob.id), { selfTest: true });
    await call(host, { type: "probeNetwork" }, 10000).catch(() => null);
  }
  await collectAttempts(host);

  // Clean shutdown.
  const lastPid = host.pid;
  const shutdown = await call(host, { type: "shutdown" }, 10000).catch((e) => ({ error: e.message }));
  const shutdownCode = await withTimeout(host.exitPromise, T.killDeadlineMs).catch(() => "timeout");
  await sleep(500);
  const leftovers = [];
  for (const h of allHosts.filter((x) => x.kind === kind)) {
    await terminate(h);
    for (const dir of [h.cwd, h.cache]) {
      const files = fs.readdirSync(dir, { recursive: true });
      if (files.length) leftovers.push({ folder: dir === h.cwd ? "cwd" : "cache", files: files.slice(0, 10).map(String) });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  row("cleanup", !shutdown.error && shutdownCode === 0 && processMetric(lastPid) === null && leftovers.length === 0, { exitCode: shutdownCode, processGone: processMetric(lastPid) === null, leftovers });

  const hosts = allHosts.filter((x) => x.kind === kind);
  const attempts = hosts.flatMap((h) => h.attempts);
  const unverified = hosts.filter((h) => h.attemptsUnverified).length;
  if (isProbe) {
    row("network", attempts.length >= 3 && attempts.some((a) => a.thread === "worker") && attempts.some((a) => a.thread === "host"), { tripwireSelfTest: true, attempts, unverifiedHosts: unverified });
  } else {
    row("network", attempts.length === 0 && unverified === 0, { attempts, unverifiedHosts: unverified });
  }
  return finish(kind, rows);
}

function finish(kind, rows) {
  return { kind, status: "RAN", pass: Object.values(rows).every((r) => r.pass), rows };
}

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (details.url.startsWith("data:") || details.url.startsWith("devtools:")) return callback({});
    chromiumRequests.push(details.url.slice(0, 200));
    callback({ cancel: true });
  });
  const result = { harness: {}, candidates: {} };
  try {
    const { win, fixtures } = await renderFixtures();
    result.harness.fixtures = fixtures.map((f) => ({ id: f.id, width: f.w, height: f.h, fontPx: f.px, font: "Arial", lines: f.lines.length, bytes: f.bytes, sha256: f.sha256 }));
    result.harness.probe = await evaluate("probe", fixtures, win);
    for (const kind of config.candidates) {
      result.candidates[kind] = await evaluate(kind, fixtures, win);
    }
    result.harness.chromiumRequests = chromiumRequests;
  } catch (error) {
    result.error = String(error && error.stack ? error.stack : error).slice(0, 2000);
  }
  fs.writeFileSync(config.resultPath, JSON.stringify(result, null, 2));
  app.exit(0);
});
