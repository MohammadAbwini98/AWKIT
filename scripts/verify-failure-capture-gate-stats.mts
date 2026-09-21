/**
 * verify:failure-capture-gate-stats — the L5a overhead gate's statistics and configuration rules
 * (`scripts/lib/failure-capture-gate.mts`), proven without a browser:
 *   - the median interval against an independent exact (BigInt) binomial for n = 0..80,
 *   - every PASS / FAIL / INCONCLUSIVE boundary, with negative controls,
 *   - the p95 eligibility rule, grounded in what `stats()` actually returns at 20 and 21 samples,
 *   - approved versus unsupported rounds/instances configurations and the exit code,
 *   - evidence appends that never replace or reorder earlier runs, and refuse an unreadable file,
 *   - the committed raw evidence: well formed, and every recorded binding verdict re-derivable from it.
 *
 * Run: npm run verify:failure-capture-gate-stats
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { stats } from "./benchmark/lib.mts";
import { appendEvidenceRun, APPROVED_GATE, gateConfiguration, gateExitCode, judgePaired, medianInterval, p95IsBinding, P95_MIN_SAMPLES, threeWayVerdict } from "./lib/failure-capture-gate.mts";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: unknown): void {
  if (condition) passed += 1;
  else failed += 1;
  const suffix = detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`;
  (condition ? console.log : console.error)(`  ${condition ? "✓" : "✗"} ${label}${suffix}`);
}

// ── Interval: an independent exact reference ─────────────────────────────────────────────────────
console.log("Median interval against an exact binomial reference");
{
  /** P(Bin(n, ½) ≤ j) as an exact numerator over 2^n. */
  const cdfNumerator = (n: number, j: number): bigint => {
    let sum = 0n;
    let c = 1n; // C(n, 0)
    for (let i = 0; i <= j; i += 1) {
      sum += c;
      c = (c * BigInt(n - i)) / BigInt(i + 1);
    }
    return sum;
  };
  const mismatches: unknown[] = [];
  let intervals = 0;
  for (let n = 0; n <= 80; n += 1) {
    const total = 1n << BigInt(n);
    // Largest k with P(X ≤ k − 1) ≤ 1/40, compared exactly: 40·numerator ≤ 2^n.
    let k = 0;
    while (k < n && 40n * cdfNumerator(n, k) <= total) k += 1;
    const values = Array.from({ length: n }, (_, i) => n - i); // 1..n, deliberately unsorted
    const got = medianInterval(values);
    if (k === 0) {
      if (got !== undefined) mismatches.push({ n, expected: "none", got });
      continue;
    }
    intervals += 1;
    const coverage = 1 - (2 * Number(cdfNumerator(n, k - 1))) / Number(total);
    const widerCoverage = 1 - (2 * Number(cdfNumerator(n, k))) / Number(total);
    if (!got || got.low !== k || got.high !== n - k + 1 || Math.abs(got.coverage - coverage) > 1e-12 || got.coverage < 0.95 || widerCoverage >= 0.95) {
      mismatches.push({ n, k, expected: [k, n - k + 1, coverage], got });
    }
  }
  check("for every n from 0 to 80 the interval is exactly [x(k), x(n+1−k)] with the largest k whose exact coverage is ≥ 95 %", mismatches.length === 0 && intervals === 75, mismatches.length ? mismatches.slice(0, 3) : `${intervals} intervals, n ≤ 5 have none`);

  const seven = medianInterval([70, 10, 40, 20, 60, 30, 50]);
  check("7 rounds (option B): [min, max] at 126/128 = 98.4 %", seven?.low === 10 && seven.high === 70 && Math.abs(seven.coverage - 126 / 128) < 1e-12, seven);
  const twentyOne = medianInterval(Array.from({ length: 21 }, (_, i) => 21 - i));
  check("21 rounds (option C): the 6th and 16th order statistics at 97.34 %", twentyOne?.low === 6 && twentyOne.high === 16 && Math.abs(twentyOne.coverage - (1 - (2 * 27896) / 2 ** 21)) < 1e-12, twentyOne);
  check("5 values admit no 95 % interval; 6 is the smallest count that does", medianInterval([1, 2, 3, 4, 5]) === undefined && medianInterval([1, 2, 3, 4, 5, 6])?.coverage === 62 / 64);

  const input = [3, Number.NaN, 1, Number.POSITIVE_INFINITY, 2, 6, 5, 4];
  const snapshot = [...input];
  const filtered = medianInterval(input);
  check("non-finite values are dropped (6 finite values remain) and the caller's array is not reordered", filtered?.low === 1 && filtered.high === 6 && input.every((value, i) => Object.is(value, snapshot[i])), filtered);
}

