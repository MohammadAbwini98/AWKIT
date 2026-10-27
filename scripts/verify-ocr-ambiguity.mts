/**
 * verify:ocr-ambiguity — Phase N, N7.6 (awkit-vra.9.7): the DIAGNOSTIC-ONLY OCR character-ambiguity probe. It proves the
 * probe is correct, isolated and private; the measurements themselves are benchmark:ocr-ambiguity's.
 *
 *  A. The pure analysis (scripts/lib/ocr-ambiguity-analysis.mts): class-mate and any-alternative margins on one choice
 *     scale, trial features, symbol labels only when the glyph counts align, nearest-rank quantiles, separability with
 *     a strict gap and an "insufficient" state, and the aggregate-only privacy guard.
 *  B. Mutants of the analysis and of the guard: each must turn section A red.
 *  C. The pre-declared probe fixtures: unique ids apart from the calibration table, negatives differ from their
 *     expected text only by l or I standing for 1, positives equal theirs and hold l, I or 1, every expected text is
 *     supported and not sensitive under the production decision.
 *  D. Isolation, at source level: the probe host blocks the network before the engine loads, verifies the pinned
 *     SHA-256, loads only the SIMD LSTM build, writes and logs nothing; the benchmark writes only the aggregate folder
 *     after the guard, reads the qualifying session read-only and never the calibration write path; nothing in app/ or
 *     src/ reaches the probe; the production host, decision thresholds (80/92) and deadline (1500 ms) are unchanged.
 *     Each static rule is also run against a mutated source and must fail.
 *  E. The real probe host with the pinned assets (when build/ocr matches the pin; otherwise NOT RUN): the binding facts
 *     and the negative control, blank images in every pass, an invalid request refused, a tampered pin refused.
 *
 * Run: npm run verify:ocr-ambiguity
 */
import { createHash } from "node:crypto";
import { fork } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as analysis from "./lib/ocr-ambiguity-analysis.mts";
import type { ProbeSymbol, ProbeWord } from "./lib/ocr-ambiguity-analysis.mts";
import { decideTextAssertion, TEXT_ASSERTION_INPUT_VERSION } from "@src/visual/ocr/decideTextAssertion";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string): string => readFileSync(path.join(root, rel), "utf8");
let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── A. The analysis, as a suite that can be run against mutants ──────────────────────────────────────────────────────

type Analysis = typeof analysis;
const sym = (text: string, confidence: number, choices: Array<[string, number]>): ProbeSymbol => ({ text, confidence, choices: choices.map(([t, c]) => ({ text: t, confidence: c })) });

