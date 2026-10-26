"use strict";
/**
 * Shared by every N7.1a spike host (utility process) and by the worker-thread shim.
 *
 * NETWORK TRIPWIRE. Every Node network entry point (fetch, http/https/http2, net, tls, dns, WebSocket) is replaced by
 * a function that records the attempt and throws. A candidate that needs the network therefore fails visibly, and
 * the attempt count is evidence. Worker threads have their own module instances, so the shim installs the same
 * tripwire inside each worker and reports attempts over a BroadcastChannel.
 *
 * FILE PROVENANCE. Every module resolution and every fs read of an engine file (core JS/WASM, traineddata) is recorded
 * with its absolute path, on the host thread and, through the shim, in worker threads, so the harness can prove which
 * core flavor and which language data were loaded and that each came from the spike's own folder.
 *
 * LIMITS. This is API interception inside the Node environments the candidate runs in. It does not observe raw
 * syscalls from native code, other processes, or the OS network stack; it is not an OS-level offline proof.
 *
 * PROTOCOL. main -> host: { type, id, ... }; host -> main: { type: "reply", id, ok, ... } and one { type: "ready" }.
 */
const CHANNEL = "awkit-ocr-spike-network";
const FILES_CHANNEL = "awkit-ocr-spike-files";
/** Engine files, plus the self-test's worker target so the probe can prove the mechanism across threads. */
const ENGINE_FILE = /tesseract|traineddata|\.wasm$|probe-worker-target/i;
const attempts = [];
const filesLoaded = [];
let shimLoaded = false;

function describe(target) {
  if (typeof target === "string") return target.slice(0, 200);
  if (target && typeof target === "object") return String(target.href || target.host || target.hostname || target.path || "[object]").slice(0, 200);
  return String(target).slice(0, 200);
}

function installTripwire({ broadcast = false } = {}) {
  const channel = broadcast && typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL) : null;
  if (channel && typeof channel.unref === "function") channel.unref();
  const trip = (kind, target) => {
    const entry = { kind, target: describe(target), thread: broadcast ? "worker" : "host" };
    attempts.push(entry);
    if (channel) channel.postMessage(entry);
    const error = new Error(`network disabled by the AWKIT N7.1a spike (${kind})`);
    error.code = "AWKIT_NETWORK_DISABLED";
    throw error;
  };
  const http = require("node:http");
  const https = require("node:https");
  const http2 = require("node:http2");
  const net = require("node:net");
  const tls = require("node:tls");
  const dns = require("node:dns");
  for (const [mod, name] of [[http, "http"], [https, "https"]]) {
    mod.request = (target) => trip(`${name}.request`, target);
    mod.get = (target) => trip(`${name}.get`, target);
  }
  http2.connect = (target) => trip("http2.connect", target);
  net.connect = (target) => trip("net.connect", target);
  net.createConnection = (target) => trip("net.createConnection", target);
  tls.connect = (target) => trip("tls.connect", target);
  for (const name of ["lookup", "resolve", "resolve4", "resolve6"]) dns[name] = (host) => trip(`dns.${name}`, host);
  for (const name of ["lookup", "resolve", "resolve4", "resolve6"]) dns.promises[name] = async (host) => trip(`dns.promises.${name}`, host);
  globalThis.fetch = async (input) => trip("fetch", typeof input === "string" ? input : input && input.url);
  if (typeof globalThis.WebSocket === "function") globalThis.WebSocket = function WebSocket(url) { trip("WebSocket", url); };
  // Electron's own network module is reachable from a utility process (not from a worker thread).
  try {
    const { net } = require("electron");
    for (const name of ["request", "fetch"]) if (net && typeof net[name] === "function") net[name] = (target) => trip(`electron.net.${name}`, target);
  } catch {
    // Not an Electron process, or net is not writable: the Node entry points above still apply.
  }
}

/** Record engine files resolved by require or read through fs on this thread. */
function installFileProbe({ broadcast = false } = {}) {
  const channel = broadcast && typeof BroadcastChannel === "function" ? new BroadcastChannel(FILES_CHANNEL) : null;
  if (channel && typeof channel.unref === "function") channel.unref();
  const record = (file) => {
    const value = typeof file === "string" ? file : file instanceof URL ? file.pathname : null;
    if (!value || !ENGINE_FILE.test(value)) return;
    const entry = { file: value, thread: broadcast ? "worker" : "host" };
    filesLoaded.push(entry);
    if (channel) channel.postMessage(entry);
  };
  const Module = require("node:module");
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function resolveFilename(...args) {
    const resolved = resolve.apply(this, args);
    record(resolved);
    return resolved;
  };
  const fs = require("node:fs");
  for (const name of ["readFileSync", "readFile", "createReadStream"]) {
    const original = fs[name];
    fs[name] = function patched(file, ...rest) {
      record(file);
      return original.call(this, file, ...rest);
    };
  }
  const readPromise = fs.promises.readFile;
  fs.promises.readFile = function patched(file, ...rest) {
    record(file);
    return readPromise.call(this, file, ...rest);
  };
  if (channel) channel.postMessage({ shim: true });
}

/** Collect network attempts and loaded files reported by worker threads (host side). */
function listenForWorkerAttempts() {
  if (typeof BroadcastChannel !== "function") return;
  const channel = new BroadcastChannel(CHANNEL);
  if (typeof channel.unref === "function") channel.unref();
  channel.onmessage = (event) => attempts.push(event.data);
  const files = new BroadcastChannel(FILES_CHANNEL);
  if (typeof files.unref === "function") files.unref();
  files.onmessage = (event) => {
    if (event.data && event.data.shim) shimLoaded = true;
    else filesLoaded.push(event.data);
  };
}

function memory() {
  const m = process.memoryUsage();
  return { rss: m.rss, heapUsed: m.heapUsed, external: m.external, arrayBuffers: m.arrayBuffers };
}

/**
 * Serve the protocol. `handlers` maps a request type to an async function returning a plain object. Every host
 * also answers stats, crash (process.abort) and hang (a busy loop the main process must kill).
 */
function serve(handlers, ready = {}) {
  const port = process.parentPort;
  const reply = (id, ok, body) => port.postMessage({ type: "reply", id, ok, ...body });
  const builtins = {
    stats: async () => ({ memory: memory(), networkAttempts: attempts.slice(), filesLoaded: filesLoaded.slice(), shimLoaded }),
    crash: async () => process.abort(),
    hang: async () => {
      for (;;) {
        // Deliberate hang: the main process must detect it and kill this host.
      }
    }
  };
  port.on("message", (event) => {
    const message = event.data || {};
    const handler = handlers[message.type] || builtins[message.type];
    if (!handler) return reply(message.id, false, { error: `unknown request ${message.type}` });
    Promise.resolve()
      .then(() => handler(message))
      .then((body) => body !== undefined && reply(message.id, true, body || {}))
      .catch((error) => reply(message.id, false, { error: String(error && error.message ? error.message : error).slice(0, 500), code: error && error.code }));
  });
  port.postMessage({ type: "ready", pid: process.pid, arch: process.arch, platform: process.platform, node: process.versions.node, electron: process.versions.electron });
}

module.exports = { CHANNEL, attempts, filesLoaded, installFileProbe, installTripwire, listenForWorkerAttempts, memory, serve };
