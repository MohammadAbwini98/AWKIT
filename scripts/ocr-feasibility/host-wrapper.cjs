"use strict";
/**
 * N7.1a candidate A: the supported `tesseract.js` wrapper, in an Electron utility process. The wrapper runs the core
 * in a worker thread. Its worker is started through worker-shim.cjs so the network tripwire also covers that thread.
 * Language data is read from the local `@tesseract.js-data/eng` folder, and the cache is off (cacheMethod "none").
 */
const path = require("node:path");
const common = require("./host-common.cjs");

common.installTripwire();
common.installFileProbe();
common.listenForWorkerAttempts();

const spikeDir = process.env.AWKIT_OCR_SPIKE_DIR;
const dataFile = process.env.AWKIT_OCR_SPIKE_DATA;
const cacheDir = process.env.AWKIT_OCR_SPIKE_CACHE;
const wrapperDir = path.join(spikeDir, "node_modules", "tesseract.js");
process.env.AWKIT_OCR_SPIKE_WORKER_TARGET = path.join(wrapperDir, "src", "worker-script", "node", "index.js");
const Tesseract = require(wrapperDir);

let worker = null;
const cancelled = new Set();
let engineSettledAfterCancel = 0;
let lastEngineError = null;

async function start() {
  worker = await Tesseract.createWorker("eng", Tesseract.OEM.LSTM_ONLY, {
    workerPath: path.join(__dirname, "worker-shim.cjs"),
    langPath: path.dirname(dataFile),
    gzip: dataFile.endsWith(".gz"),
    cachePath: cacheDir,
    cacheMethod: "none",
    logger: () => {},
    errorHandler: (error) => {
      lastEngineError = String(error).slice(0, 300);
    }
  });
  await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK });
}

common.serve({
  init: async () => {
    const started = Date.now();
    await start();
    return { initMs: Date.now() - started, integration: "tesseract.js createWorker (worker thread)" };
  },
  recognize: async ({ id, png }) => {
    if (!worker) throw new Error("not initialized");
    const started = Date.now();
    const job = worker.recognize(Buffer.from(png));
    let result;
    try {
      result = await job;
    } catch (error) {
      if (cancelled.has(id)) {
        engineSettledAfterCancel += 1;
        return undefined;
      }
      throw error;
    }
    if (cancelled.has(id)) {
      // The engine finished after the abort: count it, never deliver it.
      engineSettledAfterCancel += 1;
      return undefined;
    }
    return { text: result.data.text, confidence: result.data.confidence, recognizeMs: Date.now() - started };
  },
  cancel: async ({ target }) => {
    cancelled.add(target);
    const current = worker;
    worker = null;
    if (current) await current.terminate();
    return { cancelled: target, mode: "worker.terminate" };
  },
  reinit: async () => {
    const started = Date.now();
    await start();
    return { initMs: Date.now() - started };
  },
  engineStats: async () => ({ engineSettledAfterCancel, lastEngineError }),
  shutdown: async () => {
    if (worker) await worker.terminate();
    worker = null;
    setImmediate(() => process.exit(0));
    return { shutdown: true };
  }
});