function analysisSuite(a: Analysis): string[] {
  const failures: string[] = [];
  const expect = (label: string, condition: boolean) => {
    if (!condition) failures.push(label);
  };
  const throws = (fn: () => void) => {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  };

  // Margins: one scale (choices), class-mate apart from any alternative.
  const m1 = a.symbolMargins(sym("1", 97, [["1", 90], ["l", 70], ["7", 85]]));
  expect("class margin is top minus the best different class member", m1.classMargin === 20);
  expect("any margin is top minus the best different alternative", m1.anyMargin === 5);
  expect("the symbol confidence is kept apart from the choice scale", m1.symbolConfidence === 97 && m1.top === 90);
  expect("a class mate was offered", m1.classMateOffered === true);
  const m2 = a.symbolMargins(sym("1", 95, [["1", 99]]));
  expect("no alternative: the margins equal the top", m2.classMargin === 99 && m2.anyMargin === 99 && !m2.classMateOffered && m2.choiceCount === 1);
  const m3 = a.symbolMargins(sym("I", 90, [["I", 60], ["|", 58], ["l", 40]]));
  expect("upper-case I and the bar are class members", m3.classMargin === 2);
  const m4 = a.symbolMargins(sym("1", 90, [["l", 80], ["1", 70]]));
  expect("the read glyph's own choice is the top even when another ranks higher", m4.top === 70 && m4.classMargin === -10);

  // Trial features: only class symbols count; minimum over them.
  const words: ProbeWord[] = [
    { text: "Batch", confidence: 96, symbols: [...("Batch".split("").map((c) => sym(c, 96, [[c, 99]])))] },
    { text: "142", confidence: 93, symbols: [sym("1", 93, [["1", 88], ["l", 80]]), sym("4", 95, [["4", 99]]), sym("2", 95, [["2", 99]])] }
  ];
  const f = a.trialFeatures(words);
  expect("one class symbol in the trial", f.classSymbols === 1);
  expect("trial class margin", f.minClassMargin === 8);
  expect("trial word confidence of the class word", f.minClassWordConfidence === 93);
  expect("trial symbol confidence", f.minSymbolConfidence === 93);
  expect("trial max choice count", f.maxChoiceCount === 2);
  const none = a.trialFeatures([{ text: "Order", confidence: 95, symbols: "Order".split("").map((c) => sym(c, 95, [[c, 99]])) }]);
  expect("no class symbol: null features", none.classSymbols === 0 && none.minClassMargin === null);
  const capital = a.trialFeatures([{ text: "I9", confidence: 95, symbols: [sym("I", 95, [["I", 90], ["1", 70]]), sym("9", 95, [["9", 99]])] }]);
  expect("upper-case I counts as a class symbol", capital.classSymbols === 1 && capital.minClassMargin === 20);

  // Labels only when aligned.
  const labels = a.labelClassSymbols(words, "Batch l42");
  expect("a misread l labelled incorrect", labels !== null && labels.length === 1 && labels[0].label === "incorrect");
  const right = a.labelClassSymbols(words, "Batch 142");
  expect("a true 1 labelled correct", right !== null && right.length === 1 && right[0].label === "correct");
  expect("different glyph counts: no label is guessed", a.labelClassSymbols(words, "Batch l422") === null);

  // Quantiles: nearest rank.
  const q = a.quantiles([5, 1, 3, 2, 4]);
  expect("quantiles nearest rank", q.n === 5 && q.min === 1 && q.p50 === 3 && q.max === 5 && q.p95 === 5 && q.p05 === 1 && q.p25 === 2);
  expect("empty quantiles are null", a.quantiles([]).p50 === null && a.quantiles([]).n === 0);

  // Separability: strict, with an insufficient state.
  const s1 = a.separability([1, 2, 3], [5, 6]);
  expect("separable when every false value is below every legitimate one", s1.separable && s1.floor === 4 && s1.status === "separable" && s1.gap === 2);
  const s2 = a.separability([1, 5], [5, 6]);
  expect("a tie is overlap, not separation", !s2.separable && s2.floor === null && s2.status === "overlapping" && s2.falseInOverlap === 1 && s2.legitInOverlap === 1);
  const s3 = a.separability([], [5]);
  expect("no false observation is insufficient, never separable", !s3.separable && s3.status === "insufficient");
  expect("demotion counts values strictly below the floor", a.demotedBy([1, 4, 5], 4) === 1);

  // Privacy guard.
  const vocab = new Set(["lookalike-l1", "text-matched", "headed-dpr1"]);
  const texts = ["Batch l42", "Batch 142"];
  expect("an aggregate report passes", !throws(() => a.assertAggregateOnly({ fixture: "lookalike-l1", codes: { "text-matched": 3 }, cells: { "headed-dpr1": { n: 2 } }, q: [1, 2] }, vocab, texts)));
  expect("a recognized string is refused", throws(() => a.assertAggregateOnly({ read: "Batch 142" }, vocab, texts)));
  expect("a single character is refused", throws(() => a.assertAggregateOnly({ alternatives: ["l"] }, vocab, texts)));
  expect("a fixture word as a key is refused", throws(() => a.assertAggregateOnly({ batch: 1 }, vocab, texts)));
  expect("a free-text key is refused", throws(() => a.assertAggregateOnly({ "Batch l42": 1 }, vocab, texts)));
  return failures;
}

