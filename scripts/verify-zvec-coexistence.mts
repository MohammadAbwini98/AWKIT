/**
 * Playwright coexistence re-run, focused on the case Phase 0D left INCONCLUSIVE.
 *
 * Scenario 4 there ran a large indexing batch (330 MB utility RSS proved real work happened) but its
 * counters never published, because the collection close after a huge insert exceeded the harness's
 * wait window. So the workflow result was valid while the Zvec-side quantification was not — a
 * "no impact" claim resting on unmeasured load.
 *
 * This re-run fixes both halves:
 *  - the batch harness gets a close budget sized for the workload and MEASURES it, so the previously
 *    missing numbers become numbers;
 *  - the workflow (AWKIT's real runner against its own mock site) runs concurrently, and the report
 *    only claims "no impact" alongside proof the disturbance actually occurred.
 *
 * Run: npx tsx scripts/verify-zvec-coexistence.mts
 */

import { build } from "esbuild";
import { _electron as electron } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
let failed = 0;

function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function resolveHostPath(): string | null {
  for (const candidate of [
    path.join(ROOT, "dist", "win-unpacked", "resources", "native-hosts", "zvec", "zvec-host.cjs"),
    path.join(ROOT, "build", "native-hosts", "zvec", "zvec-host.cjs")
  ]) {
    if (fs.existsSync(candidate) && fs.existsSync(path.join(path.dirname(candidate), "node_modules", "@zvec", "zvec"))) {
      return candidate;
    }
  }
  return null;
}

async function buildHarness(dir: string): Promise<void> {
  await build({
    entryPoints: [path.join(ROOT, "scripts", "zvec-harness", "harnessMain.ts")],
    outfile: path.join(dir, "main.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["electron", "@zvec/zvec"],
    alias: { "@main": path.join(ROOT, "app", "main"), "@src": path.join(ROOT, "src") },
    logLevel: "silent"
  });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "awkit-coex", version: "0.0.0", main: "main.cjs" }));
}

/** Run the real runner verifier and return its duration and pass/fail counts. */
function runWorkflow(logFile: string): Promise<{ code: number | null; durationMs: number; passed: number; failed: number }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const out = fs.createWriteStream(logFile);
    const child = spawn("npx", ["tsx", "scripts/verify-runner.mts"], { cwd: ROOT, shell: true });
    child.stdout.pipe(out);
    child.stderr.pipe(out);
    child.on("close", (code) => {
      out.end();
      const text = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
      const m = text.match(/(\d+)\s+passed,\s+(\d+)\s+failed/);
      resolve({
        code,
        durationMs: Date.now() - started,
        passed: m ? Number(m[1]) : 0,
        failed: m ? Number(m[2]) : 0
      });
    });
  });
}

const hostPath = resolveHostPath();
if (!hostPath) {
  console.error("No usable Zvec native-host tree. Run `npm run prepare:zvec-host` or `npm run package:portable` first.");
  process.exit(1);
}

const harnessDir = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-coex-harness-"));
const tmpDirs = [harnessDir];
await buildHarness(harnessDir);

console.log("Zvec / Playwright coexistence\n");

try {
  // ── baseline: workflow alone ──
  console.log("Baseline (no Zvec activity):");
  const baselineLog = path.join(harnessDir, "runner-baseline.log");
  const baseline = await runWorkflow(baselineLog);
  check(`workflow passes alone (${baseline.passed} passed, ${baseline.failed} failed)`, baseline.code === 0 && baseline.failed === 0);
  console.log(`    duration ${(baseline.durationMs / 1000).toFixed(2)} s`);

  // ── under a large indexing batch: the Phase 0D scenario-4 re-run ──
  console.log("\nUnder a large indexing batch (Phase 0D scenario 4 re-run):");
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-coex-root-"));
  tmpDirs.push(runtimeRoot);
  const reportPath = path.join(harnessDir, "report-batch.json");
  fs.rmSync(reportPath, { force: true });

  const app = await electron.launch({
    args: [harnessDir],
    env: {
      ...process.env,
      AWKIT_HARNESS_MODE: "batch",
      AWKIT_HARNESS_HOST_PATH: hostPath,
      AWKIT_HARNESS_RUNTIME_ROOT: runtimeRoot,
      AWKIT_HARNESS_REPORT: reportPath,
      AWKIT_HARNESS_BATCHES: "24",
      AWKIT_HARNESS_BATCH_SIZE: "500"
    },
    timeout: 60_000
  });

  // Let the batch load actually get going before the workflow starts, so they genuinely overlap
  // rather than the workflow finishing against an idle host.
  await new Promise((r) => setTimeout(r, 6_000));

  const underLoadLog = path.join(harnessDir, "runner-under-load.log");
  const underLoad = await runWorkflow(underLoadLog);

  // Wait for the harness to publish its counters — the exact step that failed in Phase 0D.
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline && !fs.existsSync(reportPath)) {
    await new Promise((r) => setTimeout(r, 500));
  }
  await app.close().catch(() => undefined);

  check(`workflow still passes under load (${underLoad.passed} passed, ${underLoad.failed} failed)`, underLoad.code === 0 && underLoad.failed === 0);
  check("workflow pass count is unchanged by Zvec activity", underLoad.passed === baseline.passed, `${underLoad.passed} vs ${baseline.passed}`);

  const deltaPct = baseline.durationMs > 0 ? ((underLoad.durationMs - baseline.durationMs) / baseline.durationMs) * 100 : 0;
  console.log(`    duration ${(underLoad.durationMs / 1000).toFixed(2)} s  (${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}% vs baseline)`);

  // The point of the re-run: the counters must exist this time.
  check("the batch harness published its counters (Phase 0D could not)", fs.existsSync(reportPath));
  if (fs.existsSync(reportPath)) {
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as {
      ok: boolean;
      counters: { batches: number; docsWritten: number; errors: number };
      steps: Array<{ label: string; ok: boolean; durationMs: number; detail?: unknown; error?: string }>;
    };
    for (const s of report.steps) check(`  batch harness: ${s.label}`, s.ok, s.error);
    console.log(`    counters: ${JSON.stringify(report.counters)}`);
    check("real indexing work occurred during the workflow", report.counters.docsWritten > 0, JSON.stringify(report.counters));
    check("no batch errors", report.counters.errors === 0, `${report.counters.errors} errors`);

    const close = report.steps.find((s) => s.label === "closeAfterLargeBatch");
    check("the close that timed out in Phase 0D now completes and is measured", Boolean(close?.ok), close?.error);
    if (close?.detail) console.log(`    close after large batch: ${JSON.stringify(close.detail)}`);

    // Acceptance is about the workflow, not raw Zvec speed. 25% is a deliberately loose ceiling: the
    // load here is far heavier than any realistic indexing rate.
    check(`workflow slowdown is within 25% (${deltaPct.toFixed(1)}%)`, deltaPct < 25);
  }
} finally {
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* disposable */
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
