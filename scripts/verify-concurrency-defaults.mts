// Verifies the shipped concurrency DEFAULTS + the ENFORCED shared-pool → weighted-admission dependency
// (src/runner/concurrency/ConcurrencyConfig.ts loadConcurrencyLimits + resolveWeightedAdmission):
//   - shared browser pool defaults ON
//   - A8 weighted admission DEFAULTS to the shared-pool state (never on independently — Config C is harmful)
//   - weighted admission can NEVER resolve ON while the pool is OFF — not by default and not even when
//     explicitly requested (Config C is unreachable through normal configuration; Phase 02)
//   - the invalid explicit combo (pool OFF + weights=true) forces weights OFF and emits one diagnostic
//   - an explicit AWKIT_WORKLOAD_WEIGHTS=false is still honoured while the pool is ON
//   - AWKIT_SHARED_BROWSER_POOL can turn the pool off
//
// Pure — no Electron. Run: npx tsx scripts/verify-concurrency-defaults.mts
import {
  loadConcurrencyLimits,
  resolveWeightedAdmission,
  WEIGHTED_ADMISSION_REQUIRES_POOL_DIAGNOSTIC
} from "../src/runner/concurrency/ConcurrencyConfig";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "  [PASS]" : "  [FAIL]"} ${name}${detail ? ` -- ${detail}` : ""}`);
}

const POOL = "AWKIT_SHARED_BROWSER_POOL";
const WEIGHTS = "AWKIT_WORKLOAD_WEIGHTS";

// Tap console.warn from the top so the (process-deduped) pool/weights diagnostic is observed no matter
// which section first triggers it. Still forwards to the real warn so output is visible.
const capturedWarnings: string[] = [];
const realWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  capturedWarnings.push(args.join(" "));
  realWarn(...args);
};

/** Resolve limits with an exact env snapshot for the two flags (undefined = variable unset). */
function resolve(env: { pool?: string; weights?: string }): { pool: boolean; weights: boolean } {
  const savedPool = process.env[POOL];
  const savedWeights = process.env[WEIGHTS];
  if (env.pool === undefined) delete process.env[POOL]; else process.env[POOL] = env.pool;
  if (env.weights === undefined) delete process.env[WEIGHTS]; else process.env[WEIGHTS] = env.weights;
  try {
    const limits = loadConcurrencyLimits();
    return { pool: limits.useSharedBrowserPool, weights: limits.workloadWeights };
  } finally {
    if (savedPool === undefined) delete process.env[POOL]; else process.env[POOL] = savedPool;
    if (savedWeights === undefined) delete process.env[WEIGHTS]; else process.env[WEIGHTS] = savedWeights;
  }
}

console.log("Concurrency defaults + shared-pool/weighted-admission dependency:\n");

// 1. Shipped defaults (no env): both ON.
{
  const r = resolve({});
  check("default (no env): shared pool ON", r.pool === true, `pool=${r.pool}`);
  check("default (no env): weighted admission ON (follows pool)", r.weights === true, `weights=${r.weights}`);
}

// 2. The two required dependency examples.
{
  const r = resolve({ pool: "true" });
  check("pool=true, weights unspecified → weights=true", r.pool === true && r.weights === true, `pool=${r.pool} weights=${r.weights}`);
}
{
  const r = resolve({ pool: "false" });
  check("pool=false, weights unspecified → weights=false", r.pool === false && r.weights === false, `pool=${r.pool} weights=${r.weights}`);
}

// 3. Weighted admission never becomes a default independent of the pool.
{
  const r = resolve({ pool: "false" });
  check("weights never defaults ON while pool is OFF", r.weights === false, `weights=${r.weights}`);
}

// 4. Explicit operator overrides: weights=false always honoured when pool ON; weights=true is REFUSED
//    when the pool is OFF (Config C is unreachable — Phase 02).
{
  const r = resolve({ pool: "true", weights: "false" });
  check("explicit weights=false disables weights even with pool ON", r.pool === true && r.weights === false, `pool=${r.pool} weights=${r.weights}`);
}
{
  const r = resolve({ pool: "false", weights: "true" });
  check("explicit weights=true is FORCED OFF while pool OFF (Config C unreachable)", r.pool === false && r.weights === false, `pool=${r.pool} weights=${r.weights}`);
}
{
  const r = resolve({ pool: "true", weights: "true" });
  check("explicit weights=true with pool ON stays ON", r.pool === true && r.weights === true, `pool=${r.pool} weights=${r.weights}`);
}

// 5. Pool off-switch accepts the documented falsey spellings.
for (const off of ["0", "false", "no", "off"]) {
  const r = resolve({ pool: off });
  check(`AWKIT_SHARED_BROWSER_POOL=${off} turns the pool OFF (and weights follow)`, r.pool === false && r.weights === false, `pool=${r.pool} weights=${r.weights}`);
}
// 6. Truthy spelling keeps it on.
{
  const r = resolve({ pool: "1" });
  check("AWKIT_SHARED_BROWSER_POOL=1 keeps the pool ON", r.pool === true && r.weights === true, `pool=${r.pool} weights=${r.weights}`);
}

// 7. resolveWeightedAdmission unit truth table (the single authoritative rule) + diagnostic.
{
  const a = resolveWeightedAdmission({ useSharedBrowserPool: true, requestedWeights: true, weightsExplicit: false });
  check("resolver: pool ON + weights ON → ON, no diagnostic", a.workloadWeights === true && a.diagnostic === undefined);
  const b = resolveWeightedAdmission({ useSharedBrowserPool: true, requestedWeights: false, weightsExplicit: true });
  check("resolver: pool ON + weights=false → OFF, no diagnostic", b.workloadWeights === false && b.diagnostic === undefined);
  const c = resolveWeightedAdmission({ useSharedBrowserPool: false, requestedWeights: true, weightsExplicit: false });
  check("resolver: pool OFF + weights followed → OFF, no diagnostic (implicit)", c.workloadWeights === false && c.diagnostic === undefined);
  const d = resolveWeightedAdmission({ useSharedBrowserPool: false, requestedWeights: true, weightsExplicit: true });
  check(
    "resolver: pool OFF + explicit weights=true → OFF + diagnostic",
    d.workloadWeights === false && d.diagnostic === WEIGHTED_ADMISSION_REQUIRES_POOL_DIAGNOSTIC,
    JSON.stringify(d)
  );
}

// 8. loadConcurrencyLimits emits the searchable diagnostic for the invalid explicit combo. Sections 4/6
//    above already resolve pool=false+weights=true through loadConcurrencyLimits, so the (deduped)
//    diagnostic must have been captured by the top-level warn tap.
check(
  "loadConcurrencyLimits emits the searchable pool/weights diagnostic",
  capturedWarnings.some((w) => w.includes(WEIGHTED_ADMISSION_REQUIRES_POOL_DIAGNOSTIC)),
  JSON.stringify(capturedWarnings)
);

const passed = results.filter((r) => r.pass).length;
console.log(`\nConcurrency defaults: ${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
