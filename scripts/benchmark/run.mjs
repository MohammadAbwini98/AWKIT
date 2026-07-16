/**
 * Cross-platform launcher for the real-ExecutionEngine benchmarks. Sets the env every benchmark needs
 * BEFORE the engine's modules load (the origin/account semaphore capacities and the electron-stub tsconfig
 * are read at import time), then runs the target script under tsx.
 *
 *   node scripts/benchmark/run.mjs scripts/benchmark-engine-abcd.mts [args…]
 *
 * Env is only defaulted (never overridden), so callers can still tune e.g. AWKIT_BENCH_HOLD_MS.
 * - PRODUCTION_OFFLINE=false        → use Playwright-managed Chromium (dev), not the packaged bundle
 * - AWKIT_TRACE_MODE=off            → no per-step traces (removes overhead + noise from measurements)
 * - AWKIT_MAX_PER_ORIGIN/ACCOUNT=64 → the mock uses ONE origin; lift the per-origin cap so the browser
 *                                     pool / context slots are the binding constraint (production hits
 *                                     many origins). Governs globalResourceLocks, built at import time.
 * - TSX_TSCONFIG_PATH               → maps the bare `electron` specifier to the benchmark stub.
 */
import { spawn } from "node:child_process";

const target = process.argv[2];
if (!target) {
  console.error("usage: node scripts/benchmark/run.mjs <script.mts> [args…]");
  process.exit(2);
}

const env = {
  ...process.env,
  PRODUCTION_OFFLINE: process.env.PRODUCTION_OFFLINE ?? "false",
  AWKIT_TRACE_MODE: process.env.AWKIT_TRACE_MODE ?? "off",
  AWKIT_MAX_PER_ORIGIN: process.env.AWKIT_MAX_PER_ORIGIN ?? "64",
  AWKIT_MAX_PER_ACCOUNT: process.env.AWKIT_MAX_PER_ACCOUNT ?? "64",
  TSX_TSCONFIG_PATH: process.env.TSX_TSCONFIG_PATH ?? "scripts/benchmark/tsconfig.bench.json"
};

const child = spawn("npx", ["tsx", target, ...process.argv.slice(3)], { stdio: "inherit", env, shell: true });
child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (err) => { console.error(err); process.exit(1); });
