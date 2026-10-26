"use strict";
/**
 * N7.1a harness self-test host. Not a candidate: it speaks the same protocol with a fake engine so the harness's own
 * checks (cooperative cancel, late-result detection, crash and hang isolation, memory metrics, the network tripwire in
 * the host AND in a worker thread) are proven to work before they are trusted on a real engine.
 */
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const common = require("./host-common.cjs");

common.installTripwire();
common.listenForWorkerAttempts();

const timers = new Map();

common.serve({
  init: async () => ({ initMs: 0, integration: "probe (no engine)" }),
  recognize: ({ id, slow }) =>
    new Promise((resolve) => {
      // Ordinary jobs answer at once; a job marked slow takes 3 s so a cooperative cancel can interrupt it.
      const delay = slow ? 3000 : 10;
      timers.set(id, { timer: setTimeout(() => resolve({ text: "probe", confidence: 0, recognizeMs: delay }), delay), resolve });
    }),
  cancel: async ({ target }) => {
    const entry = timers.get(target);
    if (entry) {
      clearTimeout(entry.timer);
      entry.resolve(undefined);
    }
    return { cancelled: target, mode: "clearTimeout" };
  },
  reinit: async () => ({ initMs: 0 }),
  engineStats: async () => ({}),
  probeNetwork: async () => {
    // Two attempts on the host thread, one inside a worker started through the shim, exactly as candidate A's is.
    for (const call of [() => fetch("https://example.invalid/eng.traineddata"), () => require("node:https").get("https://example.invalid/")]) {
      try {
        await call();
      } catch {
        // Expected: the tripwire throws.
      }
    }
    await new Promise((resolve) => {
      const worker = new Worker(path.join(__dirname, "worker-shim.cjs"), {
        env: { ...process.env, AWKIT_OCR_SPIKE_WORKER_TARGET: path.join(__dirname, "probe-worker-target.cjs") }
      });
      worker.on("exit", resolve);
      worker.on("error", () => {});
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { attempted: 3 };
  },
  shutdown: async () => {
    setImmediate(() => process.exit(0));
    return { shutdown: true };
  }
});
