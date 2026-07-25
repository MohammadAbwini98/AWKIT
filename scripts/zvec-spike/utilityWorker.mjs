// Phase 0 — Option B utility-process worker body (plan §6.3 Option B, §19.1 item 15).
// Runs inside an Electron `utilityProcess.fork()` child. Communicates with the main
// process host over `process.parentPort` only — never exposes @zvec/zvec or any native
// API to the renderer; the renderer has no channel to this process at all.
import { runOpsHarness, destroyCollectionAt } from "./zvecOpsHarness.mjs";

process.parentPort.once("message", async (e) => {
  const { collectionPath, runTag, crashMidOperation } = e.data;
  if (crashMidOperation) {
    // Phase 0B crash-isolation case: hard-abort this process (no catchable JS error, the closest
    // analogue to a native segfault) so the host's detection and blast-radius can be measured.
    process.abort();
  }
  try {
    const result = await runOpsHarness(collectionPath, { runTag });
    let cleanupOk = true;
    try {
      if (result.ok) destroyCollectionAt(collectionPath);
    } catch {
      cleanupOk = false;
    }
    process.parentPort.postMessage({ type: "result", ok: result.ok && cleanupOk, steps: result.steps });
  } catch (err) {
    process.parentPort.postMessage({ type: "result", ok: false, steps: [], loadError: String(err?.stack ?? err) });
  }
});

process.parentPort.postMessage({ type: "workerReady" });