// ── Verdicts ─────────────────────────────────────────────────────────────────────────────────────
console.log("\nThree-way verdict boundaries and negative controls");
{
  check("PASS when the upper bound equals the ceiling", threeWayVerdict({ low: -40, high: 150 }, 150) === "PASS");
  check("PASS when the whole interval is below the ceiling", threeWayVerdict({ low: -40, high: 10 }, 150) === "PASS");
  check("FAIL when the lower bound is above the ceiling", threeWayVerdict({ low: 150.1, high: 900 }, 150) === "FAIL");
  check("negative control: a lower bound EQUAL to the ceiling is not a FAIL", threeWayVerdict({ low: 150, high: 900 }, 150) === "INCONCLUSIVE");
  check("an interval straddling the ceiling is INCONCLUSIVE", threeWayVerdict({ low: 100, high: 151 }, 150) === "INCONCLUSIVE");
  check("no interval (too few rounds) is INCONCLUSIVE, never PASS", threeWayVerdict(undefined, 1e9) === "INCONCLUSIVE");

  // 21 deltas whose median is 0 ms (far under 150) but whose 16th value is 200 ms.
  const lowMedianWideSpread = [-300, -250, -200, -150, -100, -50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 200, 250, 300, 350, 400, 450];
  const passLooking = judgePaired(lowMedianWideSpread, 21, 150);
  check("negative control: a median well under the ceiling is NOT a PASS while the interval reaches above it", stats(lowMedianWideSpread)?.median === 0 && passLooking.verdict === "INCONCLUSIVE", passLooking);
  const highMedianWideSpread = lowMedianWideSpread.map((delta) => delta + 200);
  const failLooking = judgePaired(highMedianWideSpread, 21, 150);
  check("negative control: a median over the ceiling is NOT a FAIL while the interval reaches below it", stats(highMedianWideSpread)?.median === 200 && failLooking.verdict === "INCONCLUSIVE", failLooking);
  const tight = judgePaired(Array.from({ length: 21 }, (_, i) => i * 5 - 50), 21, 150);
  check("21 tightly spread deltas under the ceiling PASS", tight.verdict === "PASS", tight);
  const tightOver = judgePaired(Array.from({ length: 21 }, (_, i) => 400 + i), 21, 150);
  check("21 tightly spread deltas over the ceiling FAIL", tightOver.verdict === "FAIL", tightOver);

  check("a missing round is INCOMPLETE (a harness failure), not a verdict", judgePaired([1, 2, 3, 4, 5, 6], 7, 150).verdict === "INCOMPLETE");
  check("a non-finite round is INCOMPLETE, not silently dropped", judgePaired([1, 2, 3, 4, 5, 6, Number.NaN], 7, 150).verdict === "INCOMPLETE");
}

