/**
 * verify:visual-assertion-report — Phase N, N6.7 (awkit-vra.15.7): the codes-only `InstanceReport.visualAssertions`
 * block, its sanitizer, its persistence and its presentation copy.
 *
 *  A. Adversarial sanitizer: hostile keys (digests, commitments, tokens, selectors, URLs, pixels, prototype keys)
 *     never survive; markup, URLs and free text as codes or ids read `invalid`; malformed records are dropped; counts
 *     are bounded; a result is never strengthened (a mismatch needs a failed verdict; a passed record has no class);
 *     sanitizing is idempotent and survives a JSON round trip.
 *  B. Totals per instance and per run, with legacy and hostile instances mixed in.
 *  C. Persistence through the real `ReportService.writeReport` on a temp root, read back from disk; reports written
 *     before N6 (no field) and N5-only reports read exactly as before.
 *  D. Wiring and copy: the record module imports nothing; the engine collects every decision, capped, and sanitizes it
 *     onto the instance report only when non-empty; the drawer and Designer read through the sanitizer; the copy keeps
 *     visual mismatch and visual unverified apart and never shows an image.
 *  E. Mutants of the sanitizer must each turn the suite red.
 *
 * Run: npm run verify:visual-assertion-report
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ConcurrentRunReport, InstanceReport } from "@src/reports/ExecutionReport";
import { ReportService } from "@src/reports/ReportService";
import {
  VISUAL_ASSERTION_REPORT_KEYS,
  VISUAL_ASSERTION_REPORT_MAX_RECORDS,
  sanitizeVisualAssertionReportRecords,
  visualAssertionRunTotals,
  visualAssertionTotals,
  type VisualAssertionReportRecord
} from "@src/runner/visualAssertion/visualAssertionReport";
import { visualAssertionSentence } from "../app/renderer/components/reports/VisualAssertionReportSection";

type Sanitize = (value: unknown) => VisualAssertionReportRecord[] | undefined;
type Outcome = { label: string; ok: boolean; detail?: string };

const SECRET = {
  digest: "9f2c4e6a8b0d1f3e5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c5e7b9d1f",
  token: "0123456789abcdef0123456789abcdef",
  url: "https://secret.example/orders?token=n6-report-secret",
  selector: "[data-testid=private-card]"
};

const base = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 1,
  stepId: "va-assert",
  flowId: "flow-1",
  mode: "observe",
  flag: "observe",
  appMode: "dev",
  status: "passed",
  code: "equal-commitments",
  verdict: "passed",
  verdictCode: "equal-commitments",
  candidate: false,
  durationMs: 412,
  ...extra
});

function suite(sanitize: Sanitize): Outcome[] {
  const out: Outcome[] = [];
  const add = (label: string, ok: unknown, detail?: string): void => {
    out.push({ label, ok: !!ok, detail });
  };
  const one = (value: Record<string, unknown>) => sanitize([value])?.[0];

  // A. Sanitizer.
  const hostile = one(
    base({
      contentDigest: SECRET.digest,
      commitment: SECRET.digest,
      epoch: SECRET.token,
      selector: SECRET.selector,
      url: SECRET.url,
      pngBase64: "iVBORw0KGgo=",
      runUser: "runner-1",
      nested: { digest: SECRET.digest }
    })
  );
  add("A1 hostile keys never survive: only allowlisted keys remain", !!hostile && Object.keys(hostile).every((k) => (VISUAL_ASSERTION_REPORT_KEYS as readonly string[]).includes(k)), JSON.stringify(hostile));
  add("A2 no planted digest, token, URL or selector is anywhere in the output", !Object.values(SECRET).some((s) => JSON.stringify(sanitize([base({ contentDigest: SECRET.digest, epoch: SECRET.token, url: SECRET.url, selector: SECRET.selector })])).includes(s)));
  const marked = one(base({ code: "<img src=x onerror=alert(1)>", verdictCode: SECRET.url, stepId: SECRET.selector, flowId: "flow with spaces" }));
  add("A3 markup, URLs and free text as codes or ids read 'invalid'", marked?.code === "invalid" && marked.verdictCode === "invalid" && marked.stepId === "invalid" && marked.flowId === "invalid", JSON.stringify(marked));
  const polluted = sanitize([JSON.parse(`{"version":1,"stepId":"s","flowId":"f","mode":"observe","flag":"observe","appMode":"dev","status":"passed","code":"x","candidate":false,"durationMs":1,"__proto__":{"polluted":true}}`)]);
  add("A4 a __proto__ key pollutes nothing", polluted?.length === 1 && !("polluted" in (polluted[0] as object)) && !("polluted" in {}));
  add(
    "A5 non-objects, arrays, other versions and missing required fields are dropped",
    sanitize([null, 7, "x", [base()], base({ version: 2 }), base({ mode: "strict" }), base({ status: "skipped" }), base({ candidate: "yes" }), base({ durationMs: -1 }), base({ durationMs: "5" }), base({ appMode: "production" })]) === undefined
  );
  add("A6 a non-array block is absent", sanitize({ 0: base() }) === undefined && sanitize("[]") === undefined && sanitize(undefined) === undefined);
  const capped = sanitize(Array.from({ length: VISUAL_ASSERTION_REPORT_MAX_RECORDS + 40 }, () => base()));
  add(`A7 at most ${VISUAL_ASSERTION_REPORT_MAX_RECORDS} records per instance`, capped?.length === VISUAL_ASSERTION_REPORT_MAX_RECORDS);
  const long = one(base({ durationMs: 9_999_999.6 }));
  add("A8 the duration is rounded and bounded", long?.durationMs === 600_000 && one(base({ durationMs: 12.6 }))?.durationMs === 13);
  const fakeMismatch = one(base({ mode: "enforce", status: "failed", failureClass: "visual-mismatch", verdict: "inconclusive", verdictCode: "budget-exhausted", code: "budget-exhausted" }));
  add("A9 a mismatch without a failed verdict is never kept: it reads visual-unverified", fakeMismatch?.failureClass === "visual-unverified");
  const noVerdictMismatch = one(base({ mode: "enforce", status: "failed", failureClass: "visual-mismatch", verdict: undefined, verdictCode: undefined, code: "cell-not-qualified" }));
  add("A10 a mismatch with no verdict at all reads visual-unverified", noVerdictMismatch?.failureClass === "visual-unverified" && noVerdictMismatch.verdict === undefined);
  const realMismatch = one(base({ mode: "enforce", flag: "enforce", status: "failed", failureClass: "visual-mismatch", verdict: "failed", verdictCode: "commitment-differs", code: "commitment-differs" }));
  add("A11 a real mismatch (failed verdict) is kept", realMismatch?.failureClass === "visual-mismatch");
  const classless = one(base({ mode: "enforce", status: "failed", failureClass: undefined, code: "enforce-unavailable-in-production", appMode: "packaged", verdict: undefined, verdictCode: undefined }));
  add("A12 a failed record without a class reads visual-unverified", classless?.failureClass === "visual-unverified");
  const passedWithClass = one(base({ failureClass: "visual-mismatch" }));
  add("A13 a passed record never carries a failure class", passedWithClass !== undefined && !("failureClass" in passedWithClass));
  add("A14 an unknown candidateWithheld reason is dropped", !("candidateWithheld" in (one(base({ candidateWithheld: "admin-override" })) ?? {})) && one(base({ candidateWithheld: "run-unattributed" }))?.candidateWithheld === "run-unattributed");
  add(
    "A16 a passed enforce record without a passed verdict is dropped, never shown as proven equality",
    sanitize([base({ mode: "enforce", verdict: undefined, verdictCode: undefined, code: "equal-commitments" })]) === undefined &&
      sanitize([base({ mode: "enforce", verdict: "inconclusive", verdictCode: "budget-exhausted" })]) === undefined &&
      sanitize([base({ mode: "enforce", flag: "enforce" })])?.length === 1
  );
  const mixed = [base(),base({ code: "<b>" }), base({ version: 3 }), base({ status: "failed", failureClass: "visual-unverified", mode: "enforce", code: "grant-expired", verdict: undefined, verdictCode: undefined })];
  const once = sanitize(mixed);
  add("A15 sanitizing is idempotent and survives a JSON round trip", JSON.stringify(sanitize(JSON.parse(JSON.stringify(once)))) === JSON.stringify(once) && once?.length === 3);

  // B. Totals.
  const records = sanitize([
    base(),
    base({ verdict: "failed", verdictCode: "commitment-differs", code: "commitment-differs", candidate: false }),
    base({ verdict: "inconclusive", verdictCode: "no-baseline", code: "no-baseline", candidate: true }),
    base({ mode: "enforce", flag: "enforce", status: "failed", failureClass: "visual-mismatch", verdict: "failed", verdictCode: "commitment-differs", code: "commitment-differs" }),
    base({ mode: "enforce", status: "failed", failureClass: "visual-unverified", code: "cell-not-qualified", verdict: "passed" }),
    base({ mode: "enforce", flag: "enforce", status: "passed", code: "equal-commitments" })
  ])!;
  const t = visualAssertionTotals(records);
  add(
    "B1 instance totals count passed, mismatch, unverified, observed differences, observed without proof and candidates",
    t.total === 6 && t.passed === 4 && t.mismatch === 1 && t.unverified === 1 && t.observedDifferent === 1 && t.observedInconclusive === 1 && t.candidates === 1,
    JSON.stringify(t)
  );
  const run = visualAssertionRunTotals([{ visualAssertions: records }, {}, { visualAssertions: "hostile" }, { visualAssertions: [base({ status: "failed", mode: "enforce", code: "grant-expired", verdict: undefined, verdictCode: undefined })] }]);
  add("B2 run totals sum every instance, ignoring legacy and hostile blocks", run?.total === 7 && run.unverified === 2 && run.mismatch === 1, JSON.stringify(run));
  add("B3 a run with no assertions has no totals", visualAssertionRunTotals([{}, { visualAssertions: [] }]) === null);
  return out;
}

async function persistence(): Promise<Outcome[]> {
  const out: Outcome[] = [];
  const add = (label: string, ok: unknown, detail?: string): void => {
    out.push({ label, ok: !!ok, detail });
  };
  const root = mkdtempSync(join(tmpdir(), "awkit-n6-report-"));
  try {
    const service = new ReportService(root);
    const block = sanitizeVisualAssertionReportRecords([base({ candidate: true, verdict: "inconclusive", verdictCode: "no-baseline", code: "no-baseline" })])!;
    const instance = (id: string, extra: Partial<InstanceReport> = {}): InstanceReport => ({ instanceId: id, status: "passed", durationMs: 10, screenshots: [], downloadedFiles: [], ...extra });
    const report: ConcurrentRunReport = {
      executionId: "exec-n6-report",
      scenarioId: "wf",
      scenarioName: "WF",
      runMode: "concurrent",
      maxConcurrentInstances: 2,
      status: "passed",
      startedAt: new Date(0).toISOString(),
      endedAt: new Date(10).toISOString(),
      durationMs: 10,
      passedFlows: 2,
      failedFlows: 0,
      skippedFlows: 0,
      instances: [instance("i1", { visualAssertions: block }), instance("i2")],
      runtimeInputs: {}
    };
    const path = await service.writeReport(report);
    const stored = JSON.parse(readFileSync(path, "utf8")) as ConcurrentRunReport;
    add("C1 the block is written and read back from disk unchanged", JSON.stringify(sanitizeVisualAssertionReportRecords(stored.instances[0].visualAssertions)) === JSON.stringify(block));
    add("C2 an instance without assertions has no field on disk", !("visualAssertions" in stored.instances[1]));
    add("C3 the stored block holds no planted secret", !Object.values(SECRET).some((s) => readFileSync(path, "utf8").includes(s)));

    const legacy = { ...report, executionId: "exec-legacy", instances: [instance("old")] } as ConcurrentRunReport;
    const legacyPath = await service.writeReport(legacy);
    const legacyRead = JSON.parse(readFileSync(legacyPath, "utf8")) as ConcurrentRunReport;
    add("C4 a report written before N6 reads with no block and no run totals", sanitizeVisualAssertionReportRecords(legacyRead.instances[0].visualAssertions) === undefined && visualAssertionRunTotals(legacyRead.instances) === null);
    const n5 = { ...report, executionId: "exec-n5", instances: [instance("n5", { status: "failed", visualDiagnosis: [] })] } as ConcurrentRunReport;
    const n5Read = JSON.parse(readFileSync(await service.writeReport(n5), "utf8")) as ConcurrentRunReport;
    add("C5 an N5-only report keeps its fields and gains no assertion block", "visualDiagnosis" in n5Read.instances[0] && !("visualAssertions" in n5Read.instances[0]));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  return out;
}

function wiring(): Outcome[] {
  const out: Outcome[] = [];
  const add = (label: string, ok: unknown, detail?: string): void => {
    out.push({ label, ok: !!ok, detail });
  };
  const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
  const moduleText = read("src/runner/visualAssertion/visualAssertionReport.ts");
  add("D1 the record module imports nothing", !/^\s*import\s/m.test(moduleText) && !/require\(/.test(moduleText));
  const engine = read("src/runner/ExecutionEngine.ts");
  add(
    "D2 the engine collects every decision, capped, through the runner's onRecord",
    /visualAssertionOptions\(this\.instanceInitiators\.get\(instance\.instanceId\), \(record\) => \{\s*if \(visualAssertionRecords\.length < VISUAL_ASSERTION_REPORT_MAX_RECORDS\) visualAssertionRecords\.push\(\{ version: 1, \.\.\.record \}\);/.test(engine)
  );
  add(
    "D3 the engine sanitizes the block onto the instance report only when non-empty",
    /const visualAssertions = sanitizeVisualAssertionReportRecords\(visualAssertionRecords\);\s*if \(visualAssertions\) instanceReport\.visualAssertions = visualAssertions;/.test(engine)
  );
  const section = read("app/renderer/components/reports/VisualAssertionReportSection.tsx");
  const designer = read("app/renderer/components/workflow/VisualAssertionSection.tsx");
  add("D4 the drawer and the Designer read the block only through the sanitizer", /sanitizeVisualAssertionReportRecords\(instance\?\.visualAssertions\)/.test(section) && /visualAssertionRunTotals\(report\.instances\)/.test(section) && /sanitizeVisualAssertionReportRecords\(instance\.visualAssertions\)/.test(designer));
  add("D5 the drawer section renders no image and its icons are decorative", !/<img|<canvas|<picture|<video/.test(section) && !/<(Ban|CheckCircle2|Eye|XCircle) size=\{13\}(?! aria-hidden="true")/.test(section));
  add("D6 the drawer shows the section for every instance (it lives beside the failure evidence)", /<VisualAssertionReportSection executionId=\{data\.run\.executionId\} instanceId=\{instanceId\} \/>/.test(read("app/renderer/components/reports/RunDetailDrawer.tsx")));

  const mismatch = visualAssertionSentence(sanitizeVisualAssertionReportRecords([base({ mode: "enforce", status: "failed", failureClass: "visual-mismatch", verdict: "failed", verdictCode: "commitment-differs", code: "commitment-differs" })])![0]);
  const unverified = visualAssertionSentence(sanitizeVisualAssertionReportRecords([base({ mode: "enforce", status: "failed", failureClass: "visual-unverified", code: "enforce-unavailable-in-production", appMode: "packaged", verdict: undefined, verdictCode: undefined })])![0]);
  add("D7 visual mismatch and visual unverified are worded apart, never as each other", /visual mismatch/.test(mismatch) && !/unverified/.test(mismatch) && /visual unverified/.test(unverified) && !/mismatch/.test(unverified), `${mismatch} | ${unverified}`);
  add("D8 a packaged enforce step reads as unavailable in this build", /does not enforce visual assertions/.test(unverified));
  const observed = visualAssertionSentence(sanitizeVisualAssertionReportRecords([base({ verdict: "failed", verdictCode: "commitment-differs", code: "commitment-differs" })])![0]);
  add("D9 an observed difference says observe never fails a step", /Observe never fails a step/.test(observed) && !/^Failed/.test(observed));
  return out;
}

async function main(): Promise<void> {
  let passed = 0;
  let failed = 0;
  const report = (title: string, outcomes: Outcome[]): void => {
    console.log(title);
    for (const o of outcomes) {
      if (o.ok) passed += 1;
      else failed += 1;
      console.log(`  ${o.ok ? "✓" : "✗"} ${o.label}${!o.ok && o.detail ? ` — ${o.detail}` : ""}`);
    }
  };
  report("A-B. Sanitizer and totals", suite(sanitizeVisualAssertionReportRecords));
  report("C. Persistence and backward compatibility", await persistence());
  report("D. Wiring and copy", wiring());

  console.log("E. Mutants (each must fail the suite)");
  const mutants: [string, Sanitize][] = [
    ["the input is spread instead of rebuilt", (v) => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object" && !Array.isArray(x) && (x as { version?: number }).version === 1) as VisualAssertionReportRecord[]) : undefined)],
    ["the failure class is copied as given", (v) => sanitizeVisualAssertionReportRecords(v)?.map((r, i) => ({ ...r, ...(Array.isArray(v) && (v[i] as { failureClass?: string })?.failureClass ? { failureClass: (v[i] as VisualAssertionReportRecord).failureClass } : {}) }))],
    [
      "no record cap",
      (v) => {
        const all = Array.isArray(v) ? v.flatMap((x) => sanitizeVisualAssertionReportRecords([x]) ?? []) : [];
        return all.length > 0 ? all : undefined;
      }
    ],
    ["codes are not validated", (v) => sanitizeVisualAssertionReportRecords(v)?.map((r, i) => ({ ...r, code: String((Array.isArray(v) && (v[i] as { code?: string })?.code) ?? r.code) }))]
  ];
  for (const [name, mutant] of mutants) {
    const red = suite(mutant).filter((o) => !o.ok);
    if (red.length > 0) passed += 1;
    else failed += 1;
    console.log(`  ${red.length > 0 ? "✓" : "✗"} mutant "${name}" is caught${red.length > 0 ? ` (${red[0].label})` : ""}`);
  }

  console.log(`\nverify:visual-assertion-report: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
