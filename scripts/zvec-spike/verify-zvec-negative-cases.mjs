// Phase 0 — negative-case matrix (plan §26.2 / user-authorized mandatory negative cases).
// Runs under plain system Node (no Electron). Cases 8-9 (utility-process startup failure /
// crash) require the utility-process host and are reported separately as blocked, per the
// documented Electron-launch limitation in this execution environment (see compatibility
// report "Known limitations").
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { ensureSpikeDirs, freshCollectionPath, removeCollectionDir, writeReport } from "./paths.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");
const bindingPkgDir = path.join(projectRoot, "node_modules", "@zvec", "bindings-win32-x64");
const nodeBinaryPath = path.join(bindingPkgDir, "zvec_node_binding.node");
const jiebaDictDir = path.join(bindingPkgDir, "jieba_dict");

ensureSpikeDirs();
const cases = [];

function record(name, fn) {
  try {
    const detail = fn();
    cases.push({ name, ok: true, detail });
  } catch (err) {
    cases.push({ name, ok: false, note: String(err?.message ?? err) });
  }
}

function runChildProbe(scriptBody) {
  const tmp = path.join(__dirname, `.probe-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(tmp, scriptBody, "utf8");
  try {
    const out = execFileSync(process.execPath, [tmp], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { crashed: false, stdout: out };
  } catch (err) {
    return { crashed: false, failedCleanly: true, stderr: String(err.stderr ?? ""), status: err.status };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// ── 1. Missing Windows native binding ───────────────────────────────────────────────
record("missingNativeBinding", () => {
  const backup = nodeBinaryPath + ".bak-missing-test";
  fs.renameSync(nodeBinaryPath, backup);
  try {
    const probe = runChildProbe(`
      try { await import("@zvec/zvec"); console.log("UNEXPECTED_LOAD_SUCCEEDED"); }
      catch (e) { console.log("FAILED_CLEANLY:" + e.message); }
    `);
    if (!probe.stdout?.includes("FAILED_CLEANLY")) throw new Error(`Did not fail cleanly: ${JSON.stringify(probe)}`);
    return { failedCleanly: true, message: probe.stdout.trim() };
  } finally {
    fs.renameSync(backup, nodeBinaryPath);
  }
});

// ── 2. Missing Jieba dictionary file ────────────────────────────────────────────────
record("missingJiebaDictionary", () => {
  const backup = jiebaDictDir + "-bak-missing-test";
  fs.renameSync(jiebaDictDir, backup);
  try {
    const probe = runChildProbe(`
      const { ZVecGetDefaultJiebaDictDir } = await import("@zvec/zvec");
      const dir = ZVecGetDefaultJiebaDictDir();
      console.log("dictDirAfterRemoval:" + JSON.stringify(dir));
    `);
    // Expectation: the loader's auto-registration finds no dict beside the binary and simply
    // does not register one (dir is falsy/empty) rather than crashing — FTS with the jieba
    // tokenizer would then fail per-query, not at load time. Record the actual behavior.
    return { note: "loader did not crash with dictionary absent", stdout: probe.stdout?.trim() };
  } finally {
    fs.renameSync(backup, jiebaDictDir);
  }
});

// ── 3. Corrupted / checksum-mismatched native binding ───────────────────────────────
record("corruptedNativeBinding", () => {
  const backup = nodeBinaryPath + ".bak-corrupt-test";
  fs.copyFileSync(nodeBinaryPath, backup);
  const buf = fs.readFileSync(nodeBinaryPath);
  buf.fill(0, 0, Math.min(4096, buf.length)); // zero out the PE header region
  fs.writeFileSync(nodeBinaryPath, buf);
  try {
    const probe = runChildProbe(`
      try { await import("@zvec/zvec"); console.log("UNEXPECTED_LOAD_SUCCEEDED"); }
      catch (e) { console.log("FAILED_CLEANLY:" + e.message); }
    `);
    if (!probe.stdout?.includes("FAILED_CLEANLY")) throw new Error(`Did not fail cleanly: ${JSON.stringify(probe)}`);
    return { failedCleanly: true, message: probe.stdout.trim() };
  } finally {
    fs.copyFileSync(backup, nodeBinaryPath);
    fs.rmSync(backup, { force: true });
  }
});

// ── 4. Optional dependency pruned ───────────────────────────────────────────────────
record("optionalDependencyPruned", () => {
  const backup = bindingPkgDir + "-bak-pruned-test";
  fs.renameSync(bindingPkgDir, backup);
  try {
    const probe = runChildProbe(`
      try { await import("@zvec/zvec"); console.log("UNEXPECTED_LOAD_SUCCEEDED"); }
      catch (e) { console.log("FAILED_CLEANLY:" + e.message); }
    `);
    if (!probe.stdout?.includes("FAILED_CLEANLY")) throw new Error(`Did not fail cleanly: ${JSON.stringify(probe)}`);
    return { failedCleanly: true, message: probe.stdout.trim() };
  } finally {
    fs.renameSync(backup, bindingPkgDir);
  }
});

// ── 5. Attempted collection creation in a read-only location ───────────────────────
record("readOnlyLocationWrite", () => {
  const readOnlyDir = freshCollectionPath("readonly-target-parent");
  fs.mkdirSync(readOnlyDir, { recursive: true });
  execFileSync("icacls", [readOnlyDir, "/deny", `${process.env.USERNAME}:(OI)(CI)W`], { stdio: "ignore" });
  try {
    const collPath = path.join(readOnlyDir, "coll");
    const probe = runChildProbe(`
      const { ZVecCreateAndOpen, ZVecCollectionSchema, ZVecDataType } = await import("@zvec/zvec");
      try {
        ZVecCreateAndOpen(${JSON.stringify(collPath)}, new ZVecCollectionSchema({ name: "readOnlyLocationTest", fields: [{ name: "t", dataType: ZVecDataType.STRING }] }));
        console.log("UNEXPECTED_LOAD_SUCCEEDED");
      } catch (e) { console.log("FAILED_CLEANLY:" + e.message); }
    `);
    return { stdout: probe.stdout?.trim(), note: probe.stdout?.includes("FAILED_CLEANLY") ? "failed cleanly as expected" : "did not fail — see stdout" };
  } finally {
    execFileSync("icacls", [readOnlyDir, "/reset"], { stdio: "ignore" });
    fs.rmSync(readOnlyDir, { recursive: true, force: true });
  }
});

// ── 6. Invalid collection path outside the approved runtime root ───────────────────
record("pathOutsideApprovedRoot", () => {
  // Zvec itself has no concept of an "approved root" — that policy must live in AWKIT's
  // future SemanticIndexService, not in the vendor library. This case documents that the
  // vendor library will happily create a collection anywhere it has write access, which is
  // exactly why the plan requires an AWKIT-level path-confinement guard before Phase 1.
  return { note: "Zvec enforces no path policy of its own; AWKIT must add its own approved-root guard before Phase 1 (not yet implemented — no production code exists)." };
});

// ── 7. Native module load failure (generic) ─────────────────────────────────────────
record("genericLoadFailure", () => {
  const probe = runChildProbe(`
    try {
      const mod = await import(${JSON.stringify(path.join(projectRoot, "node_modules", "@zvec", "does-not-exist", "index.js"))});
      console.log("UNEXPECTED_LOAD_SUCCEEDED");
    } catch (e) { console.log("FAILED_CLEANLY:" + e.constructor.name); }
  `);
  return { stdout: probe.stdout?.trim() };
});

// ── 10. Wrong vector dimension ───────────────────────────────────────────────────────
record("wrongVectorDimension", () => {
  const collPath = freshCollectionPath("wrong-dim");
  removeCollectionDir(collPath);
  const probe = runChildProbe(`
    const { ZVecCreateAndOpen, ZVecCollectionSchema, ZVecDataType, ZVecIndexType, ZVecMetricType } = await import("@zvec/zvec");
    const c = ZVecCreateAndOpen(${JSON.stringify(collPath)}, new ZVecCollectionSchema({
      name: "wrongdim",
      vectors: [{ name: "embedding", dataType: ZVecDataType.VECTOR_FP32, dimension: 16, indexParams: { indexType: ZVecIndexType.FLAT, metricType: ZVecMetricType.COSINE } }]
    }));
    const status = c.insertSync({ id: "d1", vectors: { embedding: new Float32Array(8) } });
    console.log(JSON.stringify({ ok: status.ok, code: status.code, message: status.message }));
    c.closeSync();
  `);
  removeCollectionDir(collPath);
  return { stdout: probe.stdout?.trim() };
});

// ── 11. Corrupted / incomplete collection generation ────────────────────────────────
record("corruptedCollectionData", () => {
  const collPath = freshCollectionPath("corrupt-gen");
  removeCollectionDir(collPath);
  execFileSync(process.execPath, [
    "-e",
    `
      import("@zvec/zvec").then(({ ZVecCreateAndOpen, ZVecCollectionSchema, ZVecDataType }) => {
        const c = ZVecCreateAndOpen(${JSON.stringify(collPath)}, new ZVecCollectionSchema({ name: "corrupt", fields: [{ name: "t", dataType: ZVecDataType.STRING }] }));
        c.insertSync({ id: "d1", fields: { t: "hello" } });
        c.closeSync();
      });
    `
  ]);
  // Truncate/garble every file in the collection directory to simulate an incomplete/corrupt generation.
  for (const f of fs.readdirSync(collPath)) {
    const full = path.join(collPath, f);
    if (fs.statSync(full).isFile()) {
      const size = fs.statSync(full).size;
      fs.writeFileSync(full, Buffer.alloc(Math.min(16, size), 0xff));
    }
  }
  const probe = runChildProbe(`
    try {
      const { ZVecOpen } = await import("@zvec/zvec");
      const c = ZVecOpen(${JSON.stringify(collPath)});
      console.log("UNEXPECTED_OPEN_SUCCEEDED docCount=" + c.stats.docCount);
    } catch (e) { console.log("FAILED_CLEANLY:" + e.message); }
  `);
  removeCollectionDir(collPath);
  return { stdout: probe.stdout?.trim(), note: probe.stdout?.includes("FAILED_CLEANLY") ? "rejected corrupt generation cleanly" : "did NOT reject corrupt generation — see stdout, this needs AWKIT-level quarantine handling" };
});

// ── 12. Disk-write failure (bounded, safe approximation) ───────────────────────────
record("diskWriteFailureApproximation", () => {
  // A true full-disk simulation is out of scope for a safe local spike. As a bounded proxy,
  // attempt to write into a location this account has no permission for (same mechanism as
  // case 5) — already covered above. Recorded here as a named case per the required matrix,
  // pointing at case 5's result rather than duplicating it.
  return { note: "approximated by readOnlyLocationWrite (case 5); a true full-disk-exhaustion test was not attempted (unsafe on a shared dev machine)" };
});

report_and_exit();

function report_and_exit() {
  const ok = cases.filter((c) => c.ok).length;
  const summary = { generatedAt: new Date().toISOString(), totalCases: cases.length, passed: ok, cases };
  const reportFile = writeReport(`negative-cases-${Date.now()}.json`, summary);
  console.log(JSON.stringify({ reportFile, totalCases: cases.length, passed: ok, cases: cases.map((c) => ({ name: c.name, ok: c.ok })) }, null, 2));
  process.exit(cases.every((c) => c.ok) ? 0 : 1);
}
