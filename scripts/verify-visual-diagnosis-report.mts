/**
 * verify:visual-diagnosis-report — Phase N, N5.4 (awkit-vra.14.4): the codes-only `visualDiagnosis` report block.
 *
 * Part 1, the sanitizer (`sanitizeVisualDiagnosisRecords`), pure:
 *   - a decision table: a valid record kept exactly; unknown keys (digests, fingerprints, selectors, URLs, pixels)
 *     dropped; codes outside the pattern become `invalid`; observations capped at 8; malformed enums, versions, counts
 *     and flags drop the record; counts clamped; step ids that are not identifiers become `invalid`; records capped
 *     at 64; empty, non-array and all-malformed inputs give no field;
 *   - a seeded property run of hostile inputs: never throws, every output key is on the allowlist, every string is
 *     an enum value, a code or `invalid`, and sanitizing is idempotent;
 *   - the same suite run against mutants, each of which must FAIL it.
 *
 * Part 2, the real report, end to end: the REAL `ExecutionEngine` (real Chromium) runs one failing flow against the
 * mock-site fusion lab with `AWKIT_VISUAL_DIAGNOSIS` off and on, and `report.json` is read back as `ReportService`
 * wrote it:
 *   - off: no `visualDiagnosis` field; on: exactly one sanitized record for the failed step, codes only;
 *   - the same step statuses and errors, the same L5a `diagnostics` keys and cause, no diagnosis log line in either;
 *   - the report export is byte-identical with and without the block (it never reaches an export);
 *   - the flow passed to the engine is unchanged;
 *   - pins: L5b never reads the block, run history stays fixed columns, a report without the field reads as absent.
 *
 * Run: npm run verify:visual-diagnosis-report   (node scripts/benchmark/run.mjs → tsx + the electron stub)
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ConcurrentRunProfile } from "@src/instances/ConcurrentRunProfile";
import type { FlowProfile, FlowStep } from "@src/profiles/FlowProfile";
import type { ScenarioProfile } from "@src/profiles/ScenarioProfile";
import type { ConcurrentRunReport, InstanceReport } from "@src/reports/ExecutionReport";
import { ReportExportService } from "@src/reports/ReportExportService";
import { ExecutionEngine } from "@src/runner/ExecutionEngine";
import {
  VISUAL_DIAGNOSIS_MAX_RECORDS,
  VISUAL_DIAGNOSIS_PRUNED_CODES,
  VISUAL_DIAGNOSIS_RECORD_KEYS,
  exposedVisualDiagnosisObservations,
  sanitizeVisualDiagnosisRecords,
  type VisualDiagnosisRecord
} from "@src/runner/visualDiagnosis/visualDiagnosisRecord";
import { buildDirs, cleanupRoot, installBenchGuards } from "./benchmark/engineHarness.mts";

installBenchGuards();

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
}

type Sanitizer = (value: unknown) => VisualDiagnosisRecord[] | undefined;
interface Outcome {
  label: string;
  ok: boolean;
  detail?: string;
}

const KEYS = new Set<string>(VISUAL_DIAGNOSIS_RECORD_KEYS);
const ENUMS: Record<string, Set<string>> = {
  failureKind: new Set(["locator", "timeout", "assertion", "other", "none"]),
  outcome: new Set(["refused", "observed"]),
  conditions: new Set(["none", "different", "unproven", "equal-proven"]),
  referenceSource: new Set(["runtime", "recorded", "none"]),
  identicalOthers: new Set(["1", "2+"])
};
const CODE = /^[a-z][a-z0-9-]{0,39}$/;
const STEP_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const stable = (value: unknown): string => JSON.stringify(value, (_key, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));

const valid = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 1,
  stepId: "step-1",
  attempt: 0,
  failureKind: "locator",
  outcome: "observed",
  conditions: "unproven",
  observations: ["conditions-unproven", "target-not-in-dom", "other-examined-identical"],
  referenceSource: "runtime",
  examined: 3,
  domNamed: 3,
  truncated: false,
  identicalOthers: "1",
  ms: 412,
  ...overrides
});

/** Shape problems of a sanitizer output; empty when it holds only allowlisted keys and safe values. */
function shapeProblems(out: VisualDiagnosisRecord[] | undefined): string[] {
  if (out === undefined) return [];
  const problems: string[] = [];
  if (!Array.isArray(out) || out.length === 0 || out.length > VISUAL_DIAGNOSIS_MAX_RECORDS) problems.push(`length ${Array.isArray(out) ? out.length : typeof out}`);
  for (const record of Array.isArray(out) ? out : []) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      problems.push(`record ${JSON.stringify(record)}`);
      continue;
    }
    for (const [key, value] of Object.entries(record)) {
      if (!KEYS.has(key)) problems.push(`key ${key}`);
      if (ENUMS[key] && !ENUMS[key].has(String(value))) problems.push(`${key} ${String(value)}`);
    }
    if (!Array.isArray(record.observations) || record.observations.length === 0 || record.observations.length > 8) problems.push("observations size");
    if (Array.isArray(record.observations) && !record.observations.every((code) => typeof code === "string" && CODE.test(code))) problems.push(`observation ${record.observations.join(",")}`);
    if (typeof record.stepId !== "string" || (record.stepId !== "invalid" && !STEP_ID.test(record.stepId))) problems.push(`stepId ${record.stepId}`);
    for (const key of ["attempt", "examined", "domNamed", "ms"] as const) {
      if (!Number.isInteger(record[key]) || record[key] < 0) problems.push(`${key} ${record[key]}`);
    }
    if (record.examined > 64 || record.domNamed > 64) problems.push("count over 64");
  }
  return problems;
}

