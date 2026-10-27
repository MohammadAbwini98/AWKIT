"use strict";
/**
 * N7.6 (awkit-vra.9.7) DIAGNOSTIC-ONLY OCR ambiguity probe host. Never used by the product: only
 * scripts/benchmark-ocr-ambiguity.mts and scripts/verify-ocr-ambiguity.mts fork it, as a plain Node child process.
 * The production host (native-hosts/ocr/ocr-host.cjs) is not changed and never sets lstm_choice_mode.
 *
 * Engine: the same N7.1a-pinned tesseract.js-core 6.0.0 SIMD LSTM build and English best_int data, checked against the
 * pinned SHA-256 passed at fork (AWKIT_OCR_PROBE_EXPECTED) before anything loads. No engine change, no recompilation.
 *
 * - No network: the Node network entry points are replaced before the engine loads; a call throws.
 * - No writes: the engine's file system is Emscripten memory; nothing is written to disk, nothing is logged.
 * - Replies go only to the parent over IPC, in memory. The parent stores numbers and fixture ids, never text.
 *
 * What it measures, per request: `lstm_choice_mode` (0 = the production setting, 2 = per-symbol alternatives), the page
 * segmentation mode, and either the production word walk or a symbol walk with ChoiceIterator alternatives.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { performance } = require("node:perf_hooks");

const MAX_PIXELS = 1_000_000;
const MAX_WORDS = 600;
const MAX_WORD_LENGTH = 256;
const MAX_CHOICES = 16;
const PSMS = new Set([3, 4, 6, 7]);
const CHOICE_MODES = new Set([0, 2]);

(function blockNetwork() {
  const refuse = () => {
    const error = new Error("network is disabled in the OCR probe host");
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
const ENGINE_JS = "tesseract-core-simd-lstm.js";
const ENGINE_WASM = "tesseract-core-simd-lstm.wasm";
const LANGUAGE_DATA = "eng.traineddata.gz";

let Tess = null;
let api = null;

const send = (message) => process.send(message);
const memory = () => ({ rss: process.memoryUsage().rss, wasmBytes: Tess && Tess.HEAP8 ? Tess.HEAP8.byteLength : null });
const fail = (reason, error) => {
  // The error class and first line only: no recognized text exists at start-up.
  send({ type: "failed", reason, ...(error ? { detail: `${error.name}: ${String(error.message).split("\n")[0].slice(0, 160)}` } : {}) });
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

const destroy = (object) => {
  if (!object) return;
  if (typeof Tess.destroy === "function") Tess.destroy(object);
  else if (typeof object.__destroy__ === "function") object.__destroy__();
};

/** The exposed bindings, as facts: which classes and methods exist, and which parameters the engine accepts. */
function apiFacts() {
  const methods = (Class, names) => (typeof Class === "function" ? names.filter((name) => typeof Class.prototype[name] === "function") : []);
  // SetVariable answers false for a name the engine does not know; the bogus name is the negative control.
  const accepts = (name, value) => api.SetVariable(name, value) === true;
  return {
    choiceIterator: typeof Tess.ChoiceIterator === "function",
    choiceIteratorMethods: methods(Tess.ChoiceIterator, ["Next", "GetUTF8Text", "Confidence"]),
    wordChoiceIterator: typeof Tess.WordChoiceIterator === "function",
    resultIteratorGetChoiceIterator: methods(Tess.ResultIterator, ["GetChoiceIterator"]).length === 1,
    resultIteratorGetBestLstmSymbolChoices: methods(Tess.ResultIterator, ["GetBestLSTMSymbolChoices", "GetRawLSTMTimesteps"]).length > 0,
    resultIteratorMethods: methods(Tess.ResultIterator, ["Begin", "Next", "IsAtBeginningOf", "GetUTF8Text", "Confidence", "Empty"]),
    levels: { word: Tess.RIL_WORD, symbol: Tess.RIL_SYMBOL, textline: Tess.RIL_TEXTLINE },
    lstmChoiceMode: accepts("lstm_choice_mode", "0"),
    lstmChoiceIterations: accepts("lstm_choice_iterations", "5"),
    lstmRatingCoefficient: accepts("lstm_rating_coefficient", "5"),
    bogusVariable: accepts("awkit_no_such_variable", "1")
  };
}