console.log("A. The analysis");
const baseline = analysisSuite(analysis);
check("every analysis case passes on the real implementation", baseline.length === 0, baseline.join("; "));

// ── B. Mutants ───────────────────────────────────────────────────────────────────────────────────────────────────────

console.log("\nB. Mutants (each must turn section A red)");
const mutants: Array<[string, Partial<Analysis>]> = [
  ["class margin taken against any alternative", { symbolMargins: (s) => { const m = analysis.symbolMargins(s); return { ...m, classMargin: m.anyMargin }; } }],
  ["margin mixes the symbol confidence into the choice scale", { symbolMargins: (s) => { const m = analysis.symbolMargins(s); return { ...m, top: s.confidence, classMargin: s.confidence - (m.top - m.classMargin) }; } }],
  ["features ignore upper-case I", { trialFeatures: (w) => analysis.trialFeatures(w.map((x) => ({ ...x, symbols: (x.symbols ?? []).filter((s) => s.text !== "I") }))) }],
  ["features count every symbol as a class symbol", { trialFeatures: (w) => ({ ...analysis.trialFeatures(w), classSymbols: w.reduce((n, x) => n + (x.symbols ?? []).length, 0) }) }],
  ["labels guessed when the glyph counts differ", { labelClassSymbols: (w, r) => analysis.labelClassSymbols(w, r) ?? [] }],
  ["quantiles off by one rank", { quantiles: (v) => { const q = analysis.quantiles(v); return { ...q, p50: analysis.quantiles(v.slice(1)).p50 }; } }],
  ["separability accepts a tie", { separability: (f, l) => { const s = analysis.separability(f, l); return s.status === "overlapping" && s.falseMax === s.legitMin ? { ...s, separable: true, status: "separable", floor: s.falseMax } : s; } }],
  ["separability with no false observation called separable", { separability: (f, l, m) => { const s = analysis.separability(f, l, m); return s.status === "insufficient" ? { ...s, separable: true, status: "separable", floor: 0 } : s; } }],
  ["guard accepts any string", { assertAggregateOnly: () => undefined }],
  ["guard ignores keys", { assertAggregateOnly: (r, v, t) => analysis.assertAggregateOnly(JSON.parse(JSON.stringify(r, (_k, value) => (value && typeof value === "object" && !Array.isArray(value) ? Object.values(value) : value))), v, t) }]
];
for (const [label, override] of mutants) check(`mutant killed: ${label}`, analysisSuite({ ...analysis, ...override } as Analysis).length > 0);

// ── C. The probe fixtures ────────────────────────────────────────────────────────────────────────────────────────────

console.log("\nC. The pre-declared probe fixtures");
const probe = JSON.parse(read("scripts/ocr-ambiguity/probe-fixtures.json")) as {
  version: number;
  confirmation: Array<{ id: string; role: string; text: string; expected: string; fontSize: number }>;
  multilineControls: Array<{ id: string; role: string; text: string; expected: string; fontSize: number }>;
};
const calibration = JSON.parse(read("mock-site/public/ocr-fixtures.json")) as { fixtures: Array<{ id: string }> };
const all = [...probe.confirmation, ...probe.multilineControls];
check("probe fixture ids are unique", new Set(all.map((f) => f.id)).size === all.length);
check("probe fixture ids never collide with the calibration table", all.every((f) => !calibration.fixtures.some((c) => c.id === f.id)));
check("confirmation holds at least 5 negatives and 10 positives", probe.confirmation.filter((f) => f.role === "negative").length >= 5 && probe.confirmation.filter((f) => f.role === "positive").length >= 10);
const substitutionOnly = (text: string, expected: string) => text.length === expected.length && [...text].every((ch, i) => ch === expected[i] || ((ch === "l" || ch === "I") && expected[i] === "1")) && text !== expected;
check("every negative differs only by l or I standing for 1", probe.confirmation.filter((f) => f.role === "negative").every((f) => substitutionOnly(f.text, f.expected)));
check("every positive equals its expected text and holds l, I or 1", probe.confirmation.filter((f) => f.role === "positive").every((f) => f.text === f.expected && /[lI1]/.test(f.text)));
const supportedAndSafe = (expected: string) =>
  decideTextAssertion({ version: TEXT_ASSERTION_INPUT_VERSION, expected: { text: expected, match: "normalized" }, ocr: { ok: true, words: expected.split(" ").map((text) => ({ text, confidence: 99 })) } }).code === "text-matched";
