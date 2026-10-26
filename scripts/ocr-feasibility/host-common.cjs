"use strict";
/**
 * Shared by every N7.1a spike host (utility process) and by the worker-thread shim.
 *
 * NETWORK TRIPWIRE. Every Node network entry point (fetch, http/https/http2, net, tls, dns, WebSocket) is replaced by
 * a function that records the attempt and throws. A candidate that needs the network therefore fails visibly, and
 * the attempt count is evidence. Worker threads have their own module instances, so the shim installs the same
 * tripwire inside each worker and reports attempts over a BroadcastChannel.
 *
 * PROTOCOL. main -> host: { type, id, ... }; host -> main: { type: "reply", id, ok, ... } and one { type: "ready" }.
 */
const CHANNEL = "awkit-ocr-spike-network";
const attempts = [];

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
}

/** Collect attempts reported by worker threads (host side). */
function listenForWorkerAttempts() {
  if (typeof BroadcastChannel !== "function") return;
  const channel = new BroadcastChannel(CHANNEL);
  if (typeof channel.unref === "function") channel.unref();
  channel.onmessage = (event) => attempts.push(event.data);
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
    stats: async () => ({ memory: memory(), networkAttempts: attempts.slice() }),
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

module.exports = { CHANNEL, attempts, installTripwire, listenForWorkerAttempts, memory, serve };
