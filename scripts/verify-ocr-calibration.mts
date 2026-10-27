/**
 * verify:ocr-calibration — Phase N, N7.6 (awkit-vra.9.7): the OCR calibration acceptance logic, fixtures, harness
 * wiring and evidence hygiene. Deterministic; it launches nothing. The measurements themselves are benchmark:ocr's.
 *
 *  A. evaluateOcrCell at every ratified boundary (OC-10): 300 launches over 3 sessions, exact match 98 %, CER 1 %, zero
 *     false matched, 100 % unsupported inconclusive, 100 % refusals with zero captures, p95 1500 ms; timeouts and
 *     refusals count against accuracy; failed launches do not count toward 300 but their trials stay; other
 *     environments, diagnostic and cold-probe launches are never merged; duplicate evidence invalidates the cell.
 *  B. The math: Levenshtein, the CER text form, nearest-rank percentiles.
 *  C. The fixture table and the lab: ids, classes, expectations, the font gate, observable show() state, routes.
 *  D. The harness and benchmark are pinned to the real path (real host manager, real executor, no fake engine), the
 *     recognized text is never stored, and qualification refuses without the bundled font.
 *  E. Recorded evidence (if any): only allowlisted trial keys, and no fixture text anywhere in a session file.
 *  F. Mutants of the evidence handling must each change a decision.
 *
 * Run: npm run verify:ocr-calibration
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  OCR_CALIBRATION_CELLS,
  OCR_CALIBRATION_CRITERIA,
  OCR_CALIBRATION_TRIAL_KEYS,
  cerText,
  evaluateOcrCell,
  levenshtein,
  percentile,
  type OcrCalibrationCell,
  type OcrCalibrationLaunch,
  type OcrCalibrationTrial
} from "./lib/ocr-calibration-criteria.mts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

// ── Synthetic evidence ─────────────────────────────────────────────────────────────────────────────────────────────
const CELL: OcrCalibrationCell = { renderMode: "headless", devicePixelRatio: 1 };
const ENV = { chromium: "130", electron: "33", fonts: { a: "1" } };
const t = (fixtureClass: OcrCalibrationTrial["fixtureClass"], extra: Partial<OcrCalibrationTrial> = {}): OcrCalibrationTrial => ({
  fixtureId: `${fixtureClass}-x`,
  fixtureClass,
  verdict: fixtureClass === "supported" ? "matched" : "inconclusive",
  code: fixtureClass === "supported" ? "text-matched" : fixtureClass === "refusal" ? "sensitive-input" : "near-miss",
  durationMs: 700,
  edits: fixtureClass === "supported" ? 0 : null,
  expectedChars: 10,
  ...(fixtureClass === "refusal" ? { expectedCode: "sensitive-input" } : {}),
  captures: fixtureClass === "refusal" ? 0 : 1,
  coldHost: false,
  ...extra
});
let seq = 0;
const launch = (trials: OcrCalibrationTrial[], extra: Partial<OcrCalibrationLaunch> = {}): OcrCalibrationLaunch => ({
  launchId: `L${(seq += 1)}`,
  sessionId: `S${seq % 3}`,
  cell: CELL,
  environment: ENV,
  diagnostic: false,
  coldProbe: false,
  complete: true,
  trials,
  ...extra
});
/** 300 good launches over 3 sessions: 3 supported, 1 confusable, 1 unsupported, 1 refusal each. */
function goodSet(): OcrCalibrationLaunch[] {
  return Array.from({ length: 300 }, () => launch([t("supported"), t("supported"), t("supported"), t("confusable"), t("unsupported"), t("refusal")]));
}
const decide = (launches: OcrCalibrationLaunch[], options?: { diagnostic?: boolean }) => evaluateOcrCell(CELL, ENV, launches, options);
/** Replace the first `n` supported trials of a set with `patch`. */
function patchSupported(set: OcrCalibrationLaunch[], n: number, patch: Partial<OcrCalibrationTrial>): OcrCalibrationLaunch[] {
  let left = n;
  return set.map((l) => ({ ...l, trials: l.trials.map((x) => (x.fixtureClass === "supported" && left-- > 0 ? { ...x, ...patch } : x)) }));
}

