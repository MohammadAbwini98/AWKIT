/**
 * verify:ocr-report — Phase N, N7.5 (awkit-vra.9.6): the codes-only `InstanceReport.ocrAssertions` block, its
 * allowlist sanitizer on write and on read, persistence, import, export and the drawer and Designer copy.
 *
 *  A. Adversarial sanitizer: a record carrying ANY key outside the allowlist (recognized or expected text, pixels,
 *     boxes, selectors, URLs, secret references, prototype keys) is dropped whole; malformed ids, codes, buckets,
 *     counts and durations are dropped; a verdict is never strengthened (matched only with text-matched, differs only
 *     with text-differs); at most 64 records; idempotent across a JSON round trip.
 *  B. Totals per instance and per run, with legacy and hostile instances mixed in.
 *  C. Persistence through the real `ReportService.writeReport` on a temp root, read back from disk; legacy reports
 *     (no field) and N6-only reports read exactly as before.
 *  D. Import (`reports:create` -> `withSanitizedOcrAssertions`): a hostile imported block is rebuilt or removed, every
 *     other field untouched. Export (`ReportExportService`, JSON, CSV and XLSX) never carries the block.
 *  E. Wiring and copy: the record module imports nothing; the engine collects, caps and sanitizes onto the instance
 *     report only when non-empty; the drawer and the Designer read through the sanitizer; no image, no text field.
 *  F. Mutants of the sanitizer must each turn the suite red.
 *
 * Run: npm run verify:ocr-report
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ConcurrentRunReport, InstanceReport } from "@src/reports/ExecutionReport";
import { ReportService } from "@src/reports/ReportService";
import { ReportExportService } from "@src/reports/ReportExportService";
import {
  OCR_ASSERTION_REPORT_KEYS,
  OCR_ASSERTION_REPORT_MAX_RECORDS,
  ocrAssertionRunTotals,
  ocrAssertionTotals,
  sanitizeOcrAssertionReportRecords,
  withSanitizedOcrAssertions,
  type OcrAssertionReportRecord
} from "@src/runner/ocr/ocrAssertionReport";
import { imageTextFacts, imageTextSentence } from "../app/renderer/components/reports/ImageTextReportSection";
import { TEXT_ASSERTION_CODES } from "@src/visual/ocr/decideTextAssertion";

type Sanitize = (value: unknown) => OcrAssertionReportRecord[] | undefined;
type Outcome = { label: string; ok: boolean; detail?: string };

const SECRET = {
  recognized: "Invoice 4471 Total 1284.50",
  expected: "Order 4521 shipped",
  url: "https://secret.example/orders?token=n7-report-secret",
  selector: "[data-testid=private-label]",
  secretRef: "vault://payments/card"
};

const base = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 1,
  stepId: "ocr-assert",
  flowId: "flow-1",
  mode: "observe",
  status: "passed",
  verdict: "matched",
  code: "text-matched",
  distanceBucket: "exact",
  confidenceBucket: "ge-95",
  charCount: 18,
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
  const clean = one(base());
  add("A1 a well-formed record survives with exactly the allowlisted keys", !!clean && Object.keys(clean).every((k) => (OCR_ASSERTION_REPORT_KEYS as readonly string[]).includes(k)) && Object.keys(clean).length === 11, JSON.stringify(clean));
  for (const [name, key, value] of [
    ["recognized text", "text", SECRET.recognized],
    ["expected text", "expected", SECRET.expected],
    ["words", "words", [{ text: "Invoice", confidence: 99 }]],
    ["pixels", "pngBase64", "iVBORw0KGgo="],
    ["a box", "box", { x: 1, y: 2, width: 3, height: 4 }],
    ["a selector", "selector", SECRET.selector],
    ["a URL", "url", SECRET.url],
    ["a secret reference", "secretRef", SECRET.secretRef],
    ["an engine internal", "recognizeMs", 51]
  ] as const) {
    add(`A2 a record carrying ${name} is dropped whole (never stripped and kept)`, sanitize([base({ [key]: value })]) === undefined);
  }
  const planted = String(JSON.stringify(sanitize([base({ text: SECRET.recognized }), base({ code: SECRET.url }), base({ stepId: SECRET.selector }), base()])));
  add("A3 no planted text, URL, selector or secret reference survives anywhere, and the clean record does", !Object.values(SECRET).some((s) => planted.includes(s)) && sanitize([base()])?.length === 1);
  const polluted = sanitize([JSON.parse(`{"version":1,"stepId":"s","flowId":"f","mode":"observe","status":"passed","code":"disabled","durationMs":0,"__proto__":{"polluted":true}}`)]);
  add("A4 a __proto__ key is an unexpected key: the record is dropped and nothing is polluted", polluted === undefined && !("polluted" in {}));
  add(
    "A5 malformed records are dropped: non-objects, arrays, other versions, modes or statuses, bad ids, codes and durations",
    sanitize([
      null,
      7,
      "x",
      [base()],
      base({ version: 2 }),
      base({ mode: "enforce" }),
      base({ status: "failed" }),
      base({ stepId: "" }),
      base({ stepId: "has spaces" }),
      base({ flowId: "<b>" }),
      base({ code: "<img src=x onerror=alert(1)>" }),
      base({ code: "Text-Matched" }),
      base({ durationMs: -1 }),
      base({ durationMs: "5" }),
      base({ durationMs: 600_001 }),
      base({ durationMs: Number.NaN })
    ]) === undefined
  );
  add(
    "A6 bad buckets and counts are dropped",
    sanitize([base({ distanceBucket: "close" }), base({ confidenceBucket: "high" }), base({ charCount: -1 }), base({ charCount: 1.5 }), base({ charCount: 100_001 }), base({ charCount: "18" }), base({ verdict: "passed" })]) === undefined
  );
  add("A7 a non-array block is absent", sanitize({ 0: base() }) === undefined && sanitize("[]") === undefined && sanitize(undefined) === undefined && sanitize([]) === undefined);
  const capped = sanitize(Array.from({ length: OCR_ASSERTION_REPORT_MAX_RECORDS + 40 }, () => base()));
  add(`A8 at most ${OCR_ASSERTION_REPORT_MAX_RECORDS} records per instance`, capped?.length === OCR_ASSERTION_REPORT_MAX_RECORDS);
  add("A9 the duration is rounded", one(base({ durationMs: 12.6 }))?.durationMs === 13);
  add(
    "A10 a verdict is never strengthened: matched needs text-matched, differs needs text-differs, and those codes need their verdict",
    sanitize([base({ verdict: "matched", code: "near-miss" }), base({ verdict: "differs", code: "low-confidence" }), base({ verdict: "inconclusive", code: "text-matched" }), base({ verdict: undefined, code: "text-differs" })]) === undefined &&
      one(base({ verdict: "differs", code: "text-differs", distanceBucket: "many-edits" }))?.verdict === "differs"
  );
  const disabled = one({ version: 1, stepId: "s", flowId: "", mode: "observe", status: "passed", code: "disabled", durationMs: 0 });
  add("A11 a disabled record (no verdict, empty flow id) is kept as not evaluated", disabled?.code === "disabled" && disabled.verdict === undefined && disabled.flowId === "");
  const mixed = [base(), base({ text: "x" }), base({ version: 3 }), base({ verdict: "inconclusive", code: "budget-exhausted", distanceBucket: undefined, confidenceBucket: undefined, charCount: undefined })];
  const once = sanitize(mixed);
  add("A12 sanitizing is idempotent and survives a JSON round trip", JSON.stringify(sanitize(JSON.parse(JSON.stringify(once)))) === JSON.stringify(once) && once?.length === 2);

  // B. Totals.
  const records = sanitize([
    base(),
    base({ verdict: "differs", code: "text-differs", distanceBucket: "many-edits" }),
    base({ verdict: "inconclusive", code: "near-miss", distanceBucket: "one-edit" }),
    base({ verdict: "inconclusive", code: "sensitive-input", distanceBucket: undefined, confidenceBucket: undefined, charCount: undefined }),
    { version: 1, stepId: "off", flowId: "flow-1", mode: "observe", status: "passed", code: "disabled", durationMs: 0 }
  ]);
  const t = records ? ocrAssertionTotals(records) : null;
  add("B1 instance totals count matched, differs, inconclusive and not evaluated", t?.total === 5 && t.matched === 1 && t.differs === 1 && t.inconclusive === 2 && t.notEvaluated === 1, JSON.stringify(t));
  const run = ocrAssertionRunTotals([{ ocrAssertions: records }, {}, { ocrAssertions: "hostile" }, { ocrAssertions: [base({ text: SECRET.recognized })] }, { ocrAssertions: [base()] }]);
  add("B2 run totals sum every instance, ignoring legacy and hostile blocks", run?.total === 6 && run.matched === 2, JSON.stringify(run));
  add("B3 a run with no OCR assertions has no totals", ocrAssertionRunTotals([{}, { ocrAssertions: [] }]) === null);
  return out;
}

const instance = (id: string, extra: Partial<InstanceReport> = {}): InstanceReport => ({ instanceId: id, status: "passed", durationMs: 10, screenshots: [], downloadedFiles: [], ...extra });
const runReport = (executionId: string, instances: InstanceReport[]): ConcurrentRunReport => ({
  executionId,
  scenarioId: "wf",
  scenarioName: "WF",
  runMode: "concurrent",
  maxConcurrentInstances: 2,
  status: "passed",
  startedAt: new Date(0).toISOString(),
  endedAt: new Date(10).toISOString(),
  durationMs: 10,
  passedFlows: instances.length,
  failedFlows: 0,
  skippedFlows: 0,
  instances,
  runtimeInputs: {}
});

async function persistence(): Promise<Outcome[]> {
  const out: Outcome[] = [];
  const add = (label: string, ok: unknown, detail?: string): void => {
    out.push({ label, ok: !!ok, detail });
  };
  const root = mkdtempSync(join(tmpdir(), "awkit-n7-report-"));
  try {
    const service = new ReportService(root);
    const block = sanitizeOcrAssertionReportRecords([base(), base({ stepId: "ocr-2", verdict: "inconclusive", code: "protected-surface", distanceBucket: undefined, confidenceBucket: undefined, charCount: undefined })])!;
    const path = await service.writeReport(runReport("exec-n7-report", [instance("i1", { ocrAssertions: block }), instance("i2")]));
    const raw = readFileSync(path, "utf8");
    const stored = JSON.parse(raw) as ConcurrentRunReport;
    add("C1 the block is written and read back from disk unchanged", JSON.stringify(sanitizeOcrAssertionReportRecords(stored.instances[0].ocrAssertions)) === JSON.stringify(block));
    add("C2 an instance without OCR assertions has no field on disk", !("ocrAssertions" in stored.instances[1]));
    add("C3 the stored report holds no planted text, URL, selector or secret reference", !Object.values(SECRET).some((s) => raw.includes(s)));

    const legacy = JSON.parse(readFileSync(await service.writeReport(runReport("exec-legacy", [instance("old")])), "utf8")) as ConcurrentRunReport;
    add("C4 a report written before N7.5 reads with no block and no run totals", sanitizeOcrAssertionReportRecords(legacy.instances[0].ocrAssertions) === undefined && ocrAssertionRunTotals(legacy.instances) === null);
    const n6 = JSON.parse(readFileSync(await service.writeReport(runReport("exec-n6", [instance("n6", { visualAssertions: [] })])), "utf8")) as ConcurrentRunReport;
    add("C5 an N6-only report keeps its fields and gains no OCR block", "visualAssertions" in n6.instances[0] && !("ocrAssertions" in n6.instances[0]));

    // D. Import: what reports:create stores.
    const hostileImport = runReport("exec-import", [
      instance("imp-1", { ocrAssertions: [base(), base({ text: SECRET.recognized }), base({ code: SECRET.url })] as never, error: "kept as is" }),
      instance("imp-2", { ocrAssertions: [base({ expected: SECRET.expected })] as never }),
      instance("imp-3")
    ]);
    const imported = hostileImport.instances.map((i) => withSanitizedOcrAssertions(i));
    add(
      "D1 an imported block is rebuilt from the allowlist: hostile records dropped, the clean one kept",
      imported[0].ocrAssertions?.length === 1 && JSON.stringify(imported[0].ocrAssertions) === JSON.stringify(sanitizeOcrAssertionReportRecords([base()])),
      JSON.stringify(imported[0].ocrAssertions)
    );
    add("D2 an imported block where nothing survives is removed, not kept empty", !("ocrAssertions" in imported[1]));
    add("D3 every other imported field is left exactly as it was (a legacy instance is returned unchanged)", imported[0].error === "kept as is" && imported[2] === hostileImport.instances[2]);
    const importedPath = await service.writeReport({ ...hostileImport, instances: imported });
    add("D4 the imported report on disk holds no planted text, URL or expected text", !Object.values(SECRET).some((s) => readFileSync(importedPath, "utf8").includes(s)));

    // Export: the block is never in any format.
    const exporter = new ReportExportService();
    const withBlock = runReport("exec-export", [instance("e1", { ocrAssertions: block })]);
    const decoded: string[] = [];
    for (const format of ["json", "csv"] as const) decoded.push(Buffer.from((await exporter.export(withBlock, format)).dataBase64, "base64").toString("utf8"));
    const xlsx = Buffer.from((await exporter.export(withBlock, "xlsx")).dataBase64, "base64");
    add("D5 JSON and CSV exports carry no OCR block, code or bucket", decoded.every((text) => !/ocrAssertions|text-matched|confidenceBucket|distanceBucket|ge-95/.test(text)), decoded[0].slice(0, 200));
    add("D6 the XLSX export carries no OCR block (no code or bucket in the workbook bytes)", xlsx.length > 0 && !xlsx.includes(Buffer.from("text-matched")) && !xlsx.includes(Buffer.from("ocrAssertions")));
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
  const moduleText = read("src/runner/ocr/ocrAssertionReport.ts");
  add("E1 the record module imports nothing", !/^\s*import\s/m.test(moduleText) && !/require\(/.test(moduleText));
  const engine = read("src/runner/ExecutionEngine.ts");
  add(
    "E2 the engine collects every observation, capped, through the runner's onRecord",
    /ocrAssertions: this\.ocrAssertionOptions\(\(record\) => \{\s*if \(ocrAssertionRecords\.length < OCR_ASSERTION_REPORT_MAX_RECORDS\) ocrAssertionRecords\.push\(\{ version: 1, \.\.\.record \}\);/.test(engine)
  );
  add(
    "E3 the engine sanitizes the block onto the instance report only when non-empty",
    /const ocrAssertions = sanitizeOcrAssertionReportRecords\(ocrAssertionRecords\);\s*if \(ocrAssertions\) instanceReport\.ocrAssertions = ocrAssertions;/.test(engine)
  );
  add("E4 reports:create rebuilds every imported instance's block through the sanitizer", /instances: report\.instances\.map\(\(instance\) => withSanitizedOcrAssertions\(instance\)\)/.test(read("app/main/ipc/report.ipc.ts")));
  const section = read("app/renderer/components/reports/ImageTextReportSection.tsx");
  const designer = read("app/renderer/components/workflow/ImageTextAssertionSection.tsx");
  add(
    "E5 the drawer and the Designer read the block only through the sanitizer",
    /sanitizeOcrAssertionReportRecords\(instance\?\.ocrAssertions\)/.test(section) && /ocrAssertionRunTotals\(report\.instances\)/.test(section) && /sanitizeOcrAssertionReportRecords\(instance\.ocrAssertions\)/.test(designer)
  );
  add("E6 the drawer section renders no image and its icons are decorative", !/<img|<canvas|<picture|<video/.test(section) && !/<(CheckCircle2|CircleSlash|Eye|HelpCircle|ScanText) size=\{13\}(?! aria-hidden="true")/.test(section));
  add("E7 the drawer shows the section for every instance, beside the visual assertions", /<ImageTextReportSection executionId=\{data\.run\.executionId\} instanceId=\{instanceId\} \/>/.test(read("app/renderer/components/reports/RunDetailDrawer.tsx")));
  add("E8 neither UI section reads a text field from a record (there is none to read)", !/record\.(text|expected|words|recognized)/.test(section + designer));

  const [matched, differs, near, off] = sanitizeOcrAssertionReportRecords([
    base(),
    base({ verdict: "differs", code: "text-differs", distanceBucket: "many-edits" }),
    base({ verdict: "inconclusive", code: "near-miss", distanceBucket: "one-edit" }),
    { version: 1, stepId: "s", flowId: "f", mode: "observe", status: "passed", code: "disabled", durationMs: 0 }
  ])!;
  add("E9 matched and differs are worded apart; differs says observe never fails a step", /expected text/.test(imageTextSentence(matched)) && /different text/.test(imageTextSentence(differs)) && /Observe never fails a step/.test(imageTextSentence(differs)));
  add("E10 an inconclusive observation names its reason; disabled says OCR is off", /slightly/.test(imageTextSentence(near)) && /Not evaluated/.test(imageTextSentence(off)) && /AWKIT_VISUAL_OCR/.test(imageTextSentence(off)));
  add("E11 the facts line names buckets, count and duration only", imageTextFacts(matched) === "difference: no character edits; reader confidence: 95% or more; 18 characters read; took 412 ms.", imageTextFacts(matched));
  const everySentence = [matched, differs, near, off].map((r) => imageTextSentence(r) + imageTextFacts(r)).join(" ");
  add("E12 no sentence contains a recognized or expected text", !Object.values(SECRET).some((s) => everySentence.includes(s)));

  // N7 amendment A1.9 (copy approved 2026-10-31): the recognizer is unqualified (OC-10 NOT MET), so every verdict is
  // unverified OCR evidence and no sentence may state what the element shows as fact.
  type Sentence = (record: OcrAssertionReportRecord) => string;
  const ASSERTS_TRUTH = /Observed:|the element shows|\bis confirmed\b|\bwas confirmed\b|\bverified (?:text|match)\b|\bthe text read\b|\bwas read more\b|\bno text was read\b/i;
  const verdictRecords = [
    { verdict: "matched", code: "text-matched" },
    { verdict: "differs", code: "text-differs" },
    ...Object.entries(TEXT_ASSERTION_CODES).filter(([, verdict]) => verdict === "inconclusive").map(([code]) => ({ verdict: "inconclusive", code }))
  ] as unknown as OcrAssertionReportRecord[];
  const offending = (sentence: Sentence) => verdictRecords.filter((r) => ASSERTS_TRUTH.test(sentence(r)) || !sentence(r).startsWith("Unverified OCR evidence:"));
  const misleading = (sentence: Sentence) => offending(sentence).length > 0;
  const legacySentence: Sentence = (r) =>
    r.verdict === "matched" ? "Observed: the element shows the expected text." : r.verdict === "differs" ? "Observed: the element shows different text. Observe never fails a step." : "Observed without a verdict: the text read differs only slightly from the expected text. Observe never fails a step.";
  add(`E13 every verdict sentence (${verdictRecords.length} codes) is labelled unverified OCR evidence and none states the element's text as fact`, !misleading(imageTextSentence), offending(imageTextSentence).map((r) => `${r.code}: ${imageTextSentence(r)}`).join(" | "));
  add("E13 negative control: the pre-A1.9 copy is caught as misleading", misleading(legacySentence));
  add("E14 a not-evaluated step is never labelled as OCR evidence", /^Not evaluated/.test(imageTextSentence(off)) && !imageTextSentence(off).includes("Unverified OCR evidence"));
  add(
    "E15 the drawer heading and totals carry the label, and a reported match shows no success check mark",
    /const UNVERIFIED_OCR_PHRASE = "unverified OCR evidence";/.test(section) && /Image text \(\{UNVERIFIED_OCR_PHRASE\}\)/.test(section) && /observe only, \$\{UNVERIFIED_OCR_PHRASE\}/.test(section) && !/CheckCircle2/.test(section)
  );
  add("E16 the Designer explains that results are unverified OCR evidence, not a confirmed check", /Results are unverified OCR\s+evidence/.test(designer) && /not a confirmed check/.test(designer) && /does not prove the element is wrong/.test(designer));
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
  report("A-B. Sanitizer and totals", suite(sanitizeOcrAssertionReportRecords));
  report("C-D. Persistence, backward compatibility, import and export", await persistence());
  report("E. Wiring and copy", wiring());

  console.log("F. Mutants (each must fail the suite)");
  const keep = (v: unknown) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object" && !Array.isArray(x)) : []) as Record<string, unknown>[];
  const mutants: [string, Sanitize][] = [
    ["the input is passed through instead of rebuilt", (v) => {
      const all = keep(v).filter((x) => x.version === 1) as unknown as OcrAssertionReportRecord[];
      return all.length ? all : undefined;
    }],
    ["unexpected keys are stripped and the record kept", (v) => {
      const all = keep(v).flatMap((x) => sanitizeOcrAssertionReportRecords([Object.fromEntries(Object.entries(x).filter(([k]) => (OCR_ASSERTION_REPORT_KEYS as readonly string[]).includes(k)))]) ?? []);
      return all.length ? all.slice(0, OCR_ASSERTION_REPORT_MAX_RECORDS) : undefined;
    }],
    ["the verdict is copied without its code check", (v) => {
      const all = keep(v).flatMap((x) => {
        const r = sanitizeOcrAssertionReportRecords([{ ...x, verdict: "inconclusive", code: x.code === "text-matched" || x.code === "text-differs" ? "near-miss" : x.code }]);
        return r ? [{ ...r[0], ...(typeof x.verdict === "string" ? { verdict: x.verdict as OcrAssertionReportRecord["verdict"] } : {}), code: String(x.code) }] : [];
      });
      return all.length ? all : undefined;
    }],
    ["no record cap", (v) => {
      const all = keep(v).flatMap((x) => sanitizeOcrAssertionReportRecords([x]) ?? []);
      return all.length ? all : undefined;
    }],
    ["codes are not validated", (v) => sanitizeOcrAssertionReportRecords(keep(v).map((x) => ({ ...x, code: "near-miss" })))?.map((r, i) => ({ ...r, code: String(keep(v)[i]?.code ?? r.code) }))]
  ];
  for (const [name, mutant] of mutants) {
    const red = suite(mutant).filter((o) => !o.ok);
    if (red.length > 0) passed += 1;
    else failed += 1;
    console.log(`  ${red.length > 0 ? "✓" : "✗"} mutant "${name}" is caught${red.length > 0 ? ` (${red[0].label})` : ""}`);
  }

  console.log(`\nverify:ocr-report: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