async function start() {
  const started = performance.now();
  const dir = process.env.AWKIT_OCR_PROBE_ASSET_DIR;
  let expected = {};
  try {
    expected = JSON.parse(process.env.AWKIT_OCR_PROBE_EXPECTED || "{}");
  } catch {
    return fail("checksum-mismatch");
  }
  if (!dir || !path.isAbsolute(dir)) return fail("assets-missing");
  const problem = verifyAssets(dir, expected);
  if (problem) return fail(problem);
  if (!WebAssembly.validate(SIMD_PROBE)) return fail("unsupported-cpu");
  const before = process.memoryUsage().rss;
  try {
    const factory = require(path.join(dir, ENGINE_JS));
    Tess = await factory({});
    Tess.FS.writeFile("/eng.traineddata", zlib.gunzipSync(fs.readFileSync(path.join(dir, LANGUAGE_DATA))));
    api = new Tess.TessBaseAPI();
    if (api.Init(null, "eng", 1) !== 0) return fail("host-failed");
  } catch (error) {
    return fail("host-failed", error);
  }
  send({ type: "ready", pid: process.pid, initMs: performance.now() - started, rssBeforeEngine: before, ...memory(), api: apiFacts() });
}

/** A binary PGM: the grayscale plane as an image file the engine's Leptonica reads (as in the production host). */
function pgm(width, height, gray) {
  const header = Buffer.from(`P5\n${width} ${height}\n255\n`, "ascii");
  return Buffer.concat([header, Buffer.from(gray.buffer, gray.byteOffset, gray.byteLength)]);
}

const clampConfidence = (value) => Math.max(0, Math.min(100, Number(value)));

/** The production host's word walk, unchanged: the baseline for timing and for the production-equivalent verdict. */
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
      if (typeof text === "string" && text.trim()) out.push({ text: text.trim().slice(0, MAX_WORD_LENGTH), confidence: clampConfidence(confidence) });
      if (out.length > MAX_WORDS) return null;
    } while (iterator.Next(level));
  } finally {
    destroy(iterator);
  }
  return out;
}

/** A symbol walk: each word with its symbols, each symbol with the ChoiceIterator's alternatives. */
function symbols() {
  const iterator = api.GetIterator();
  const out = [];
  if (!iterator) return out;
  try {
    iterator.Begin();
    if (iterator.Empty(Tess.RIL_SYMBOL)) return out;
    let word = null;
    let line = -1;
    do {
      if (iterator.IsAtBeginningOf(Tess.RIL_TEXTLINE)) line += 1;
      if (word === null || iterator.IsAtBeginningOf(Tess.RIL_WORD)) {
        const text = iterator.GetUTF8Text(Tess.RIL_WORD);
        word = { text: typeof text === "string" ? text.trim().slice(0, MAX_WORD_LENGTH) : "", confidence: clampConfidence(iterator.Confidence(Tess.RIL_WORD)), line, symbols: [] };
        out.push(word);
        if (out.length > MAX_WORDS) return null;
      }
      const text = iterator.GetUTF8Text(Tess.RIL_SYMBOL);
      const symbol = { text: typeof text === "string" ? text : "", confidence: clampConfidence(iterator.Confidence(Tess.RIL_SYMBOL)), choices: [] };
      const choices = new Tess.ChoiceIterator(iterator);
      try {
        do {
          const alternative = choices.GetUTF8Text();
          symbol.choices.push({ text: typeof alternative === "string" ? alternative : "", confidence: clampConfidence(choices.Confidence()) });
        } while (symbol.choices.length < MAX_CHOICES && choices.Next());
      } finally {
        destroy(choices);
      }
      if (word.symbols.length < MAX_WORD_LENGTH) word.symbols.push(symbol);
    } while (iterator.Next(Tess.RIL_SYMBOL));
  } finally {
    destroy(iterator);
  }
  return out.filter((w) => w.text);
}

function recognize(message) {
  const { id, width, height, gray, psm, choiceMode, walk } = message;
  const reply = (fields) => send({ type: "result", id, ...fields, ...memory() });
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > MAX_PIXELS) return reply({ ok: false, reason: "image-invalid" });
  const plane = gray instanceof Uint8Array ? gray : null;
  if (!plane || plane.length !== width * height || !PSMS.has(psm) || !CHOICE_MODES.has(choiceMode) || (walk !== "words" && walk !== "symbols")) return reply({ ok: false, reason: "image-invalid" });
  try {
    Tess.FS.writeFile("/input", pgm(width, height, plane));
    const modeAccepted = api.SetVariable("lstm_choice_mode", String(choiceMode)) === true;
    api.SetVariable("tessedit_pageseg_mode", String(psm));
    if (api.SetImageFile(1, 0) === 1) return reply({ ok: false, reason: "image-invalid" });
    const t0 = performance.now();
    api.Recognize(null);
    const t1 = performance.now();
    const found = walk === "symbols" ? symbols() : words();
    const t2 = performance.now();
    api.Clear();
    Tess.FS.unlink("/input");
    // Leave the engine as production runs it, whatever this request set.
    api.SetVariable("lstm_choice_mode", "0");
    if (!found) return reply({ ok: false, reason: "output-invalid" });
    reply({ ok: true, words: found, modeAccepted, recognizeMs: t1 - t0, extractMs: t2 - t1 });
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