interface Case {
  name: string;
  input: unknown;
  expect: (out: VisualDiagnosisRecord[] | undefined) => boolean;
}

function buildCases(): Case[] {
  const one = (out: VisualDiagnosisRecord[] | undefined) => (out && out.length === 1 ? out[0] : undefined);
  return [
    { name: "a valid record is kept exactly", input: [valid()], expect: (out) => stable(one(out)) === stable(valid()) },
    { name: "a record without identicalOthers stays without it", input: [valid({ identicalOthers: undefined, observations: ["inconclusive"] })], expect: (out) => !!one(out) && !("identicalOthers" in one(out)!) },
    {
      name: "unknown keys (digest, fingerprint, selector, url, pixels, page text) are dropped",
      input: [valid({ contentDigest: "sha256:ab", fingerprint: { grid: "x" }, selector: "#submit", url: "http://127.0.0.1/x", pixels: [1, 2], text: "Pay now" })],
      expect: (out) => stable(one(out)) === stable(valid())
    },
    { name: "a code with spaces or markup becomes invalid", input: [valid({ observations: ["Click #submit", "<b>x</b>"] })], expect: (out) => one(out)?.observations.join(",") === "invalid,invalid" },
    { name: "an upper-case code becomes invalid", input: [valid({ observations: ["Target-Not-In-Dom"] })], expect: (out) => one(out)?.observations[0] === "invalid" },
    { name: "a 41-character code becomes invalid", input: [valid({ observations: ["a".repeat(41)] })], expect: (out) => one(out)?.observations[0] === "invalid" },
    { name: "a non-string code becomes invalid", input: [valid({ observations: [42, null] })], expect: (out) => one(out)?.observations.join(",") === "invalid,invalid" },
    { name: "observations are capped at 8", input: [valid({ observations: Array.from({ length: 12 }, (_, i) => `code-${i}`) })], expect: (out) => one(out)?.observations.length === 8 },
    { name: "no observations drops the record", input: [valid({ observations: [] })], expect: (out) => out === undefined },
    { name: "an unknown outcome drops the record", input: [valid({ outcome: "approved" })], expect: (out) => out === undefined },
    { name: "an unknown conditions value drops the record", input: [valid({ conditions: "proven" })], expect: (out) => out === undefined },
    { name: "an unknown reference source drops the record", input: [valid({ referenceSource: "disk" })], expect: (out) => out === undefined },
    { name: "an unknown failure kind drops the record", input: [valid({ failureKind: "crash" })], expect: (out) => out === undefined },
    { name: "another version drops the record", input: [valid({ version: 2 })], expect: (out) => out === undefined },
    { name: "a non-boolean truncated drops the record", input: [valid({ truncated: "yes" })], expect: (out) => out === undefined },
    { name: "a negative count drops the record", input: [valid({ examined: -1 })], expect: (out) => out === undefined },
    { name: "a fractional attempt drops the record", input: [valid({ attempt: 1.5 })], expect: (out) => out === undefined },
    { name: "large counts are clamped to 64", input: [valid({ examined: 99, domNamed: 500 })], expect: (out) => one(out)?.examined === 64 && one(out)?.domNamed === 64 },
    { name: "a huge duration is clamped", input: [valid({ ms: 10_000_000 })], expect: (out) => one(out)?.ms === 600_000 },
    { name: "a step id that is not an identifier becomes invalid", input: [valid({ stepId: "click <Pay now>" })], expect: (out) => one(out)?.stepId === "invalid" },
    { name: "a step id holding a URL becomes invalid", input: [valid({ stepId: "http://127.0.0.1/x?token=1" })], expect: (out) => one(out)?.stepId === "invalid" },
    { name: "an identicalOthers outside 1 / 2+ is removed", input: [valid({ identicalOthers: "3" })], expect: (out) => !!one(out) && !("identicalOthers" in one(out)!) },
    { name: "records are capped at 64", input: Array.from({ length: 100 }, () => valid()), expect: (out) => out?.length === 64 },
    { name: "malformed records are dropped and valid ones kept", input: [null, "x", 7, valid({ outcome: "nope" }), valid()], expect: (out) => out?.length === 1 },
    { name: "an empty array gives no field", input: [], expect: (out) => out === undefined },
    { name: "a non-array gives no field", input: { records: [valid()] }, expect: (out) => out === undefined },
    { name: "undefined (a report written before N5) gives no field", input: undefined, expect: (out) => out === undefined },
    { name: "all-malformed input gives no field", input: [null, valid({ version: 0 })], expect: (out) => out === undefined }
  ];
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hostile(next: () => number): unknown {
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)];
  const junk = () => pick<unknown>(["", "observed", "invalid", "x".repeat(50), "<img src=x>", "http://evil", 3, -1, 1.5, null, true, [], {}, "unproven", "2+", "runtime"]);
  const record: Record<string, unknown> = next() < 0.5 ? valid() : {};
  for (const key of [...VISUAL_DIAGNOSIS_RECORD_KEYS, "contentDigest", "selector", "url", "evidence"]) {
    if (next() < 0.35) record[key] = key === "observations" && next() < 0.6 ? Array.from({ length: Math.floor(next() * 14) }, junk) : junk();
  }
  return pick<unknown>([[record], [record, valid()], record, null, Array.from({ length: Math.floor(next() * 80) }, () => (next() < 0.7 ? valid() : record))]);
}

