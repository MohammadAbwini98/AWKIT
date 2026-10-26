"use strict";
/**
 * N7.1a candidate B: direct `tesseract.js-core` (the Emscripten build), in an Electron utility process, on the host's
 * own thread. It uses the same embind calls the wrapper's worker script makes: write the traineddata and the image
 * into the in-memory FS, Init, SetImageFile, Recognize, GetUTF8Text, MeanTextConf. Recognition is synchronous here,
 * so a cancel message is only read after the job returns; the main process measures that and may kill the host.
 */
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const common = require("./host-common.cjs");

common.installTripwire();
common.installFileProbe();

const spikeDir = process.env.AWKIT_OCR_SPIKE_DIR;
const dataFile = process.env.AWKIT_OCR_SPIKE_DATA;
const coreDir = path.join(spikeDir, "node_modules", "tesseract.js-core");
// The WebAssembly SIMD probe used by wasm-feature-detect (v128.const and i8x16.popcnt-free form).
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

let TessModule = null;
let api = null;
let flavor = null;

function apiMethods() {
  return api ? Object.getOwnPropertyNames(Object.getPrototypeOf(api)).filter((name) => name !== "constructor").slice(0, 80) : [];
}

async function start() {
  const simd = WebAssembly.validate(SIMD_PROBE);
  flavor = simd ? "tesseract-core-simd-lstm.js" : "tesseract-core-lstm.js";
  const factory = require(path.join(coreDir, flavor));
  TessModule = await factory({});
  let data = fs.readFileSync(dataFile);
  if (dataFile.endsWith(".gz")) data = zlib.gunzipSync(data);
  TessModule.FS.writeFile("/eng.traineddata", data);
  api = new TessModule.TessBaseAPI();
  const status = api.Init(null, "eng", 1);
  if (status !== 0) throw new Error(`TessBaseAPI.Init returned ${status}`);
  api.SetVariable("tessedit_pageseg_mode", "6");
  return { flavor, simd };
}

common.serve({
  init: async () => {
    const started = Date.now();
    const info = await start();
    return { initMs: Date.now() - started, integration: "tesseract.js-core embind TessBaseAPI (host thread)", ...info };
  },
  recognize: async ({ png }) => {
    if (!api) throw new Error("not initialized");
    const started = Date.now();
    TessModule.FS.writeFile("/input", Buffer.from(png));
    if (typeof api.SetImageFile !== "function") throw new Error(`SetImageFile is not on this core build; methods: ${apiMethods().join(",")}`);
    if (api.SetImageFile(1, 0) === 1) throw new Error("SetImageFile could not read the image");
    if (typeof api.Recognize === "function") api.Recognize(null);
    const text = api.GetUTF8Text();
    const confidence = typeof api.MeanTextConf === "function" ? api.MeanTextConf() : null;
    api.Clear();
    TessModule.FS.unlink("/input");
    return { text, confidence, recognizeMs: Date.now() - started };
  },
  cancel: async ({ target }) => ({ cancelled: target, mode: "none: recognition is synchronous on the host thread" }),
  reinit: async () => {
    const started = Date.now();
    if (api) {
      api.End();
      if (typeof api.delete === "function") api.delete();
    }
    await start();
    return { initMs: Date.now() - started };
  },
  engineStats: async () => ({ flavor, heapBytes: TessModule && TessModule.HEAP8 ? TessModule.HEAP8.length : null }),
  shutdown: async () => {
    if (api) {
      api.End();
      if (typeof api.delete === "function") api.delete();
    }
    api = null;
    setImmediate(() => process.exit(0));
    return { shutdown: true };
  }
});
