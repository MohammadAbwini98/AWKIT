/**
 * The rebuild lifecycle, run through the REAL generation runtime.
 *
 *   SemanticIndexRuntime -> SemanticRebuildOrchestrator -> generation filesystem ->
 *   ZvecSemanticStore -> ZvecUtilityHostManager -> Electron utilityProcess -> raw host -> Zvec
 *
 * `verify:semantic-rebuild` proves the orchestration LOGIC against in-memory stores and a
 * generation-lifecycle stub. A stub cannot fail the way the real thing fails: it holds no RocksDB
 * lock, refuses no path outside the approved root, never leaves a candidate half-written, and never
 * has its process killed mid-write. Everything this verifier covers is a property that only becomes
 * observable once the real filesystem and the real native host are in the loop.
 *
 * The cases that matter most are the ones AFTER the pointer swap. The swap is the commit point, so a
 * failure past it must never revert the pointer or resume writing to the superseded generation — and
 * "must never" is only worth asserting against the real activation path.
 *
 * Implementation note: it reuses `scripts/zvec-harness/harnessMain.ts` (mode `rebuild`) rather than
 * introducing a second Electron harness — a bare `electron <script>` never reaches `app.whenReady()`
 * in this environment, so the app-directory form is the only invocation that works.
 *
 * Run: npx tsx scripts/verify-semantic-rebuild-live.mts
 */

import { build } from "esbuild";
import { _electron as electron } from "playwright";
import { createHash } from "node:crypto";
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

function sha256(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/**
 * Resolve a host tree byte-identical to the CURRENT host source.
 *
 * A stale tree is the dangerous direction of error: it reports a confident PASS for code that was
 * never built. The packaged tree is preferred when current, because only that layout proves what ships.
 */
function resolveHostTree(): { hostPath: string; source: string } | null {
  const repoHost = path.join(ROOT, "native-hosts", "zvec", "zvec-host.cjs");
  const expected = sha256(repoHost);

  const override = process.env.AWKIT_ZVEC_LIVE_HOST_PATH;
  if (override) {
    if (!fs.existsSync(override)) {
      console.error(`AWKIT_ZVEC_LIVE_HOST_PATH does not exist: ${override}`);
      process.exit(1);
    }
    const stale = sha256(override) !== expected;
    return { hostPath: override, source: `override${stale ? " (STALE — differs from native-hosts/zvec/zvec-host.cjs)" : ""}` };
  }

  const candidates = [
    {
      hostPath: path.join(ROOT, "dist", "win-unpacked", "resources", "native-hosts", "zvec", "zvec-host.cjs"),
      source: "packaged (dist/win-unpacked)"
    },
    { hostPath: path.join(ROOT, "build", "native-hosts", "zvec", "zvec-host.cjs"), source: "staged (build/native-hosts)" }
  ];

  const stale: string[] = [];
  for (const candidate of candidates) {
    const moduleRoot = path.join(path.dirname(candidate.hostPath), "node_modules", "@zvec", "zvec");
    if (!fs.existsSync(candidate.hostPath) || !fs.existsSync(moduleRoot)) continue;
    if (sha256(candidate.hostPath) !== expected) {
      stale.push(candidate.source);
      continue;
    }
    return candidate;
  }

  if (stale.length > 0) {
    console.error(`Every available host tree is STALE (${stale.join(", ")}) — it does not match native-hosts/zvec/zvec-host.cjs.`);
    console.error("Refusing to verify a host that is not the current source; a stale tree can report a PASS for code that was never built.");
    console.error("Run `npm run prepare:zvec-host` (staged) or `npm run package:portable` (packaged), then re-run.");
  }
  return null;
}

async function buildHarness(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-zvec-rebuild-harness-"));
  await build({
    entryPoints: [path.join(ROOT, "scripts", "zvec-harness", "harnessMain.ts")],
    outfile: path.join(dir, "main.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    // `@zvec` must not be bundled and must not even resolve from the main process — only the forked
    // host may load it. Bundling it is what caused the Phase 0B hard crash.
    external: ["electron", "@zvec/zvec"],
    alias: { "@main": path.join(ROOT, "app", "main"), "@src": path.join(ROOT, "src") },
    logLevel: "silent"
  });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "awkit-zvec-rebuild-harness", version: "0.0.0", main: "main.cjs" }, null, 2)
  );
  return dir;
}