function evaluate(sanitize: Sanitizer, cases: Case[], runs: number): Outcome[] {
  const outcomes: Outcome[] = [];
  outcomes.push({ label: "the decision table holds at least 25 cases", ok: cases.length >= 25, detail: String(cases.length) });
  for (const c of cases) {
    let out: VisualDiagnosisRecord[] | undefined;
    try {
      out = sanitize(structuredClone(c.input));
    } catch (error) {
      outcomes.push({ label: `[table] ${c.name}`, ok: false, detail: `threw ${String(error)}` });
      continue;
    }
    const problems = shapeProblems(out);
    outcomes.push({ label: `[table] ${c.name}`, ok: c.expect(out) && problems.length === 0, detail: `${JSON.stringify(out)?.slice(0, 300)} ${problems.join("; ")}` });
  }
  const next = rng(0x7e5a1);
  const violations: string[] = [];
  let produced = 0;
  for (let i = 0; i < runs; i += 1) {
    const input = hostile(next);
    try {
      const out = sanitize(structuredClone(input));
      if (out) produced += 1;
      const problems = shapeProblems(out);
      if (problems.length) violations.push(`#${i} ${problems[0]}`);
      if (stable(sanitize(structuredClone(out))) !== stable(out)) violations.push(`#${i} not idempotent`);
    } catch (error) {
      violations.push(`#${i} threw ${String(error)}`);
    }
  }
  outcomes.push({ label: `the property run sanitized ${runs} hostile inputs`, ok: runs > 0, detail: String(runs) });
  outcomes.push({ label: "every output holds only allowlisted keys and safe values, idempotently, and never throws", ok: violations.length === 0, detail: violations.slice(0, 3).join("; ") });
  outcomes.push({ label: "the property run is non-vacuous (many inputs produced a block)", ok: produced >= runs / 4, detail: `${produced} of ${runs}` });
  return outcomes;
}

