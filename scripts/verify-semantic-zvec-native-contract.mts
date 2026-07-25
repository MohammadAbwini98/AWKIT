/**
 * The shared `SemanticStore` contract, run through the REAL production path.
 *
 *   ZvecSemanticStore -> ZvecUtilityHostManager -> Electron utilityProcess -> raw packaged host -> Zvec
 *
 * Every other semantic verifier drives the adapter through `FakeZvecHostTransport`, which proves
 * adapter translation and says nothing about the host's own code — its independently duplicated filter
 * builder, its two-pass exact-total query, its post-delete re-scan. Those were previously asserted
 * only by scanning the host's source TEXT, which cannot catch a runtime disagreement.
 *
 * That gap has already produced defects. The fake once encoded the protocol as INTENDED while the host
 * implemented something else, and three bugs survived a fully green suite: an explicit `null` that the
 * binding rejects outright, a `fetch` returning bare id strings while the adapter read `.id`, and a
 * schema using `type` where the host reads `dataType`. This verifier is what makes that class of
 * divergence detectable, because both sides are the real ones.
 *
 * Implementation note: it reuses `scripts/zvec-harness/harnessMain.ts` (mode `store`) rather than
 * introducing a second Electron harness — a bare `electron <script>` never reaches `app.whenReady()`
 * in this environment, so the app-directory form is the only invocation that works.
 *
 * Run: npx tsx scripts/verify-semantic-zvec-native-contract.mts
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
 * Resolve a host tree that is byte-identical to the CURRENT host source.
 *
 * The staleness check is not housekeeping — it is what makes the result mean anything. On the first
 * run this verifier picked `dist/win-unpacked`, which still held the previous protocol-v1 host, and
 * so tested code that no longer exists. That direction of error is the dangerous one: a stale tree
 * whose behaviour happens to match would report a confident PASS for a host that was never built.
 *
 * Packaged is still preferred when it is current, because only that layout proves what ships.
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
    // An explicit override is honoured, but staleness is still reported rather than hidden.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-zvec-store-harness-"));
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
    JSON.stringify({ name: "awkit-zvec-store-harness", version: "0.0.0", main: "main.cjs" }, null, 2)
  );
  return dir;
}

interface HarnessReport {
  mode: string;
  ok: boolean;
  isPackaged?: boolean;
  steps: Array<{ label: string; ok: boolean; durationMs: number; detail?: unknown; error?: string }>;
  contract?: { total: number; failed: number; failures: Array<{ label: string; detail?: string }> };
  hostPid?: number | null;
  statusAfter?: Record<string, unknown>;
  log?: string[];
}

async function runHarness(harnessDir: string, hostPath: string, runtimeRoot: string, timeoutMs = 600_000): Promise<HarnessReport | null> {
  const reportPath = path.join(harnessDir, "report-store.json");
  fs.rmSync(reportPath, { force: true });

  const app = await electron.launch({
    args: [harnessDir],
    env: {
      ...process.env,
      AWKIT_HARNESS_MODE: "store",
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

/** Whether a pid is still alive. `kill(pid, 0)` signals nothing; it only probes existence. */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

const tree = resolveHostTree();
if (!tree) {
  console.error("No usable Zvec native-host tree found.");
  console.error("Run `npm run prepare:zvec-host` (staged) or `npm run package:portable` (packaged) first.");
  process.exit(1);
}

console.log(`Semantic store contract against the REAL native host\n  host source: ${tree.source}\n  host: ${tree.hostPath}\n`);
if (!tree.source.startsWith("packaged")) {
  console.log("  ! Not the packaged tree — the shipped layout is NOT verified by this run.\n");
}

const harnessDir = await buildHarness();
const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-zvec-store-"));

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
        `the shared contract suite passes against the real host (${report.contract.total} checks)`,
        report.contract.failed === 0,
        report.contract.failures.map((f) => f.label).slice(0, 8).join(" | ")
      );
      // A suite that ran zero checks — or stopped early — would otherwise "pass" silently.
      //
      // 68 is the MEASURED full size of `runSemanticStoreContract` for a store advertising
      // `entityOperations`, not an estimate: the earlier `>= 100` was written before this verifier had
      // ever been executed and failed a suite that had in fact run completely. If this check fails
      // again, confirm the suite's real size before touching the number — a count that has GROWN means
      // the floor should be raised, and a count that has SHRUNK is the truncation this guard exists to
      // catch. Lowering it to match the observed value is always the wrong fix.
      check("the contract suite executed its full set of checks", report.contract.total >= 68, String(report.contract.total));
    } else {
      check("the harness reported contract results", false, "no contract block in the report");
    }

    // A graceful dispose that leaves the utility process running is not graceful. Checked from OUTSIDE
    // the harness, because a process cannot credibly certify its own children are gone.
    if (typeof report.hostPid === "number") {
      check(`the utility host process (pid ${report.hostPid}) is gone after dispose`, !pidAlive(report.hostPid));
    } else {
      check("the harness reported the host pid so orphan detection is possible", false, String(report.hostPid));
    }

    if (report.log && report.log.length > 0) {
      const masked = report.log.filter((l) => /[A-Za-z]:\\/.test(l) && !l.includes("***"));
      check("host diagnostics leak no unmasked absolute paths", masked.length === 0, masked.slice(0, 2).join(" | "));
    }

    // The store maps host failures onto stable codes, which is correct for production but leaves a
    // failing run with a category instead of a cause. The host's own log lines carry the reason, so
    // print them when something failed rather than making the next person re-instrument this.
    if (report.steps.some((s) => !s.ok)) {
      console.log("\n  Host log (diagnostics for the failures above):");
      for (const line of (report.log ?? []).slice(-25)) console.log(`    ${line}`);
      const failedDetails = report.steps.filter((s) => !s.ok).map((s) => `${s.label}: ${s.error ?? ""}`);
      console.log("\n  Failed steps:");
      for (const line of failedDetails) console.log(`    ${line}`);
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
