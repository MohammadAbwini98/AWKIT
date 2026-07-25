/**
 * Verifies the semantic host's restart / circuit-breaker policy and the index layout's path
 * confinement.
 *
 * Both are pure and framework-agnostic on purpose, so this runs in plain Node with an injected
 * clock — no Electron, no native binding, no real process. That matters because the policy is the
 * part that must never be wrong: Phase 0D proved a native crash is contained, but nothing yet
 * proved AWKIT will stop restarting a host that keeps dying.
 *
 * Run: npx tsx scripts/verify-zvec-host-lifecycle.mts
 */

import { ZvecHostRestartPolicy } from "@src/semantic/ZvecHostRestartPolicy";
import {
  ZVEC_HOST_RESTART_POLICY,
  ZVEC_HOST_TIMEOUTS,
  isRetryableAfterHostExit
} from "@src/semantic/contracts/ZvecHostProtocol";
import {
  generationName,
  generationSequence,
  isConfinedGenerationPath,
  isGenerationName,
  semanticIndexLayout,
  defaultSemanticIndexMetadata
} from "@src/semantic/SemanticGenerationLayout";
import { join } from "node:path";

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

/** Controllable clock so window expiry is exercised deterministically. */
function clock(startMs = 1_000_000) {
  let t = startMs;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

console.log("Zvec host restart policy:\n");

// ── first exit restarts immediately ──
{
  const c = clock();
  const p = new ZvecHostRestartPolicy(c.now);
  const d = p.recordUnexpectedExit();
  check("first unexpected exit restarts", d.action === "restart", JSON.stringify(d));
  check("first restart has no back-off delay", d.action === "restart" && d.delayMs === 0);
  check("circuit stays closed after one exit", !p.isCircuitOpen());
}

// ── second exit restarts with back-off ──
{
  const c = clock();
  const p = new ZvecHostRestartPolicy(c.now);
  p.recordUnexpectedExit();
  c.advance(1_000);
  const d = p.recordUnexpectedExit();
  check("second exit inside the window still restarts", d.action === "restart", JSON.stringify(d));
  check(
    "second restart backs off so a crash loop cannot spin",
    d.action === "restart" && d.delayMs === ZVEC_HOST_RESTART_POLICY.restartDelayMs
  );
  check("circuit still closed after two exits", !p.isCircuitOpen());
}

// ── third exit opens the circuit ──
{
  const c = clock();
  const p = new ZvecHostRestartPolicy(c.now);
  p.recordUnexpectedExit();
  c.advance(1_000);
  p.recordUnexpectedExit();
  c.advance(1_000);
  const d = p.recordUnexpectedExit();
  check("third exit inside the window opens the circuit", d.action === "openCircuit", JSON.stringify(d));
  check("circuit reason is tooManyExits", d.action === "openCircuit" && d.reason === "tooManyExits");
  check("isCircuitOpen() reports open", p.isCircuitOpen());
  check("further exits are inert once open", p.recordUnexpectedExit().action === "none");
}

// ── the window actually slides ──
{
  const c = clock();
  const p = new ZvecHostRestartPolicy(c.now);
  p.recordUnexpectedExit();
  p.recordUnexpectedExit();
  // Step past the window: the earlier strikes must expire rather than accumulate forever.
  c.advance(ZVEC_HOST_RESTART_POLICY.windowMs + 1);
  const d = p.recordUnexpectedExit();
  check("strikes outside the window expire", d.action === "restart", JSON.stringify(d));
  check("strike count resets to 1 after the window passes", d.strikes === 1, `strikes=${d.strikes}`);
  check("circuit is not opened by exits spread beyond the window", !p.isCircuitOpen());
}

// ── intentional shutdown is never a strike ──
{
  const c = clock();
  const p = new ZvecHostRestartPolicy(c.now);
  for (let i = 0; i < 10; i += 1) p.recordIntentionalExit();
  check("ten intentional exits leave the circuit closed", !p.isCircuitOpen());
  check("intentional exits accrue no strikes", p.state().strikes === 0, `strikes=${p.state().strikes}`);
}

// ── a corrupt generation opens immediately and is quarantined ──
{
  const c = clock();
  const p = new ZvecHostRestartPolicy(c.now);
  const d = p.recordUnexpectedExit({ generation: "gen-000004", corruptGeneration: true });
  check("corrupt generation opens the circuit on the FIRST exit", d.action === "openCircuit", JSON.stringify(d));
  check("circuit reason is corruptGeneration", d.action === "openCircuit" && d.reason === "corruptGeneration");
  check("the offending generation is quarantined", p.isQuarantined("gen-000004"));
  check("an unrelated generation is not quarantined", !p.isQuarantined("gen-000001"));
}

// ── reset is the operator's escape hatch ──
{
  const c = clock();
  const p = new ZvecHostRestartPolicy(c.now);
  p.recordUnexpectedExit();
  p.recordUnexpectedExit();
  p.recordUnexpectedExit();
  check("circuit open before reset", p.isCircuitOpen());
  p.reset();
  check("reset closes the circuit", !p.isCircuitOpen());
  check("reset clears the strike count", p.state().strikes === 0);
  check("policy restarts again after reset", p.recordUnexpectedExit().action === "restart");
}

// ── retryability ──
console.log("\nRetry classification after a host exit:");
check("query is retryable", isRetryableAfterHostExit("query"));
check("fetch is retryable", isRetryableAfterHostExit("fetch"));
check("open is retryable", isRetryableAfterHostExit("open"));
for (const mutation of ["insert", "upsert", "update", "delete"] as const) {
  check(`${mutation} is NOT retryable (may have partially applied)`, !isRetryableAfterHostExit(mutation));
}

// ── path confinement ──
console.log("\nGeneration path confinement:");
const runtimeRoot = process.platform === "win32" ? "C:\\Users\\test\\AppData\\Local\\SpecterStudio" : "/home/test/.local/SpecterStudio";
const layout = semanticIndexLayout(runtimeRoot);

check("a well-formed generation is accepted", isConfinedGenerationPath(runtimeRoot, join(layout.generations, "gen-000001")));
check("the generations root itself is rejected", !isConfinedGenerationPath(runtimeRoot, layout.generations));
check("a sibling directory is rejected", !isConfinedGenerationPath(runtimeRoot, join(layout.root, "quarantine")));
check("traversal out of the root is rejected", !isConfinedGenerationPath(runtimeRoot, join(layout.generations, "..", "..", "escape")));
check("nesting below a generation is rejected", !isConfinedGenerationPath(runtimeRoot, join(layout.generations, "gen-000001", "sub")));
check("a non-generation name is rejected", !isConfinedGenerationPath(runtimeRoot, join(layout.generations, "arbitrary")));
check("an unrelated absolute path is rejected", !isConfinedGenerationPath(runtimeRoot, process.platform === "win32" ? "C:\\Windows\\System32" : "/etc"));
check("an empty path is rejected", !isConfinedGenerationPath(runtimeRoot, ""));
check("a package-resources path is rejected", !isConfinedGenerationPath(runtimeRoot, join("resources", "native-hosts", "zvec")));

console.log("\nGeneration naming:");
check("generationName pads to six digits", generationName(1) === "gen-000001", generationName(1));
check("generationName handles large sequences", generationName(123456) === "gen-123456");
check("names sort lexically in creation order", ["gen-000010", "gen-000002"].sort()[0] === "gen-000002");
check("generationSequence round-trips", generationSequence(generationName(42)) === 42);
check("generationSequence rejects a non-generation", generationSequence("quarantine") === null);
check("isGenerationName rejects a short form", !isGenerationName("gen-1"));
check("generationName rejects zero", (() => { try { generationName(0); return false; } catch { return true; } })());

console.log("\nMetadata defaults:");
const meta = defaultSemanticIndexMetadata();
check("a fresh index reports cleanShutdown=true", meta.cleanShutdown === true);
check("a fresh index has no active generation", meta.activeGeneration === null);
check("vector search is off by default (FTS-only Phase 1)", meta.vectorEnabled === false && meta.ftsEnabled === true);

console.log("\nTimeout sanity:");
check("close is bounded well inside the 2s shared quit budget", ZVEC_HOST_TIMEOUTS.closeCollectionMs <= 2_000);
check("graceful shutdown is bounded", ZVEC_HOST_TIMEOUTS.gracefulShutdownMs <= 2_000);
check("a query deadline is shorter than an open deadline", ZVEC_HOST_TIMEOUTS.queryMs < ZVEC_HOST_TIMEOUTS.openCollectionMs);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