// ── Part 2 setup ───────────────────────────────────────────────────────────────────────────────
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PORT = await new Promise<number>((resolvePort, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const { port } = probe.address() as { port: number };
    probe.close(() => resolvePort(port));
  });
});
const BASE = `http://127.0.0.1:${PORT}`;
const LAB = `${BASE}/visual-intelligence/fusion`;
const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

const failingStep: FlowStep = { id: "vd-missing", type: "click", name: "Click the missing tool", timeoutMs: 1_000, locator: { strategy: "testId", value: "vf-missing-tool" } };
function flowOf(): FlowProfile {
  const nodes: FlowStep[] = [{ id: "start", type: "start", name: "start" }, { id: "vd-goto", type: "goto", name: "Open the lab", url: LAB }, failingStep, { id: "end", type: "end", name: "end" }];
  return { id: "vd-flow", name: "vd-flow", version: 1, nodes, edges: nodes.slice(0, -1).map((node, index) => ({ id: `vd-e${index}`, source: node.id, target: nodes[index + 1].id, type: "success" })) } as FlowProfile;
}
const scenario: ScenarioProfile = {
  id: "vd-scn",
  name: "vd-scn",
  executionMode: "sequential",
  maxParallelFlows: 1,
  flows: [{ order: 1, flowId: "vd-flow", required: true }],
  links: [],
  failurePolicy: { stopOnRequiredFlowFailure: true, continueOnOptionalFlowFailure: false, takeScreenshotOnFailure: false }
};
const runProfile = (executionId: string): ConcurrentRunProfile => ({
  id: executionId,
  scenarioId: scenario.id,
  runMode: "fixedConcurrent",
  maxConcurrentInstances: 1,
  browserWindowMode: "headless",
  instanceTemplate: { browser: "chromium", headless: true, isolationMode: "browserContext", baseUrl: BASE, timeoutMs: 30_000, viewport: { width: 800, height: 600 } },
  resourceControls: { maxBrowserContextsPerProcess: 4, delayBetweenInstanceStartsMs: 0 },
  failurePolicy: { stopAllOnCriticalFailure: false, continueOtherInstancesOnFailure: true, retryFailedInstance: false, retryCount: 0 }
});