console.log("A. Acceptance at the ratified boundaries");
{
  const good = decide(goodSet());
  check("a complete good set of 300 launches over 3 sessions qualifies", good.qualified, good.unmet.join("; "));
  check("criteria are the ratified figures", OCR_CALIBRATION_CRITERIA.minLaunches === 300 && OCR_CALIBRATION_CRITERIA.minSessions === 3 && OCR_CALIBRATION_CRITERIA.exactMatchMin === 0.98 && OCR_CALIBRATION_CRITERIA.cerMax === 0.01 && OCR_CALIBRATION_CRITERIA.p95MaxMs === 1500 && OCR_CALIBRATION_CRITERIA.falseMatchedMax === 0);
  check("OC-9's 1000 ms x64 target is reported, never a criterion", OCR_CALIBRATION_CRITERIA.oc9TargetP95Ms === 1000 && decide(goodSet().map((l) => ({ ...l, trials: l.trials.map((x) => ({ ...x, durationMs: 1200 })) }))).qualified);
  check("the six ratified cells", OCR_CALIBRATION_CELLS.length === 6 && ["headed", "headless"].every((m) => [1, 1.25, 2].every((d) => OCR_CALIBRATION_CELLS.some((c) => c.renderMode === m && c.devicePixelRatio === d))));
  check("299 launches do not qualify", !decide(goodSet().slice(1)).qualified);
  check("two sessions do not qualify", !decide(goodSet().map((l) => ({ ...l, sessionId: l.sessionId === "S2" ? "S1" : l.sessionId }))).qualified);
  // 900 supported trials: 18 misses = exactly 98.00 % (pass), 19 = 97.89 % (fail).
  check("exact match exactly 98 % passes (18 of 900 missed, as differs)", decide(patchSupported(goodSet(), 18, { verdict: "differs", code: "text-differs", edits: 0 })).qualified);
  check("exact match below 98 % fails (19 of 900 missed)", !decide(patchSupported(goodSet(), 19, { verdict: "differs", code: "text-differs", edits: 0 })).qualified);
  // 9000 characters: 90 edits = 1.00 % (pass), 91 = 1.01 % (fail); matched trials with edits keep exact match intact.
  check("CER exactly 1 % passes (90 edits in 9000 characters)", decide(patchSupported(goodSet(), 90, { edits: 1 })).qualified);
  check("CER above 1 % fails (91 edits)", !decide(patchSupported(goodSet(), 91, { edits: 1 })).qualified);
  const timeouts = decide(patchSupported(goodSet(), 19, { verdict: "inconclusive", code: "budget-exhausted", edits: null }));
  check("budget-exhausted supported trials count as misses and as full CER errors (never excluded)", !timeouts.qualified && timeouts.supported.trials === 900 && timeouts.supported.edits === 190 && timeouts.budgetExhausted.trials === 19, JSON.stringify(timeouts.supported));
  const oneFalse = goodSet();
  oneFalse[7] = { ...oneFalse[7], trials: oneFalse[7].trials.map((x) => (x.fixtureClass === "confusable" ? { ...x, verdict: "matched", code: "text-matched" } : x)) };
  check("one false matched on a confusable fixture fails the cell", !decide(oneFalse).qualified && decide(oneFalse).confusable.falseMatched === 1);
  const oneUnsupported = goodSet();
  oneUnsupported[3] = { ...oneUnsupported[3], trials: oneUnsupported[3].trials.map((x) => (x.fixtureClass === "unsupported" ? { ...x, verdict: "differs", code: "text-differs" } : x)) };
  check("one unsupported trial that is not inconclusive fails the cell", !decide(oneUnsupported).qualified);
  const captured = goodSet();
  captured[5] = { ...captured[5], trials: captured[5].trials.map((x) => (x.fixtureClass === "refusal" ? { ...x, captures: 1 } : x)) };
  check("a refusal that captured fails the cell (zero captures is a floor)", !decide(captured).qualified);
  const wrongCode = goodSet();
  wrongCode[5] = { ...wrongCode[5], trials: wrongCode[5].trials.map((x) => (x.fixtureClass === "refusal" ? { ...x, code: "target-hidden" } : x)) };
  check("a refusal with another code fails the cell", !decide(wrongCode).qualified);
  // 1200 latency trials (supported + confusable): p95 is rank 1140.
  const slow = (count: number, ms: number) => {
    let left = count;
    return goodSet().map((l) => ({ ...l, trials: l.trials.map((x) => ((x.fixtureClass === "supported" || x.fixtureClass === "confusable") && left-- > 0 ? { ...x, durationMs: ms } : x)) }));
  };
  check("p95 at 1500 ms passes", decide(slow(60, 1500)).qualified && decide(slow(60, 1500)).latency.p95 === 700);
  check("p95 over 1500 ms fails (61 of 1200 latency trials at 1501 ms)", !decide(slow(61, 1501)).qualified && decide(slow(61, 1501)).latency.p95 === 1501);
  const fastRefusals = goodSet().map((l) => ({ ...l, trials: [...l.trials.map((x) => (x.fixtureClass === "supported" ? { ...x, durationMs: 1600 } : x)), t("refusal", { durationMs: 1 }), t("unsupported", { durationMs: 1 })] }));
  check("instant refusals and pre-engine unsupported trials cannot deflate the p95", !decide(fastRefusals).qualified && decide(fastRefusals).latency.p95 === 1600);
  const failedLaunch = [...goodSet().slice(1), launch([t("supported", { verdict: "differs", code: "text-differs" })], { complete: false, error: "page" })];
  const fl = decide(failedLaunch);
  check("a failed launch does not count toward 300, but its finished trials stay in the statistics", fl.launches.complete === 299 && fl.launches.failed === 1 && fl.supported.trials === 898, JSON.stringify(fl.launches));
  const mixed = [...goodSet().slice(0, 200), ...Array.from({ length: 150 }, () => launch([t("supported")], { environment: { ...ENV, chromium: "131" } }))];
  const mx = decide(mixed);
  check("launches of another environment are never merged (counted and reported)", !mx.qualified && mx.launches.complete === 200 && mx.launches.otherEnvironment === 150);
  const diag = goodSet().map((l) => ({ ...l, diagnostic: true }));
  check("diagnostic evidence never qualifies, and never counts as qualifying evidence", !decide(diag, { diagnostic: true }).qualified && decide(diag).launches.complete === 0);
  const cold = [...goodSet(), ...Array.from({ length: 50 }, () => launch([t("supported", { durationMs: 4000, coldHost: true })], { coldProbe: true }))];
  const cd = decide(cold);
  check("cold-host probe launches never count toward 300 or the qualification latency", cd.qualified && cd.launches.coldProbe === 50 && cd.latency.max === 700);
  const coldInRegular = goodSet().map((l, i) => (i % 100 === 0 ? { ...l, trials: [{ ...l.trials[0], coldHost: true, durationMs: 1400 }, ...l.trials.slice(1)] } : l));
  const cr = decide(coldInRegular);
  check("a session's natural cold first trial stays in the qualification latency and is reported apart", cr.latencyCold.n === 3 && cr.latency.max === 1400 && cr.latencyWarm.max === 700);
  const dupSame = [...goodSet(), ...goodSet().slice(0, 0)];
  dupSame.push({ ...dupSame[0] });
  check("an identical duplicate of a launch is counted once", decide(dupSame).launches.complete === 300 && decide(dupSame).qualified);
  const dupDiff = goodSet();
  dupDiff.push({ ...dupDiff[0], trials: [t("supported", { verdict: "differs", code: "text-differs" })] });
  check("a launch id seen twice with different content invalidates the cell", !decide(dupDiff).qualified && decide(dupDiff).unmet.some((u) => u.includes("duplicate")));
  check("no confusable trials cannot pass", !decide(goodSet().map((l) => ({ ...l, trials: l.trials.filter((x) => x.fixtureClass !== "confusable") }))).qualified);
}