// ── p95 eligibility ──────────────────────────────────────────────────────────────────────────────
console.log("\np95 eligibility (binding only on the gate at ≥ 21 samples per mode)");
{
  const twenty = stats(Array.from({ length: 20 }, (_, i) => i + 1));
  const twentyOne = stats(Array.from({ length: 21 }, (_, i) => i + 1));
  check("the rule's premise: stats().p95 is the MAXIMUM at 20 samples and not at 21", twenty?.p95 === 20 && twenty.max === 20 && twentyOne?.p95 === 20 && twentyOne.max === 21, { p95At20: twenty?.p95, p95At21: twentyOne?.p95 });
  check("the threshold is 21", P95_MIN_SAMPLES === 21);
  check("binding on the gate with 21 samples in each mode", p95IsBinding(true, 21, 21));
  check("negative control: 20 ON samples keep p95 informational", !p95IsBinding(true, 20, 21));
  check("negative control: 20 OFF samples keep p95 informational", !p95IsBinding(true, 21, 20));
  check("negative control: 7 samples (option B) keep p95 informational", !p95IsBinding(true, 7, 7));
  check("negative control: a non-gating run never makes p95 binding, however many samples", !p95IsBinding(false, 63, 63));
}

// ── Configuration and exit code ──────────────────────────────────────────────────────────────────
console.log("\nApproved and unsupported configurations");
{
  const same = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b);
  check("the approved gate is 21 rounds × 1 instance", APPROVED_GATE.rounds === 21 && APPROVED_GATE.instances === 1);
  check("21 × 1 gates", same(gateConfiguration(21, 1, false), { gating: true, gateNotRun: false }));
  for (const instances of [2, 3, 6]) {
    check(`unsupported instance count ${instances}: gate NOT RUN, never gating`, same(gateConfiguration(21, instances, false), { gating: false, gateNotRun: true }));
  }
  check("the superseded 7-round configuration (option B) is gate NOT RUN", same(gateConfiguration(7, 1, false), { gating: false, gateNotRun: true }));
  check("more rounds than approved is also NOT RUN (only the approved configuration counts)", same(gateConfiguration(31, 1, false), { gating: false, gateNotRun: true }));
  check("the saturated run is informational: neither gating nor NOT RUN", same(gateConfiguration(21, 3, true), { gating: false, gateNotRun: false }));
  check("--saturated at 1 instance is still informational, never a gate", same(gateConfiguration(21, 1, true), { gating: false, gateNotRun: false }));

  check("exit 0 only when everything passed", gateExitCode({ passed: 20, failed: 0, inconclusive: 0, gateNotRun: false }) === 0);
  check("exit 2 on INCONCLUSIVE", gateExitCode({ passed: 20, failed: 0, inconclusive: 1, gateNotRun: false }) === 2);
  check("exit 2 when the gate did not run in its approved configuration", gateExitCode({ passed: 20, failed: 0, inconclusive: 0, gateNotRun: true }) === 2);
  check("exit 1 on FAIL, even alongside INCONCLUSIVE", gateExitCode({ passed: 20, failed: 1, inconclusive: 3, gateNotRun: false }) === 1);
  check("exit 1 when nothing passed at all", gateExitCode({ passed: 0, failed: 0, inconclusive: 0, gateNotRun: false }) === 1);
}

