"use strict";
/**
 * Offline OCR utility host (Phase N, N7.4 / awkit-vra.9.5). Runs in an Electron utilityProcess forked by
 * app/main/ocr/OcrUtilityHostManager.ts. Engine: the N7.1a-qualified direct tesseract.js-core 6.0.0, SIMD LSTM build,
 * with the English best_int data (DECISIONS 2026-10-26). Protocol: src/ocr/OcrHostProtocol.ts.
 *
 * - No network: every Node and Electron network entry point is replaced before the engine loads; a call throws.
 * - No writes: the engine's file system is Emscripten memory; nothing is written to disk.
 * - Fixed assets: AWKIT_OCR_ASSET_DIR and the expected SHA-256 of each file (AWKIT_OCR_EXPECTED) are fixed at fork.
 *   A missing or altered file, or a CPU without WebAssembly SIMD, reports `failed` with a permanent reason and exits.
 * - Recognition is synchronous on this thread: the manager enforces deadlines and cancellation by killing this
 *   process. Nothing here waits for, or answers, a cancel.
 * - Results are words and confidences only. Nothing is logged; text never leaves except in the reply to the job.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const VERSION = 1;
const MAX_PIXELS = 1_000_000;
const MAX_WORDS = 600;
const MAX_WORD_LENGTH = 256;
const port = process.parentPort;

(function blockNetwork() {
  const refuse = () => {
    const error = new Error("network is disabled in the OCR host");
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
  try {
    const { net: electronNet } = require("electron");
    if (electronNet) for (const name of ["request", "fetch"]) if (typeof electronNet[name] === "function") electronNet[name] = refuse;
  } catch {
    // Electron's net is absent or read-only here; the Node entry points above still apply.
  }
})();

// The WebAssembly SIMD probe used by wasm-feature-detect.
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
const ENGINE_JS = "tesseract-core-simd-lstm.js";
const ENGINE_WASM = "tesseract-core-simd-lstm.wasm";
const LANGUAGE_DATA = "eng.traineddata.gz";

let Tess = null;
let api = null;

const send = (message) => port.postMessage({ version: VERSION, ...message });
const rss = () => process.memoryUsage().rss;
const fail = (reason) => {
  send({ type: "failed", reason });
  setImmediate(() => process.exit(0));
};

function verifyAssets(dir, expected) {
  for (const name of [ENGINE_JS, ENGINE_WASM, LANGUAGE_DATA]) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return "assets-missing";
    if (typeof expected[name] !== "string") return "checksum-mismatch";
    if (crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== expected[name]) return "checksum-mismatch";
  }
  return null;
}

async function start() {
  const started = Date.now();
  const dir = process.env.AWKIT_OCR_ASSET_DIR;
  let expected = {};
  try {
    expected = JSON.parse(process.env.AWKIT_OCR_EXPECTED || "{}");
  } catch {
    return fail("checksum-mismatch");
  }
  if (!dir || !path.isAbsolute(dir)) return fail("assets-missing");
  const problem = verifyAssets(dir, expected);
  if (problem) return fail(problem);
  if (!WebAssembly.validate(SIMD_PROBE)) return fail("unsupported-cpu");
  try {
    const factory = require(path.join(dir, ENGINE_JS));
    Tess = await factory({});
    Tess.FS.writeFile("/eng.traineddata", zlib.gunzipSync(fs.readFileSync(path.join(dir, LANGUAGE_DATA))));
    api = new Tess.TessBaseAPI();
    if (api.Init(null, "eng", 1) !== 0) return fail("host-failed");
  } catch {
    return fail("host-failed");
  }
  send({ type: "ready", pid: process.pid, flavor: "simd-lstm", initMs: Date.now() - started });
}

/** A binary PGM: the grayscale plane as an image file the engine's Leptonica reads. */
function pgm(width, height, gray) {
  const header = Buffer.from(`P5\n${width} ${height}\n255\n`, "ascii");
  return Buffer.concat([header, Buffer.from(gray.buffer, gray.byteOffset, gray.byteLength)]);
}

function words() {
  const level = Tess.RIL_WORD;
  const iterator = api.GetIterator();
  const out = [];
  if (!iterator) return out;
  try {
    if (typeof iterator.Begin === "function") iterator.Begin();
    if (typeof iterator.Empty === "function" && iterator.Empty(level)) return out;
    do {
      const text = iterator.GetUTF8Text(level);
      const confidence = iterator.Confidence(level);
      if (typeof text === "string" && text.trim()) out.push({ text: text.trim().slice(0, MAX_WORD_LENGTH), confidence: Math.max(0, Math.min(100, Number(confidence))) });
      if (out.length > MAX_WORDS) return null;
    } while (iterator.Next(level));
  } finally {
    if (typeof iterator.delete === "function") iterator.delete();
  }
  return out;
}

function recognize(message) {
  const { id, width, height, gray, psm } = message;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > MAX_PIXELS) return send({ type: "result", id, ok: false, reason: "image-invalid", rss: rss() });
  const plane = gray instanceof Uint8Array ? gray : null;
  if (!plane || plane.length !== width * height || (psm !== 6 && psm !== 7)) return send({ type: "result", id, ok: false, reason: "image-invalid", rss: rss() });
  const started = Date.now();
  try {
    Tess.FS.writeFile("/input", pgm(width, height, plane));
    api.SetVariable("tessedit_pageseg_mode", String(psm));
    if (api.SetImageFile(1, 0) === 1) return send({ type: "result", id, ok: false, reason: "image-invalid", rss: rss() });
    api.Recognize(null);
    const found = words();
    api.Clear();
    Tess.FS.unlink("/input");
    if (!found) return send({ type: "result", id, ok: false, reason: "output-invalid", rss: rss() });
    send({ type: "result", id, ok: true, words: found, recognizeMs: Date.now() - started, rss: rss() });
  } catch {
    send({ type: "result", id, ok: false, reason: "host-failed", rss: rss() });
  }
}

port.on("message", (event) => {
  const message = event.data;
  if (!message || message.version !== VERSION || typeof message.id !== "string") return;
  if (message.type === "shutdown") {
    try {
      if (api) {
        api.End();
        if (typeof api.delete === "function") api.delete();
      }
    } finally {
      setImmediate(() => process.exit(0));
    }
    return;
  }
  if (message.type === "recognize") {
    if (!api) return send({ type: "result", id: message.id, ok: false, reason: "host-failed", rss: rss() });
    recognize(message);
  }
});

start();