console.log("\nB. The math");
{
  check("Levenshtein: identical 0, one substitution 1, insertion and deletion 1 each", levenshtein("Order 4521", "Order 4521") === 0 && levenshtein("Order 4521", "Order 4527") === 1 && levenshtein("modem", "modems") === 1 && levenshtein("modem", "mode") === 1);
  check("Levenshtein: empty against n is n", levenshtein("", "abc") === 3 && levenshtein("abc", "") === 3);
  check("Levenshtein: rn vs m is 2 edits", levenshtein("modern", "modem") === 2);
  check("CER text: NFKC, whitespace collapsed, case kept", cerText("  Order\n 4521 ") === "Order 4521" && cerText("ﬁle") === "file" && cerText("ABC") !== cerText("abc"));
  check("nearest-rank percentile", percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95) === 10 && percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5) === 5 && percentile([], 0.5) === null);
}

console.log("\nC. The fixture table and the lab");
const tableBytes = readFileSync(path.join(root, "mock-site", "public", "ocr-fixtures.json"));
// The identity mock-site/README.md cites and the benchmark fingerprint carries; printed, never asserted against itself.
console.log(`  fixture table sha256 ${createHash("sha256").update(tableBytes).digest("hex")}`);
const table = JSON.parse(tableBytes.toString("utf8")) as {
  fixtures: Array<{ id: string; class: string; text: string; expected: string; expectCode?: string; minDevicePixelRatio?: number; markup?: string }>;
  font: { family: string; files: string[] };
};
{
  const ids = table.fixtures.map((f) => f.id);
  const byClass = (c: string) => table.fixtures.filter((f) => f.class === c);
  check("fixture ids are unique and stable test-id material", new Set(ids).size === ids.length && ids.every((id) => /^[a-z0-9-]+$/i.test(id)));
  check("every class is one of the four", table.fixtures.every((f) => ["supported", "confusable", "unsupported", "refusal"].includes(f.class)));
  check("supported fixtures expect exactly what they render (newlines as spaces)", byClass("supported").every((f) => cerText(f.text) === cerText(f.expected)));
  check("confusable fixtures expect something they do not render", byClass("confusable").every((f) => f.text !== f.expected));
  check(
    "the plan's look-alike pairs are covered (O/0, l/1, I/1, rn/m, 5/S) and edit-distance-one near misses",
    ["lookalike-O0", "lookalike-l1", "lookalike-I1", "lookalike-rnm", "lookalike-5S"].every((id) => ids.includes(id)) &&
      table.fixtures.filter((f) => f.id.startsWith("nearmiss-")).every((f) => levenshtein(f.text, f.expected) === 1) &&
      table.fixtures.filter((f) => f.id.startsWith("nearmiss-")).length >= 3
  );
  check("unsupported covers non-Latin, 15 degree rotation and vertical text", ["greek", "cyrillic", "rotated-15", "vertical"].every((id) => ids.includes(id)));
  check("small 9, 10 and 11 px, low contrast, texture, antialiasing, multiline, mixed case and long text are covered", ["small-9", "small-10", "small-11", "low-contrast", "textured", "antialiased", "multiline", "mixed-case", "long"].every((id) => ids.includes(id)));
  check("the 9 px fixture's DPR floor is the N7.2 x-height reach (9 x 0.5 x DPR x 4 >= 20)", table.fixtures.find((f) => f.id === "small-9")?.minDevicePixelRatio === 1.12 && 9 * 0.5 * 1.12 * 4 >= 20 && 9 * 0.5 * 1 * 4 < 20);
  check("refusal fixtures each name their code (sensitive input, sensitive container, protected page)", byClass("refusal").every((f) => !!f.expectCode) && ["sensitive-input", "sensitive-step", "protected-surface"].every((c) => byClass("refusal").some((f) => f.expectCode === c)));
  const page = readFileSync(path.join(root, "mock-site", "public", "visual-intelligence-ocr.html"), "utf8");
  check("the lab loads only its bundled faces through FontFace from /fonts (no system font for calibration)", table.font.files.every((f) => page.includes(f)) && /new FontFace\("AwkitOcrLab", "url\(\/fonts\//.test(page) && /font-family: AwkitOcrLab/.test(page));
  check("the lab reports the font state and the shown fixture as observable attributes", /data-fonts", ok \? "ready" : "missing"/.test(page) && /setAttribute\("data-shown", id\)/.test(page));
  check("the lab names no remote URL", !/https?:\/\/(?!127\.0\.0\.1)/.test(page.replace(/<!--[\s\S]*?-->/g, "")));
  const server = readFileSync(path.join(root, "mock-site", "server.mjs"), "utf8");
  check("the server serves the fixture table and only allowlisted font file names", server.includes('"/visual-intelligence/ocr-fixtures.json"') && server.includes("/^\\/fonts\\/[a-z0-9-]+\\.(?:woff2|txt|json)$/"));
}

console.log("\nD. The harness and the benchmark use the real path");
{
  const harness = readFileSync(path.join(root, "scripts", "ocr-calibration", "calibrationMain.ts"), "utf8");
  const bench = readFileSync(path.join(root, "scripts", "benchmark-ocr.mts"), "utf8");
  check("the harness recognizes through the production OcrUtilityHostManager and the real host", /new OcrUtilityHostManager\(\{ hostPath: HOST_PATH, assetDir: ASSET_DIR, expected \}\)/.test(harness) && /this\.manager\.recognize\(image, options\)/.test(harness));
  check("each trial runs through the real FlowExecutor, StepExecutor and OcrStep", /new StepExecutor\(page/.test(harness) && /new FlowExecutor\(stepExecutor/.test(harness) && /new OcrStep\(\{/.test(harness) && /executeWithRetry\(step, context\)/.test(harness));
  check("the recorded duration is the executor's whole-operation record", /durationMs: record\?\.durationMs \?\? phases\.wallMs/.test(harness));
  check("each launch is a fresh real Chromium at the cell's mode and DPR", /chromium\.launch\(\{ headless: cell\.renderMode === "headless"/.test(harness) && /deviceScaleFactor: cell\.devicePixelRatio/.test(harness));
  check("the recognized text is never stored: only the edit count leaves the recognizer", /trial\.edits = levenshtein\(/.test(harness) && !/words:|recognizedText|outcome\.words\)/.test(harness.replace(/outcome\.words\.map/g, "")));
  check("the harness has no fake engine and no simulated outcome", !/FakeReader|fake|simulat/i.test(harness.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")));
  check("a qualifying launch refuses a missing bundled font", /fonts !== "ready" && !DIAGNOSTIC\) throw new Error\("fonts-missing/.test(harness));
  check("the benchmark refuses qualification without the verified font, and the budget override is diagnostic-only", /fonts === "missing" && !DIAGNOSTIC/.test(bench) && /DIAGNOSTIC && BUDGET_FLAG > 0/.test(bench));
  check("the environment fingerprint binds fonts, fixtures, lab page, pipeline sources, assets, policy and the runtime", ["fonts,", "fixtures:", "labPage:", "pipeline:", "stagedAssetManifest:", "policy:"].every((k) => bench.includes(k)) && ["electron:", "chromium:", "processArch:", "engineAssets:", "viewport:"].every((k) => harness.includes(k)));
}

console.log("\nE. Recorded evidence hygiene");
{
  const dir = path.join(process.env.LOCALAPPDATA ?? os.homedir(), "SpecterStudio", "ocr-calibration", "sessions");
  const files = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".json")) : [];
  if (files.length === 0) {
    console.log("  (no recorded session yet: nothing to scan)");
  } else {
    const texts = [...new Set(table.fixtures.flatMap((f) => [f.text, f.expected]).map((s) => s.replace(/\n/g, " ")).filter((s) => s.length >= 6))];
    let trials = 0;
    const badKeys: string[] = [];
    const leaks: string[] = [];
    for (const name of files) {
      const raw = readFileSync(path.join(dir, name), "utf8");
      for (const text of texts) if (raw.includes(text)) leaks.push(`${name}: ${text.slice(0, 12)}…`);
      const session = JSON.parse(raw) as { launches: OcrCalibrationLaunch[] };
      for (const l of session.launches) for (const tr of l.trials) {
        trials += 1;
        for (const key of Object.keys(tr)) if (!(OCR_CALIBRATION_TRIAL_KEYS as readonly string[]).includes(key)) badKeys.push(key);
      }
    }
    check(`${files.length} session files scanned (${trials} trials)`, trials > 0);
    check("every stored trial carries only allowlisted keys", badKeys.length === 0, [...new Set(badKeys)].join(", "));
    check("no fixture text (rendered or expected) appears in any session file", leaks.length === 0, leaks.slice(0, 5).join("; "));
  }
}

console.log("\nF. Mutants of the evidence handling (each must change a decision)");
{
  type Mutant = (launches: OcrCalibrationLaunch[]) => OcrCalibrationLaunch[];
  const cases: Array<[string, Mutant, OcrCalibrationLaunch[]]> = [
    ["budget-exhausted trials dropped before deciding", (ls) => ls.map((l) => ({ ...l, trials: l.trials.filter((x) => x.code !== "budget-exhausted") })), patchSupported(goodSet(), 19, { verdict: "inconclusive", code: "budget-exhausted", edits: null })],
    ["refused supported trials dropped", (ls) => ls.map((l) => ({ ...l, trials: l.trials.filter((x) => x.edits !== null || x.fixtureClass !== "supported") })), patchSupported(goodSet(), 19, { verdict: "inconclusive", code: "region-too-small", edits: null })],
    ["diagnostic launches relabelled as qualifying", (ls) => ls.map((l) => ({ ...l, diagnostic: false })), goodSet().map((l) => ({ ...l, diagnostic: true }))],
    ["another environment's launches relabelled as this one", (ls) => ls.map((l) => ({ ...l, environment: ENV })), [...goodSet().slice(0, 200), ...Array.from({ length: 150 }, () => launch([t("supported")], { environment: { ...ENV, chromium: "131" } }))]],
    ["failed launches marked complete", (ls) => ls.map((l) => ({ ...l, complete: true })), [...goodSet().slice(1), launch([t("supported")], { complete: false })]],
    ["false matched relabelled inconclusive", (ls) => ls.map((l) => ({ ...l, trials: l.trials.map((x) => (x.fixtureClass === "confusable" ? { ...x, verdict: "inconclusive" } : x)) })), (() => { const s = goodSet(); s[0] = { ...s[0], trials: s[0].trials.map((x) => (x.fixtureClass === "confusable" ? { ...x, verdict: "matched" as const } : x)) }; return s; })()]
  ];
  for (const [name, mutate, evidence] of cases) {
    const honest = decide(evidence).qualified;
    const mutated = decide(mutate(evidence)).qualified;
    check(`MUTANT "${name}" would turn an unqualified cell qualified, and the honest decision refuses it`, honest === false && mutated === true, `honest ${honest}, mutated ${mutated}`);
  }
}

console.log(`\nverify:ocr-calibration: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
