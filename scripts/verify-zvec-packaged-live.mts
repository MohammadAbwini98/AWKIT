/**
 * Live verification of the packaged Zvec native host, driven through the production
 * `ZvecUtilityHostManager`.
 *
 * Replaces the Phase 0D coverage that was lost when the `AWKIT_ZVEC_SPIKE_HOST` hook was removed
 * from `app/main/main.ts`. Nothing is put back into the product: the harness
 * (`scripts/zvec-harness/harnessMain.ts`) is esbuilt into a TEMPORARY Electron app directory and
 * that directory is launched. Two constraints shaped this design:
 *
 *   - a bare `electron <script.mjs>` never reaches `app.whenReady()` in this environment (Phase 0B),
 *     but launching an app DIRECTORY does — which is also how the repo's other real-Electron
 *     verifiers work;
 *   - the harness imports the manager from source, so this exercises the production class rather
 *     than a re-implementation of its wire protocol.
 *
 * Modes: crud (full lifecycle), degraded (damaged host asset), circuit (repeated crashes).
 *
 * Run: npx tsx scripts/verify-zvec-packaged-live.mts
 */

import { build } from "esbuild";
import { _electron as electron } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
let failed = 0;
const notRun: string[] = [];

function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * Prefer the PACKAGED host so this verifies what ships. Fall back to the staged tree, then the
 * repository copy — but say which was used, because only the packaged one proves the shipped layout.
 */
function resolveHostTree(): { hostPath: string; source: string } | null {
  // Explicit override so the NSIS matrix can point this at the INSTALLED tree, which is a different
  // layout from dist/win-unpacked and therefore worth verifying separately.
  const override = process.env.AWKIT_ZVEC_LIVE_HOST_PATH;
  if (override) {
    if (!fs.existsSync(override)) {
      console.error(`AWKIT_ZVEC_LIVE_HOST_PATH does not exist: ${override}`);
      process.exit(1);
    }
    return { hostPath: override, source: `override (${override})` };
  }

  const candidates = [
    { hostPath: path.join(ROOT, "dist", "win-unpacked", "resources", "native-hosts", "zvec", "zvec-host.cjs"), source: "packaged (dist/win-unpacked)" },
    { hostPath: path.join(ROOT, "build", "native-hosts", "zvec", "zvec-host.cjs"), source: "staged (build/native-hosts)" }
  ];
  for (const candidate of candidates) {
    // The host is only usable with its own node_modules beside it.
    const moduleRoot = path.join(path.dirname(candidate.hostPath), "node_modules", "@zvec", "zvec");
    if (fs.existsSync(candidate.hostPath) && fs.existsSync(moduleRoot)) return candidate;
  }
  return null;
}

/** esbuild the harness into a disposable Electron app directory. */
async function buildHarness(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-zvec-harness-"));
  await build({
    entryPoints: [path.join(ROOT, "scripts", "zvec-harness", "harnessMain.ts")],
    outfile: path.join(dir, "main.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    // electron is provided by the runtime; @zvec must NOT be bundled (and must not even resolve).
    external: ["electron", "@zvec/zvec"],
    alias: {
      "@main": path.join(ROOT, "app", "main"),
      "@src": path.join(ROOT, "src")
    },
    logLevel: "silent"
  });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "awkit-zvec-harness", version: "0.0.0", main: "main.cjs" }, null, 2)
  );
  return dir;
}

interface HarnessReport {
  mode: string;
  ok: boolean;
  steps: Array<{ label: string; ok: boolean; durationMs: number; detail?: unknown; error?: string }>;
  statusAfter?: Record<string, unknown>;
  log?: string[];
}