async function runOnce(engine: ExecutionEngine, dirs: Awaited<ReturnType<typeof buildDirs>>["dirs"], key: string, flow: FlowProfile): Promise<{ report?: ConcurrentRunReport; instance?: InstanceReport }> {
  const executionId = `vd-${key}-${Date.now().toString(36)}`;
  await engine.startRun(executionId, runProfile(executionId), [undefined], dirs, {}, scenario, [flow]);
  for (let waited = 0; waited < 90_000; waited += 100) {
    const mine = engine.getInstances().filter((instance) => instance.executionId === executionId);
    if (mine.length === 1 && TERMINAL.has(mine[0].status)) break;
    await sleep(100);
  }
  const path = join(dirs.reports, executionId, "report.json");
  for (let waited = 0; !existsSync(path) && waited < 30_000; waited += 100) await sleep(100);
  if (!existsSync(path)) return {};
  const report = JSON.parse(readFileSync(path, "utf8")) as ConcurrentRunReport;
  return { report, instance: report.instances[0] };
}

const stepRows = (instance?: InstanceReport) => JSON.stringify((instance?.scenarioResult?.flows ?? []).flatMap((flow) => flow.steps.map((step) => `${step.stepId}:${step.status}:${step.error ?? ""}`)));
const diagnosisLogs = (instance?: InstanceReport) => (instance?.scenarioResult?.logs ?? []).filter((log) => /visual-diagnosis|Visual diagnosis/.test(log.message)).length;

// ── Main ───────────────────────────────────────────────────────────────────────────────────────
console.log("Part 1. The sanitizer");
const cases = buildCases();
for (const outcome of evaluate(sanitizeVisualDiagnosisRecords, cases, 3000)) check(outcome.label, outcome.ok, outcome.detail);

console.log("\n  mutants (each must FAIL the suite)");
const passthrough: Sanitizer = (value) => (Array.isArray(value) && value.length > 0 ? (value as VisualDiagnosisRecord[]) : undefined);
const keepsExtraKeys: Sanitizer = (value) => {
  const out = sanitizeVisualDiagnosisRecords(value);
  return out && Array.isArray(value) ? out.map((record, i) => ({ ...(value[i] as object), ...record }) as VisualDiagnosisRecord) : out;
};
const rawCodes: Sanitizer = (value) => {
  const out = sanitizeVisualDiagnosisRecords(value);
  return out && Array.isArray(value) ? out.map((record, i) => ({ ...record, observations: ((value[i] as { observations?: string[] })?.observations ?? record.observations).slice(0, 8) })) : out;
};
const noRecordCap: Sanitizer = (value) => (Array.isArray(value) ? value.map((v) => sanitizeVisualDiagnosisRecords([v])?.[0]).filter((r): r is VisualDiagnosisRecord => !!r) : undefined) || undefined;
const rawStepId: Sanitizer = (value) => {
  const out = sanitizeVisualDiagnosisRecords(value);
  return out && Array.isArray(value) ? out.map((record, i) => ({ ...record, stepId: String((value[i] as { stepId?: unknown })?.stepId) })) : out;
};
const emptyArray: Sanitizer = (value) => sanitizeVisualDiagnosisRecords(value) ?? ([] as VisualDiagnosisRecord[]);
const mutants: Array<[string, Outcome[], string]> = [
  ["the input is passed through", evaluate(passthrough, cases, 3000), "[table] unknown keys"],
  ["unknown keys are kept beside the allowlisted ones", evaluate(keepsExtraKeys, cases, 3000), "[table] unknown keys"],
  ["codes are not validated", evaluate(rawCodes, cases, 3000), "[table] a code with spaces"],
  ["records are not capped", evaluate(noRecordCap, cases, 3000), "[table] records are capped at 64"],
  ["step ids are not validated", evaluate(rawStepId, cases, 3000), "[table] a step id that is not an identifier"],
  ["an empty block is written instead of no field", evaluate(emptyArray, cases, 3000), "[table] an empty array gives no field"],
  ["a short case set", evaluate(sanitizeVisualDiagnosisRecords, cases.slice(0, 20), 3000), "the decision table holds"],
  ["an empty property run", evaluate(sanitizeVisualDiagnosisRecords, cases, 0), "the property run sanitized"]
];
for (const [name, outcomes, mustFail] of mutants) {
  const failing = outcomes.filter((o) => !o.ok).map((o) => o.label);
  check(`MUTATION: ${name} fails the suite (${failing.length} checks, including "${mustFail}")`, failing.some((label) => label.startsWith(mustFail)), failing.join("; ") || "nothing failed");
}

