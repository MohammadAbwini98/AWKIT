"use strict";
/**
 * N7.6 (awkit-vra.9.7) DIAGNOSTIC-ONLY engine and recognition-data spike host. Never used by the product: only
 * scripts/benchmark-ocr-engine-spike.mts and scripts/verify-ocr-engine-spike.mts fork it, as a plain Node child
 * process. The production host (native-hosts/ocr/ocr-host.cjs) and the production pin are not changed.
 *
 * One candidate per process, fixed at fork: a tesseract.js-core 6.0.0 flavor already installed by the lockfile-pinned
 * spike (scripts/ocr-feasibility), a traineddata file from @tesseract.js-data/eng 1.0.0, and an OCR engine mode.
 * Every file is checked against the SHA-256 passed at fork before it loads. Nothing is downloaded.
 *
 * - No network: the Node network entry points are replaced before the engine loads; a call throws.
 * - No writes: the engine's file system is Emscripten memory; nothing is written to disk, nothing is logged.
 * - The production word walk, unchanged; replies go to the parent over IPC only.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { performance } = require("node:perf_hooks");

const MAX_PIXELS = 1_000_000;
const MAX_WORDS = 600;
const MAX_WORD_LENGTH = 256;
const ENGINES = new Set(["tesseract-core-simd-lstm.js", "tesseract-core-simd.js"]);
const DATA = new Set(["eng-best-int.traineddata.gz", "eng-standard.traineddata.gz"]);
const MODES = new Set([0, 1, 2]);

(function blockNetwork() {
  const refuse = () => {
    const error = new Error("network is disabled in the OCR spike host");
    error.code = "OCR_NETWORK_DISABLED";
    throw error;
  };
  for (const name of ["node:http", "node:https"]) {
    const mod = require(name);
    mod.request = refuse;
    mod.get = refuse;
  }
  require("node:http2").connect = refuse;
  const net = require("node:net");
  net.connect = refuse;
  net.createConnection = refuse;
  require("node:tls").connect = refuse;
  const dns = require("node:dns");
  for (const name of ["lookup", "resolve", "resolve4", "resolve6"]) {
    dns[name] = refuse;
    dns.promises[name] = async () => refuse();
  }
  globalThis.fetch = async () => refuse();
  if (typeof globalThis.WebSocket === "function") globalThis.WebSocket = function WebSocket() { refuse(); };
})();

const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

let Tess = null;
let api = null;
let recognitions = 0;

const send = (message) => process.send(message);
const fail = (reason, error) => {
  send({ type: "failed", reason, ...(error ? { detail: `${error.name}: ${String(error.message).split("\n")[0].slice(0, 160)}` } : {}) });
  setImmediate(() => process.exit(0));
};

async function start() {
  const started = performance.now();
  const dir = process.env.AWKIT_OCR_SPIKE_DIR;
  const engine = process.env.AWKIT_OCR_SPIKE_ENGINE;
  const data = process.env.AWKIT_OCR_SPIKE_DATA;
  const oem = Number(process.env.AWKIT_OCR_SPIKE_OEM);
  let expected = {};
  try {
    expected = JSON.parse(process.env.AWKIT_OCR_SPIKE_EXPECTED || "{}");
  } catch {
    return fail("checksum-mismatch");
  }
  if (!dir || !path.isAbsolute(dir) || !ENGINES.has(engine) || !DATA.has(data) || !MODES.has(oem)) return fail("config-invalid");
  const wasm = engine.replace(/\.js$/, ".wasm");
  for (const name of [engine, wasm, data]) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return fail("assets-missing");
    if (typeof expected[name] !== "string" || crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== expected[name]) return fail("checksum-mismatch");
  }
  if (!WebAssembly.validate(SIMD_PROBE)) return fail("unsupported-cpu");
  try {
    const factory = require(path.join(dir, engine));
    Tess = await factory({});
    Tess.FS.writeFile("/eng.traineddata", zlib.gunzipSync(fs.readFileSync(path.join(dir, data))));
    api = new Tess.TessBaseAPI();
    if (api.Init(null, "eng", oem) !== 0) return fail("init-refused");
  } catch (error) {
    return fail("host-failed", error);
  }
  send({ type: "ready", pid: process.pid, initMs: performance.now() - started, rss: process.memoryUsage().rss });
}

function pgm(width, height, gray) {
  const header = Buffer.from(`P5\n${width} ${height}\n255\n`, "ascii");
  return Buffer.concat([header, Buffer.from(gray.buffer, gray.byteOffset, gray.byteLength)]);
}

const destroy = (object) => {
  if (!object) return;
  if (typeof Tess.destroy === "function") Tess.destroy(object);
  else if (typeof object.__destroy__ === "function") object.__destroy__();
};

/** The production host's word walk. */
function words() {
  const level = Tess.RIL_WORD;
  const iterator = api.GetIterator();
  const out = [];
  if (!iterator) return out;
  try {
    iterator.Begin();
    if (iterator.Empty(level)) return out;
    do {
      const text = iterator.GetUTF8Text(level);
      const confidence = iterator.Confidence(level);
      if (typeof text === "string" && text.trim()) out.push({ text: text.trim().slice(0, MAX_WORD_LENGTH), confidence: Math.max(0, Math.min(100, Number(confidence))) });
      if (out.length > MAX_WORDS) return null;
    } while (iterator.Next(level));
  } finally {
    destroy(iterator);
  }
  return out;
}

function recognize(message) {
  const { id, width, height, gray } = message;
  const reply = (fields) => send({ type: "result", id, ...fields, rss: process.memoryUsage().rss });
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > MAX_PIXELS) return reply({ ok: false, reason: "image-invalid" });
  if (!(gray instanceof Uint8Array) || gray.length !== width * height) return reply({ ok: false, reason: "image-invalid" });
  try {
    Tess.FS.writeFile("/input", pgm(width, height, gray));
    api.SetVariable("tessedit_pageseg_mode", "6");
    if (api.SetImageFile(1, 0) === 1) return reply({ ok: false, reason: "image-invalid" });
    const first = recognitions === 0;
    const t0 = performance.now();
    api.Recognize(null);
    const found = words();
    const ms = performance.now() - t0;
    recognitions += 1;
    api.Clear();
    Tess.FS.unlink("/input");
    if (!found) return reply({ ok: false, reason: "output-invalid" });
    reply({ ok: true, words: found, recognizeMs: ms, first });
  } catch {
    reply({ ok: false, reason: "host-failed" });
  }
}

process.on("message", (message) => {
  if (!message || typeof message.id !== "string") return;
  if (message.type === "shutdown") {
    try {
      if (api) {
        api.End();
        destroy(api);
      }
    } finally {
      setImmediate(() => process.exit(0));
    }
    return;
  }
  if (message.type === "recognize") {
    if (!api) return send({ type: "result", id: message.id, ok: false, reason: "host-failed" });
    recognize(message);
  }
});

process.on("disconnect", () => process.exit(0));

start();