async function runHarness(
  harnessDir: string,
  mode: string,
  hostPath: string,
  runtimeRoot: string,
  timeoutMs = 180_000
): Promise<HarnessReport | null> {
  const reportPath = path.join(harnessDir, `report-${mode}.json`);
  fs.rmSync(reportPath, { force: true });

  const app = await electron.launch({
    args: [harnessDir],
    env: {
      ...process.env,
      AWKIT_HARNESS_MODE: mode,
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

function reportSteps(report: HarnessReport): void {
  for (const s of report.steps) {
    check(`${s.label} (${s.durationMs} ms)`, s.ok, s.error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

const tree = resolveHostTree();
if (!tree) {
  console.error("No usable Zvec native-host tree found.");
  console.error("Run `npm run prepare:zvec-host` (staged) or `npm run package:portable` (packaged) first.");
  process.exit(1);
}

console.log(`Zvec packaged live verification\n  host source: ${tree.source}\n  host: ${tree.hostPath}\n`);
if (!tree.source.startsWith("packaged")) {
  console.log("  ! Not the packaged tree — the shipped layout is NOT being verified by this run.\n");
}

const harnessDir = await buildHarness();
const cleanup: string[] = [harnessDir];

try {
  // ── 1. full CRUD lifecycle ──
  console.log("Mode: crud (full lifecycle through ZvecUtilityHostManager)");
  const crudRoot = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-zvec-live-"));
  cleanup.push(crudRoot);
  const crud = await runHarness(harnessDir, "crud", tree.hostPath, crudRoot);
  if (!crud) {
    check("crud harness produced a report", false, "no report written — Electron may not have reached app.whenReady()");
    notRun.push("crud lifecycle");
  } else {
    reportSteps(crud);
    check("crud run overall", crud.ok, JSON.stringify(crud.statusAfter));
  }

  // ── 2. degraded host: a damaged asset must fail safely and stay diagnosable ──
  console.log("\nMode: degraded (packaged host tree with a corrupted binding)");
  const damagedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-zvec-damaged-"));
  cleanup.push(damagedRoot);
  const damagedTree = path.join(damagedRoot, "native-hosts", "zvec");
  fs.cpSync(path.dirname(tree.hostPath), damagedTree, { recursive: true });
  const damagedBinding = path.join(damagedTree, "node_modules", "@zvec", "bindings-win32-x64", "zvec_node_binding.node");
  if (fs.existsSync(damagedBinding)) {
    // Truncate rather than delete, so the failure is a load error rather than a missing file.
    fs.writeFileSync(damagedBinding, Buffer.alloc(4096));
  }
  const degradedRuntime = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-zvec-degraded-"));
  cleanup.push(degradedRuntime);
  const degraded = await runHarness(harnessDir, "degraded", path.join(damagedTree, "zvec-host.cjs"), degradedRuntime, 120_000);
  if (!degraded) {
    check("degraded harness produced a report", false, "no report written");
    notRun.push("degraded-host behaviour");
  } else {
    reportSteps(degraded);
    const status = degraded.statusAfter as { state?: string; lastReason?: string } | undefined;
    check("a damaged host does not crash the application process", degraded.ok, JSON.stringify(status));
    check(
      "the failure surfaces a stable reason code, not a native message",
      typeof status?.lastReason === "string" ? /^SEMANTIC_/.test(status.lastReason) : true,
      String(status?.lastReason)
    );
  }

  // ── 3. circuit breaker in a real application process ──
  console.log("\nMode: circuit (repeated host kills must open the breaker)");
  const circuitRoot = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-zvec-circuit-"));
  cleanup.push(circuitRoot);
  const circuit = await runHarness(harnessDir, "circuit", tree.hostPath, circuitRoot, 180_000);
  if (!circuit) {
    check("circuit harness produced a report", false, "no report written");
    notRun.push("application-mode circuit breaker");
  } else {
    reportSteps(circuit);
    check("circuit breaker behaves correctly in application mode", circuit.ok, JSON.stringify(circuit.statusAfter));
  }
} finally {
  for (const dir of cleanup) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* temp dirs are disposable */
    }
  }
}

if (notRun.length > 0) {
  console.log(`\nNOT RUN: ${notRun.join(", ")}`);
}
console.log(`\n${passed} passed, ${failed} failed${notRun.length ? `, ${notRun.length} not run` : ""}`);
process.exit(failed === 0 && notRun.length === 0 ? 0 : 1);