console.log("\nPart 1b. N5.6 pruning at exposure");
{
  const pruneSuite = (expose: (r: Pick<VisualDiagnosisRecord, "observations">) => string[]): Outcome[] => [
    { label: "viewport-uniform is pruned (benchmark:visual-diagnosis NOT MET in headed cells)", ok: VISUAL_DIAGNOSIS_PRUNED_CODES.has("viewport-uniform") && VISUAL_DIAGNOSIS_PRUNED_CODES.size === 1 },
    { label: "a pruned code is shown as inconclusive", ok: JSON.stringify(expose({ observations: ["reference-unavailable", "target-not-in-dom", "viewport-uniform"] })) === JSON.stringify(["reference-unavailable", "target-not-in-dom", "inconclusive"]) },
    { label: "inconclusive is shown once when both appear", ok: JSON.stringify(expose({ observations: ["viewport-uniform", "inconclusive"] })) === JSON.stringify(["inconclusive"]) },
    { label: "calibrated codes are shown unchanged", ok: JSON.stringify(expose({ observations: ["conditions-unproven", "target-identical-to-reference", "target-occluded"] })) === JSON.stringify(["conditions-unproven", "target-identical-to-reference", "target-occluded"]) }
  ];
  for (const outcome of pruneSuite(exposedVisualDiagnosisObservations)) check(outcome.label, outcome.ok);
  const unpruned = pruneSuite((r) => [...r.observations]).filter((o) => !o.ok).map((o) => o.label);
  check("MUTATION: exposure without pruning fails the pruning checks", unpruned.some((label) => label.startsWith("a pruned code is shown")), unpruned.join("; ") || "nothing failed");
}