check("every expected text is supported and not sensitive under the production decision", all.every((f) => supportedAndSafe(f.expected)), all.filter((f) => !supportedAndSafe(f.expected)).map((f) => f.id).join(","));
check("font sizes are the calibration range (16 to 22 px)", all.every((f) => f.fontSize >= 16 && f.fontSize <= 22));

// ── D. Isolation at source level, each rule proven against a mutated source ──────────────────────────────────────────

console.log("\nD. Isolation and privacy at source level");
const hostSource = read("scripts/ocr-ambiguity/probe-host.cjs");
const benchSource = read("scripts/benchmark-ocr-ambiguity.mts");
type Rule = [string, (src: string) => boolean, (src: string) => string];
const hostRules: Rule[] = [
  ["the probe host blocks the network before the engine loads", (s) => s.indexOf("blockNetwork") > -1 && s.indexOf("blockNetwork") < s.indexOf("require(path.join(dir, ENGINE_JS))") && /globalThis\.fetch = async \(\) => refuse\(\)/.test(s), (s) => s.replace("globalThis.fetch = async () => refuse();", "")],
  ["the probe host verifies the pinned SHA-256 before loading", (s) => /const problem = verifyAssets\(dir, expected\);\s*if \(problem\) return fail\(problem\);/.test(s) && s.indexOf("verifyAssets(dir, expected)") < s.indexOf("require(path.join(dir, ENGINE_JS))"), (s) => s.replace("if (problem) return fail(problem);", "")],
  ["the probe host loads only the SIMD LSTM build", (s) => s.includes('"tesseract-core-simd-lstm.js"') && !/tesseract-core(?:-simd)?\.js"|tesseract-core-lstm\.js"/.test(s), (s) => s.replace('"tesseract-core-simd-lstm.js"', '"tesseract-core-lstm.js"')],
  ["the probe host writes no file and logs nothing", (s) => !/fs\.(?:writeFile|appendFile|createWriteStream|mkdir|rm|unlink|rename)|console\.|process\.std(?:out|err)/.test(s), (s) => s.replace("const send =", 'console.log("x");\nconst send =')],
  ["the probe host restores the production choice mode after each request", (s) => s.includes('api.SetVariable("lstm_choice_mode", "0");\n    if (!found)'), (s) => s.replace('api.SetVariable("lstm_choice_mode", "0");\n', "")]
];
for (const [label, rule, mutate] of hostRules) {
  check(label, rule(hostSource));
  check(`  …and fails on a mutated source`, !rule(mutate(hostSource)));
}
const benchRules: Rule[] = [
  ["the benchmark runs the privacy guard before it writes the report", (s) => s.indexOf("assertAggregateOnly(report, vocabulary, fixtureTexts)") > -1 && s.indexOf("assertAggregateOnly(report, vocabulary, fixtureTexts)") < s.indexOf("writeFileSync(outFile"), (s) => s.replace("assertAggregateOnly(report, vocabulary, fixtureTexts);", "")],
  ["the benchmark writes only to the ambiguity folder, never the calibration sessions", (s) => (s.match(/writeFileSync\(/g) ?? []).length === 1 && s.includes("writeFileSync(outFile") && /const outFile = path\.join\(OUT_DIR/.test(s) && /"ocr-calibration", "ambiguity"\)/.test(s), (s) => s.replace("const outFile = path.join(OUT_DIR", "const outFile = path.join(SESSIONS_DIR")],
  ["the benchmark reads the qualifying session read-only and checks it is unchanged", (s) => /unchanged: before === after/.test(s) && !/writeFileSync\(file/.test(s), (s) => s.replace("unchanged: before === after", "unchanged: true")],
  ["the benchmark uses the production N0 capture and preprocessing, not a substitute", (s) => s.includes('import { captureElement } from "@src/visual/capture"') && s.includes('import { preprocessForOcr } from "@src/visual/ocr/preprocess"') && s.includes("stillness: true") && s.includes("contextPaddingCss: 0"), (s) => s.replace("stillness: true", "stillness: false")],
  ["the benchmark's production pass is mode 0 at PSM 6 with the word walk", (s) => s.includes('A: { psm: 6, choiceMode: 0, walk: "words" }'), (s) => s.replace('A: { psm: 6, choiceMode: 0, walk: "words" }', 'A: { psm: 6, choiceMode: 2, walk: "words" }')]
];
for (const [label, rule, mutate] of benchRules) {
  check(label, rule(benchSource));
  check(`  …and fails on a mutated source`, !rule(mutate(benchSource)));
}
const productFiles = (dir: string): string[] =>
  readdirSync(path.join(root, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    const full = path.join(root, rel);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : productFiles(rel);
    return /\.(?:ts|tsx|cjs|mjs|js)$/.test(name) ? [rel] : [];
  });
const product = [...productFiles("app"), ...productFiles("src"), ...productFiles("native-hosts")];
const reaching = product.filter((rel) => /ocr-ambiguity|probe-host|lstm_choice_mode|ChoiceIterator/.test(read(rel)));
check("nothing in app/, src/ or native-hosts/ reaches the probe or sets lstm_choice_mode", reaching.length === 0, reaching.join(","));
check("the production host still walks words only, at the production setting", !/ChoiceIterator|lstm_choice_mode|RIL_SYMBOL/.test(read("native-hosts/ocr/ocr-host.cjs")) && read("native-hosts/ocr/ocr-host.cjs").includes("const level = Tess.RIL_WORD;"));
check("decision thresholds unchanged (80 / 92, uncalibrated)", /minWordConfidence: 80,\s*minLookalikeConfidence: 92/.test(read("src/visual/ocr/decideTextAssertion.ts")));
check("assertion deadline unchanged (1500 ms)", read("src/runner/ocr/ocrAssertionContract.ts").includes("export const OCR_ASSERTION_DEADLINE_MS = 1500;"));
check("OcrStep still asks the recognizer for PSM 6", read("src/runner/ocr/OcrStep.ts").includes("psm: 6 }"));
const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
check("the probe runs only from its own explicit script (off by default)", pkg.scripts["benchmark:ocr-ambiguity"] === "tsx scripts/benchmark-ocr-ambiguity.mts" && Object.entries(pkg.scripts).filter(([, v]) => v.includes("benchmark-ocr-ambiguity")).length === 1);

// ── E. The real probe host with the pinned assets ────────────────────────────────────────────────────────────────────

console.log("\nE. The real probe host with the pinned assets");
const pin = JSON.parse(read("src/offline/ocr-runtime.json")) as { files: Array<{ target: string; sha256: string }> };
const expected = Object.fromEntries(pin.files.map((f) => [f.target, f.sha256]));
const built = path.join(root, "build", "ocr");
const staged = pin.files.every((f) => existsSync(path.join(built, f.target)) && createHash("sha256").update(readFileSync(path.join(built, f.target))).digest("hex") === f.sha256);
// Outside the repository, as packaged: inside it the root package.json ("type": "module") would load the glue as ESM.
const assets = mkdtempSync(path.join(os.tmpdir(), "awkit-ocr-ambiguity-verify-"));
if (staged) for (const f of pin.files) copyFileSync(path.join(built, f.target), path.join(assets, f.target));
if (!staged) {
  console.log("  NOT RUN  build/ocr does not hold the pinned assets (npm run prepare:ocr-assets); sections A-D still apply");
} else {
  type Message = { type: string; id?: string; [key: string]: unknown };
  const start = (pins: Record<string, string>) => {
    const child = fork(path.join(root, "scripts", "ocr-ambiguity", "probe-host.cjs"), [], {
      env: { SystemRoot: process.env.SystemRoot ?? "", AWKIT_OCR_PROBE_ASSET_DIR: assets, AWKIT_OCR_PROBE_EXPECTED: JSON.stringify(pins) },
      execArgv: [],
      serialization: "advanced",
      stdio: ["ignore", "ignore", "ignore", "ipc"]
    });
    const queue: Message[] = [];
    const waiters: Array<(m: Message) => void> = [];
    child.on("message", (m: Message) => (waiters.length ? waiters.shift()!(m) : queue.push(m)));
    const next = () => new Promise<Message>((resolve, reject) => {
      if (queue.length) return resolve(queue.shift()!);
      const timer = setTimeout(() => reject(new Error("probe host timed out")), 60_000);
      waiters.push((m) => {
        clearTimeout(timer);
        resolve(m);
      });
    });
    return { child, next };
  };
  const host = start(expected);
  try {
    const ready = await host.next();
    const api = ready.api as Record<string, unknown> | undefined;
    check("the probe host starts on the pinned assets", ready.type === "ready", `${String(ready.reason ?? "")} ${String(ready.detail ?? "")}`);
    if (ready.type !== "ready") throw new Error("the probe host did not start");
    check("ChoiceIterator is exposed with Next, GetUTF8Text and Confidence", api?.choiceIterator === true && JSON.stringify(api?.choiceIteratorMethods) === JSON.stringify(["Next", "GetUTF8Text", "Confidence"]));
    check("lstm_choice_mode is a parameter the engine accepts", api?.lstmChoiceMode === true);
    check("negative control: an unknown parameter is refused", api?.bogusVariable === false);
    const blank = { width: 96, height: 40, gray: new Uint8Array(96 * 40).fill(255) };
    for (const [pass, psm, choiceMode, walk] of [["A", 6, 0, "words"], ["B", 6, 0, "symbols"], ["C", 6, 2, "symbols"], ["D", 4, 0, "symbols"]] as const) {
      host.child.send({ type: "recognize", id: pass, ...blank, psm, choiceMode, walk });
      const reply = await host.next();
      check(`pass ${pass}: a blank image reads no words`, reply.ok === true && Array.isArray(reply.words) && (reply.words as unknown[]).length === 0);
    }
    host.child.send({ type: "recognize", id: "bad", ...blank, psm: 13, choiceMode: 0, walk: "words" });
    check("an unsupported page segmentation mode is refused", (await host.next()).reason === "image-invalid");
    host.child.send({ type: "recognize", id: "bad2", ...blank, psm: 6, choiceMode: 1, walk: "words" });
    check("a choice mode other than 0 or 2 is refused", (await host.next()).reason === "image-invalid");
  } catch (error) {
    check("the probe host section completes", false, error instanceof Error ? error.message : String(error));
  } finally {
    host.child.kill();
  }
  const tampered = start({ ...expected, "tesseract-core-simd-lstm.wasm": "0".repeat(64) });
  try {
    const reply = await tampered.next();
    check("a tampered pin is refused before the engine loads", reply.type === "failed" && reply.reason === "checksum-mismatch");
  } finally {
    tampered.child.kill();
  }
}
await new Promise((resolve) => setTimeout(resolve, 500));
rmSync(assets, { recursive: true, force: true });

console.log(`\nverify:ocr-ambiguity: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