// ── Evidence appends ─────────────────────────────────────────────────────────────────────────────
console.log("\nRaw evidence is appended, never replaced");
{
  const dir = mkdtempSync(join(tmpdir(), "awkit-l5a-gate-stats-"));
  try {
    const file = join(dir, "gate.json");
    const first = { recordedAt: "r1", batches: [{ mode: "on", durationsMs: { fast: [1], evidence: [2] } }] };
    const second = { recordedAt: "r2", batches: [] };
    check("the first append creates { runs: [first] }", appendEvidenceRun(file, first) === 1 && JSON.stringify(JSON.parse(readFileSync(file, "utf8"))) === JSON.stringify({ runs: [first] }));
    const count = appendEvidenceRun(file, second);
    const after = JSON.parse(readFileSync(file, "utf8")) as { runs: unknown[] };
    check("a second append keeps the first run unchanged and in first place", count === 2 && after.runs.length === 2 && JSON.stringify(after.runs[0]) === JSON.stringify(first) && JSON.stringify(after.runs[1]) === JSON.stringify(second));

    for (const [label, content] of [
      ["malformed JSON", "{ runs: [ oops"],
      ["the old single-record format", JSON.stringify({ recordedAt: "legacy", measured: {} })],
      ["a non-array runs field", JSON.stringify({ runs: "x" })],
      ["a JSON null", "null"]
    ] as const) {
      const bad = join(dir, `bad-${label.replace(/\W+/g, "-")}.json`);
      writeFileSync(bad, content, "utf8");
      let threw = false;
      try {
        appendEvidenceRun(bad, second);
      } catch {
        threw = true;
      }
      check(`negative control: ${label} is refused and left byte-for-byte as it was`, threw && readFileSync(bad, "utf8") === content);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── The committed raw evidence ───────────────────────────────────────────────────────────────────
console.log("\nCommitted raw evidence");
{
  interface Run {
    measured?: {
      rounds?: number;
      instancesPerWorkloadPerBatch?: number;
      gating?: boolean;
      fastPairedMedianDeltaMs?: { perRound?: number[] };
      evidencePairedMedianDeltaMs?: { perRound?: number[] };
      nodeCpuMsPerInstance?: { pairedDelta?: { perRound?: number[] } };
    };
    verdicts?: Record<string, { verdict: string; binding: boolean; ceiling?: number }>;
    batches?: Array<{ mode: string; durationsMs: { fast: number[]; evidence: number[] } }>;
  }
  const load = (name: string) => JSON.parse(readFileSync(join(ROOT, "docs", "plans", "ai-upgrade-v5", "evidence", name), "utf8")) as { runs: Run[] };
  const gate = load("L5a-overhead-gate.json");
  const saturated = load("L5a-overhead-saturated.json");
  check("both evidence files are { runs: [...] } with at least the recorded runs", Array.isArray(gate.runs) && gate.runs.length >= 2 && Array.isArray(saturated.runs) && saturated.runs.length >= 1, { gate: gate.runs?.length, saturated: saturated.runs?.length });

  const malformed = [...gate.runs, ...saturated.runs].filter((run) => {
    const rounds = run.measured?.rounds;
    const instances = run.measured?.instancesPerWorkloadPerBatch;
    return (
      typeof rounds !== "number" ||
      typeof instances !== "number" ||
      run.batches?.length !== rounds * 2 ||
      run.batches.filter((batch) => batch.mode === "on").length !== rounds ||
      !run.batches.every((batch) => batch.durationsMs.fast.length === instances && batch.durationsMs.evidence.length === instances)
    );
  });
  check("every run keeps one raw batch per mode per round, with one duration per instance per workload", malformed.length === 0, `${malformed.length} malformed`);

  const perRoundOf = (measured: NonNullable<Run["measured"]>, label: string): number[] =>
    (label.startsWith("fast:") ? measured.fastPairedMedianDeltaMs?.perRound : label.startsWith("evidence:") ? measured.evidencePairedMedianDeltaMs?.perRound : measured.nodeCpuMsPerInstance?.pairedDelta?.perRound) ?? [];
  const rederived: Array<{ label: string; recorded: string; rederived: string }> = [];
  for (const run of gate.runs) {
    const measured = run.measured;
    if (measured?.gating !== true) continue;
    for (const [label, recorded] of Object.entries(run.verdicts ?? {})) {
      if (!recorded.binding || label.includes("p95") || recorded.ceiling === undefined) continue;
      rederived.push({ label, recorded: recorded.verdict, rederived: judgePaired(perRoundOf(measured, label), measured.rounds ?? 0, recorded.ceiling).verdict });
    }
  }
  const disagreements = rederived.filter((entry) => entry.recorded !== entry.rederived);
  check("every recorded binding median verdict is re-derived from the raw per-round deltas", rederived.length >= 6 && disagreements.length === 0, disagreements.length ? disagreements : `${rederived.length} verdicts`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 && passed > 0 ? 0 : 1);