console.log("\nPart 2. The real report, flag off and on");
let mockSite: ChildProcess | undefined;
const { dirs, root } = await buildDirs("awkit-visual-diagnosis-report-");
try {
  mockSite = spawn(process.execPath, [join(ROOT, "mock-site", "server.mjs")], { env: { ...process.env, MOCK_SITE_PORT: String(PORT) }, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  for (let attempt = 0; attempt < 100 && !(await fetch(LAB).then((r) => r.ok, () => false)); attempt += 1) await sleep(100);
  const engine = new ExecutionEngine();
  engine.configureConcurrency({ maxBrowsersPerHost: 2, maxActiveFlows: 2, useSharedBrowserPool: false, workloadWeights: false });

  const flow = flowOf();
  const flowBefore = JSON.stringify(flow);
  delete process.env.AWKIT_VISUAL_DIAGNOSIS;
  const off = await runOnce(engine, dirs, "off", flow);
  process.env.AWKIT_VISUAL_DIAGNOSIS = "on";
  const on = await runOnce(engine, dirs, "on", flow);
  delete process.env.AWKIT_VISUAL_DIAGNOSIS;

  check("precondition: both runs wrote a report and failed on the missing tool", off.instance?.status === "failed" && on.instance?.status === "failed", `${off.instance?.status} / ${on.instance?.status}`);
  check("flag off: the instance report has no visualDiagnosis field", !!off.instance && !("visualDiagnosis" in off.instance));
  const block = on.instance?.visualDiagnosis;
  check("flag on: exactly one record, for the failed step", Array.isArray(block) && block.length === 1 && block[0].stepId === failingStep.id, block);
  const record = block?.[0];
  check("the stored record is already sanitized (sanitizing it again changes nothing)", !!record && stable(sanitizeVisualDiagnosisRecords([record])?.[0]) === stable(record));
  check("it observes the missing target, with codes only", !!record && record.observations.includes("target-not-in-dom") && record.observations.every((code) => CODE.test(code)), record?.observations);
  check("it holds only allowlisted keys", !!record && Object.keys(record).every((key) => KEYS.has(key)), record && Object.keys(record));
  const text = JSON.stringify(block ?? []);
  check("it holds no URL, host, test id, markup or page text", !/http|127\.0\.0\.1|vf-|<|Click the missing/.test(text), text);
  check("the step statuses and errors are the same with the flag off and on", stepRows(off.instance) === stepRows(on.instance), `${stepRows(off.instance)} vs ${stepRows(on.instance)}`);
  check(
    "the L5a diagnostics keep the same keys and cause with the flag off and on",
    JSON.stringify(Object.keys(off.instance?.diagnostics ?? {}).sort()) === JSON.stringify(Object.keys(on.instance?.diagnostics ?? {}).sort()) &&
      off.instance?.diagnostics?.cause?.cause === on.instance?.diagnostics?.cause?.cause &&
      !("visualDiagnosis" in (on.instance?.diagnostics ?? {})),
    `${off.instance?.diagnostics?.cause?.cause} / ${on.instance?.diagnostics?.cause?.cause}`
  );
  check("no diagnosis log line in either run (the N5.3 log sink is gone)", diagnosisLogs(off.instance) === 0 && diagnosisLogs(on.instance) === 0, `${diagnosisLogs(off.instance)} / ${diagnosisLogs(on.instance)}`);
  check("the flow handed to the engine is unchanged", JSON.stringify(flow) === flowBefore);
  if (on.report) {
    const exporter = new ReportExportService();
    const without = structuredClone(on.report);
    for (const instance of without.instances) delete instance.visualDiagnosis;
    for (const format of ["json", "csv"] as const) {
      const a = (await exporter.export(on.report, format)).dataBase64;
      const b = (await exporter.export(without, format)).dataBase64;
      check(`the ${format} export is byte-identical with and without the block`, a === b && !Buffer.from(a, "base64").toString("utf8").includes("visualDiagnosis"));
    }
  } else {
    check("the on run's report was read for the export check", false);
  }
} finally {
  delete process.env.AWKIT_VISUAL_DIAGNOSIS;
  mockSite?.kill();
  await cleanupRoot(root);
}

console.log("\nPart 3. Pins");
{
  const l5b = readFileSync(join(ROOT, "src/ai/failureAnalysis.ts"), "utf8");
  check("L5b failure analysis never reads the block", !l5b.includes("visualDiagnosis"));
  const telemetry = readFileSync(join(ROOT, "src/reports/TelemetryContracts.ts"), "utf8");
  const rowBody = /export interface RunHistoryRow \{([^}]*)\}/.exec(telemetry)?.[1] ?? "";
  check("run history stays fixed columns with no visual field", rowBody.length > 0 && !/visual/i.test(rowBody));
  const engine = readFileSync(join(ROOT, "src/runner/ExecutionEngine.ts"), "utf8");
  check("the engine writes the block only through the sanitizer", /instanceReport\.visualDiagnosis = visualDiagnosis/.test(engine) && /const visualDiagnosis = sanitizeVisualDiagnosisRecords\(visualDiagnoses\)/.test(engine));
  const runnerText = readFileSync(join(ROOT, "src/runner/PlaywrightRunner.ts"), "utf8");
  const wiring = /private createVisualDiagnosis\(\)[\s\S]*?\n  \}\n/.exec(runnerText)?.[0] ?? "";
  check(
    "the runner's diagnosis wiring hands records to onVisualDiagnosis only: no log, console or diagnosis line",
    wiring.includes("sink(record)") && !/\blog\(|console\.|\[visual-diagnosis\]/.test(wiring),
    wiring.length ? "a log path is present" : "createVisualDiagnosis not found"
  );
  const reportTypes = readFileSync(join(ROOT, "src/reports/ExecutionReport.ts"), "utf8");
  check("the report field is optional", /visualDiagnosis\?: VisualDiagnosisRecord\[\];/.test(reportTypes));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