interface HarnessReport {
  mode: string;
  ok: boolean;
  isPackaged?: boolean;
  steps: Array<{ label: string; ok: boolean; durationMs: number; detail?: unknown; error?: string }>;
  contract?: { total: number; failed: number; failures: Array<{ label: string; detail?: string }> };
  statusAfter?: Record<string, unknown>;
  log?: string[];
}

async function runHarness(harnessDir: string, hostPath: string, runtimeRoot: string, timeoutMs = 900_000): Promise<HarnessReport | null> {
  const reportPath = path.join(harnessDir, "report-rebuild.json");
  fs.rmSync(reportPath, { force: true });

  const app = await electron.launch({
    args: [harnessDir],
    env: {
      ...process.env,
      AWKIT_HARNESS_MODE: "rebuild",
      AWKIT_HARNESS_HOST_PATH: hostPath,
      AWKIT_HARNESS_RUNTIME_ROOT: runtimeRoot,
      AWKIT_HARNESS_REPORT: reportPath
    },
    timeout: 60_000
  });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !fs.existsSync(reportPath)) {
    await new Promise((r) => setTimeout(r, 500));
  }
  await app.close().catch(() => undefined);

  if (!fs.existsSync(reportPath)) return null;
  return JSON.parse(fs.readFileSync(reportPath, "utf8")) as HarnessReport;
}

// ─────────────────────────────────────────────────────────────────────────────

const tree = resolveHostTree();
if (!tree) {
  console.error("No usable Zvec native-host tree found.");
  console.error("Run `npm run prepare:zvec-host` (staged) or `npm run package:portable` (packaged) first.");
  process.exit(1);
}

console.log(`Rebuild lifecycle against the REAL generation runtime\n  host source: ${tree.source}\n  host: ${tree.hostPath}\n`);
if (!tree.source.startsWith("packaged")) {
  console.log("  ! Not the packaged tree — the shipped layout is NOT verified by this run.\n");
}

const harnessDir = await buildHarness();
const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-zvec-rebuild-"));

try {
  const report = await runHarness(harnessDir, tree.hostPath, runtimeRoot);

  if (!report) {
    check("the harness produced a report", false, "no report file was written before the timeout");
  } else {
    check("the harness ran in a real Electron application process", report.isPackaged !== undefined);
    for (const s of report.steps) {
      check(`${s.label} (${s.durationMs} ms)`, s.ok, s.error);
    }

    if (report.contract) {
      check(
        `every lifecycle assertion passed against the real runtime (${report.contract.total} checks)`,
        report.contract.failed === 0,
        report.contract.failures.map((f) => `${f.label}${f.detail ? ` [${f.detail}]` : ""}`).slice(0, 8).join(" | ")
      );
      // A scenario set that stopped early would otherwise "pass" silently. 68 is the measured full
      // assertion count, not an estimate: if this trips, count the assertions
      // before touching it — a count that GREW means raise the floor, a count that SHRANK is the
      // truncation this guard exists to catch.
      check("the lifecycle suite executed its full set of assertions", report.contract.total >= 68, String(report.contract.total));
    } else {
      check("the harness reported lifecycle results", false, "no results block in the report");
    }

    if (report.log && report.log.length > 0) {
      const leaked = report.log.filter((l) => /[A-Za-z]:\\/.test(l) && !l.includes("***"));
      check("diagnostics leak no unmasked absolute paths", leaked.length === 0, leaked.slice(0, 2).join(" | "));
    }

    // Failures here are usually a host-level reason mapped to a stable code, which leaves a category
    // rather than a cause. The harness log carries the reason, so print it instead of making the next
    // person re-instrument this.
    if (report.steps.some((s) => !s.ok) || (report.contract?.failed ?? 0) > 0) {
      console.log("\n  Harness log (diagnostics for the failures above):");
      const log = report.log ?? [];
      // Every FAIL line plus the tail. A tail alone loses the earliest failure, which is usually the
      // one that caused all the others.
      const failures = log.filter((l) => l.startsWith("FAIL") || l.startsWith("diag:"));
      for (const line of failures) console.log(`    ${line}`);
      console.log("    ---");
      for (const line of log.slice(-30)) console.log(`    ${line}`);
    }
  }
} finally {
  for (const dir of [harnessDir, runtimeRoot]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* a leftover temp directory is not a verification failure */
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
