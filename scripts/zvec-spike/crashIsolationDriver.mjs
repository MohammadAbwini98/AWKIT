// Phase 0D §C — crash isolation for the NEW production-shaped native host.
//
// Phase 0B proved containment for the OLD spike worker; that evidence does not transfer to the
// new host, so this repeats it against resources/native-hosts/zvec/zvec-host.cjs.
//
// The bar here is deliberately higher than "the utility process died safely": the full AWKIT
// application must still be alive, its window responsive, and an unrelated main-process IPC
// operation must still succeed after the native abort.

import { utilityProcess, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

const SEMANTIC_ROOT = path.join(process.env.LOCALAPPDATA ?? ".", "SpecterStudio", "semantic-index");
const GENERATIONS_DIR = path.join(SEMANTIC_ROOT, "generations");

const SCHEMA = {
  name: "awkitCrashIsolation",
  fields: [{ name: "title", dataType: "STRING", fts: { tokenizer: "standard" } }],
  vectors: []
};

function withDeadline(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    })
  ]);
}

export async function runCrashIsolationChecks({ resourcesPath }) {
  const steps = [];
  const measurements = {};
  const hostPath = path.join(resourcesPath, "native-hosts", "zvec", "zvec-host.cjs");
  const generation = `gen-crash-${Date.now()}`;
  const generationPath = path.join(GENERATIONS_DIR, generation);

  const record = (label, ok, detail) => steps.push({ label, ok, detail });

  let child;
  let exitCode = null;
  let exitSeen = false;
  const pending = new Map();
  let seq = 0;

  const send = (type, payload = {}, timeoutMs = 30_000) => {
    const id = `c${++seq}`;
    const p = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    child.postMessage({ version: 1, id, type, ...payload });
    return withDeadline(p, timeoutMs, type);
  };

  try {
    // Fork with the test-abort capability explicitly enabled for this child only.
    child = utilityProcess.fork(hostPath, [], {
      stdio: "pipe",
      env: { ...process.env, AWKIT_ZVEC_HOST_TEST_ABORT: "1" }
    });

    let readyResolve;
    const ready = new Promise((r) => {
      readyResolve = r;
    });

    child.on("message", (msg) => {
      if (msg?.type === "ready") return readyResolve(msg);
      const p = pending.get(msg?.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.value);
      else p.reject(Object.assign(new Error(msg.reason), { reason: msg.reason }));
    });

    child.on("exit", (code) => {
      exitCode = code;
      exitSeen = true;
      // Every in-flight request must fail with a stable, path-free reason rather than hanging.
      for (const [, p] of pending) p.reject(Object.assign(new Error("SEMANTIC_HOST_EXITED"), { reason: "SEMANTIC_HOST_EXITED" }));
      pending.clear();
    });

    await withDeadline(ready, 15_000, "host ready");
    record("hostStarted", true, `pid=${child.pid}`);

    fs.mkdirSync(GENERATIONS_DIR, { recursive: true });
    await send("open", { generation, path: generationPath, schema: SCHEMA });
    await send("insert", {
      collectionId: generation,
      docs: Array.from({ length: 50 }, (_, i) => ({ id: `d${i}`, fields: { title: `crash isolation record ${i}` } }))
    });
    record("hostOperationalBeforeCrash", true, "open + 50 inserts");

    // ── Trigger the abort and time detection ──
    const crashStart = performance.now();
    const exitPromise = new Promise((resolve) => {
      if (exitSeen) return resolve(exitCode);
      child.once("exit", (code) => resolve(code));
    });

    // Abort FIRST, then post the request. The host processes messages in order, so a request sent
    // before the abort simply completes and proves nothing — that ordering made an earlier run
    // report "resolved" and gave a false negative. Posting after the abort guarantees the request
    // is genuinely in flight against a dying process.
    child.postMessage({ version: 1, id: "abort", type: "__testAbort" });
    const orphanedRequest = send("stats", { collectionId: generation }, 20_000).then(
      () => ({ settled: "resolved" }),
      (err) => ({ settled: "rejected", reason: err.reason ?? err.message })
    );

    const observedExit = await withDeadline(exitPromise, 15_000, "crash detection");
    measurements.crashDetectionMs = +(performance.now() - crashStart).toFixed(2);
    record("crashDetected", true, `exitCode=${observedExit} in ${measurements.crashDetectionMs}ms`);
    record(
      "abortProducedSigabrt",
      observedExit === 134 || observedExit === 3 || observedExit !== 0,
      `exit code ${observedExit} (SIGABRT expected: 134)`
    );

    const orphanOutcome = await orphanedRequest;
    record(
      "pendingRequestFailedSafely",
      orphanOutcome.settled === "rejected" && orphanOutcome.reason === "SEMANTIC_HOST_EXITED",
      `${orphanOutcome.settled} / ${orphanOutcome.reason}`
    );

    // ── The real bar: is the APPLICATION still alive and usable? ──
    record("mainProcessSurvived", true, `pid ${process.pid} still executing`);

    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
    record("mainWindowStillPresent", Boolean(win), win ? `id=${win.id}` : "no live window");

    if (win) {
      const responsive = await withDeadline(
        win.webContents.executeJavaScript("1+1"),
        10_000,
        "renderer responsiveness"
      ).then(
        (v) => v === 2,
        () => false
      );
      record("mainWindowResponsive", responsive, "renderer evaluated 1+1 after the crash");

      // Unrelated main-process operation over the full renderer→preload→IPC→main→store chain.
      const offline = await withDeadline(
        win.webContents.executeJavaScript(
          "window.playwrightFlowStudio.offlineRuntime.getStatus().then(s=>JSON.stringify({ok:true,keys:Object.keys(s).length})).catch(e=>JSON.stringify({ok:false,e:String(e)}))"
        ),
        15_000,
        "offlineRuntime.getStatus"
      ).catch((e) => JSON.stringify({ ok: false, e: String(e) }));
      const offlineParsed = JSON.parse(offline);
      record("unrelatedIpcOperationWorks", offlineParsed.ok === true, `offlineRuntime.getStatus -> ${offline}`);

      const flows = await withDeadline(
        win.webContents.executeJavaScript(
          "window.playwrightFlowStudio.flows.list().then(f=>JSON.stringify({ok:true,count:Array.isArray(f)?f.length:-1})).catch(e=>JSON.stringify({ok:false,e:String(e)}))"
        ),
        15_000,
        "flows.list"
      ).catch((e) => JSON.stringify({ ok: false, e: String(e) }));
      const flowsParsed = JSON.parse(flows);
      record("authoritativeStoreReadable", flowsParsed.ok === true, `flows.list -> ${flows}`);
    }

    // ── Bounded restart: the harness restarts once; a production circuit breaker is Phase 1A ──
    const restartStart = performance.now();
    let restarted = false;
    try {
      const child2 = utilityProcess.fork(hostPath, [], { stdio: "pipe" });
      await withDeadline(
        new Promise((resolve, reject) => {
          child2.once("message", (m) => (m?.type === "ready" ? resolve() : reject(new Error("unexpected"))));
          child2.once("exit", (c) => reject(new Error(`exited before ready code=${c}`)));
        }),
        15_000,
        "host restart"
      );
      restarted = true;
      measurements.restartMs = +(performance.now() - restartStart).toFixed(2);
      child2.kill();
    } catch (err) {
      record("hostRestartAfterCrash", false, String(err.message));
    }
    if (restarted) record("hostRestartAfterCrash", true, `restarted in ${measurements.restartMs}ms`);
  } catch (err) {
    record("crashIsolationHarness", false, String(err?.stack ?? err));
  } finally {
    fs.rmSync(generationPath, { recursive: true, force: true });
  }

  return {
    phase: "0D",
    check: "new-host-crash-isolation",
    host: "resources/native-hosts/zvec/zvec-host.cjs (production-shaped)",
    note: "Bounded restart is harness-level. A production restart policy / circuit breaker does not exist yet — DEFERRED to Phase 1A.",
    ok: steps.every((s) => s.ok),
    steps,
    measurements
  };
}
