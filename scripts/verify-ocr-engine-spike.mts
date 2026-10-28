/**
 * verify:ocr-engine-spike — Phase N, N7.6 (awkit-vra.9.7): the DIAGNOSTIC-ONLY OCR engine and recognition-data spike.
 * It proves the spike's criteria, fixtures and isolation; the measurements themselves are benchmark:ocr-engine-spike's.
 *
 *  A. The GO / NO-GO criteria (scripts/lib/ocr-engine-spike-criteria.mts) at every boundary: zero false matched,
 *     98 % supported accuracy, unsupported never matched, six cells, the 1500 ms estimate, the 8,000,000-byte budget,
 *     offline pinning, the SIMD floor, no-confidence engines never GO alone, unmeasured gates never PASS; composites
 *     only demote; the deadline estimate's arithmetic.
 *  B. Mutants of the criteria: each must turn section A red.
 *  C. The holdout fixtures: unique ids apart from every other fixture table, negatives differ only by a look-alike
 *     standing for a digit, positives equal their expected text, every expected text supported and not sensitive.
 *  D. Isolation at source level, each rule also failing on a mutated source: the spike host blocks the network before
 *     the engine loads, verifies every file's SHA-256 first, accepts only allowlisted engines and data, writes and logs
 *     nothing; the Windows bridge runs as an encoded command with no execution-policy change, writes no file and makes
 *     no web request; the benchmark guards before it writes, writes only its own folder, refuses a control that is not
 *     the production pin, uses the production N0 capture and preprocessing; nothing in the product reaches the spike.
 *  E. The real candidates (when the lockfile-pinned spike install is present; otherwise NOT RUN): each Tesseract
 *     candidate starts from a staged copy and reads nothing on a blank image, a tampered hash and an unknown engine are
 *     refused; the Windows bridge reports its availability (NOT RUN when the recognizer is absent).
 *
 * Run: npm run verify:ocr-engine-spike
 */
import { createHash } from "node:crypto";
import { fork, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as criteria from "./lib/ocr-engine-spike-criteria.mts";
import type { CandidateMeasurement } from "./lib/ocr-engine-spike-criteria.mts";
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

// ── A. Criteria ──────────────────────────────────────────────────────────────────────────────────────────────────────

type Criteria = typeof criteria;
const good = (): CandidateMeasurement => ({
  noConfidence: false,
  available: true,
  negatives: { trials: 100, matched: 0 },
  supported: { trials: 1000, matched: 980 },
  unsupported: { trials: 40, matched: 0 },
  cellsMeasured: 6,
  latency: { estimatedWholeP95Ms: 1500, firstRecognizeMs: 400 },
  packageBytes: 8_000_000,
  offlinePinned: true,
  cpuCompatible: true
});

function criteriaSuite(c: Criteria): string[] {
  const failures: string[] = [];
  const expect = (label: string, condition: boolean) => {
    if (!condition) failures.push(label);
  };
  const verdict = (change: (m: CandidateMeasurement) => void) => {
    const m = good();
    change(m);
    return c.evaluateCandidate(m);
  };
  expect("a candidate at every boundary is GO", verdict(() => undefined).verdict === "GO");
  expect("one false match is NO-GO", verdict((m) => (m.negatives.matched = 1)).gates.zeroFalseMatched === "FAIL");
  expect("98 % exactly passes", verdict(() => undefined).gates.supportedAccuracy === "PASS");
  expect("one miss below 98 % fails", verdict((m) => (m.supported.matched = 979)).gates.supportedAccuracy === "FAIL");
  expect("an unsupported match fails", verdict((m) => (m.unsupported.matched = 1)).gates.unsupportedNeverMatched === "FAIL");
  expect("five cells fail coverage", verdict((m) => (m.cellsMeasured = 5)).gates.coverage === "FAIL");
  expect("1501 ms estimated fails the deadline", verdict((m) => (m.latency.estimatedWholeP95Ms = 1501)).gates.latency === "FAIL");
  expect("an unmeasured first recognition is NOT-RUN, never PASS", verdict((m) => (m.latency.firstRecognizeMs = null)).gates.latency === "NOT-RUN");
  expect("one byte over budget fails", verdict((m) => (m.packageBytes = 8_000_001)).gates.packageBudget === "FAIL");
  expect("an unpinned engine fails", verdict((m) => (m.offlinePinned = false)).gates.offlinePinned === "FAIL");
  expect("a new CPU requirement fails", verdict((m) => (m.cpuCompatible = false)).gates.cpuCompatible === "FAIL");
  expect("an engine without confidence is never GO alone", verdict((m) => (m.noConfidence = true)).verdict === "NO-GO");
  const absent = verdict((m) => (m.available = false));
  expect("an unavailable engine's measured gates are NOT-RUN and it is NO-GO", absent.verdict === "NO-GO" && absent.gates.zeroFalseMatched === "NOT-RUN" && absent.gates.supportedAccuracy === "NOT-RUN");
  expect("no negative trials is NOT-RUN, never PASS", verdict((m) => (m.negatives.trials = 0)).gates.zeroFalseMatched === "NOT-RUN");
  expect("a composite keeps a match the second reader confirms", c.compositeCode("text-matched", true) === "text-matched");
  expect("a composite demotes a match the second reader does not confirm", c.compositeCode("text-matched", false) !== "text-matched" && c.compositeCode("text-matched", null) !== "text-matched");
  expect("a composite never promotes", c.compositeCode("lookalike-uncertain", true) === "lookalike-uncertain" && c.compositeCode("near-miss", true) === "near-miss");
  expect("the deadline estimate replaces the baseline's recognize p95", c.estimateWholeP95(1083, 100, 400) === 1383);
  expect("the criteria are the ratified figures", c.ENGINE_SPIKE_CRITERIA.falseMatchedMax === 0 && c.ENGINE_SPIKE_CRITERIA.supportedAccuracyMin === 0.98 && c.ENGINE_SPIKE_CRITERIA.deadlineMs === 1500 && c.ENGINE_SPIKE_CRITERIA.packageBudgetBytes === 8_000_000 && c.ENGINE_SPIKE_CRITERIA.cells === 6);
  return failures;
}

console.log("A. The GO / NO-GO criteria");
const baseline = criteriaSuite(criteria);
check("every criteria case passes on the real implementation", baseline.length === 0, baseline.join("; "));

console.log("\nB. Mutants (each must turn section A red)");
const loose = (patch: Partial<typeof criteria.ENGINE_SPIKE_CRITERIA>) => (m: CandidateMeasurement) => criteria.evaluateCandidate(m, { ...criteria.ENGINE_SPIKE_CRITERIA, ...patch });
const mutants: Array<[string, Partial<Criteria>]> = [
  ["one false match tolerated", { evaluateCandidate: loose({ falseMatchedMax: 1 }) }],
  ["accuracy floor lowered to 97 %", { evaluateCandidate: loose({ supportedAccuracyMin: 0.97 }) }],
  ["deadline relaxed to 1600 ms", { evaluateCandidate: loose({ deadlineMs: 1600 }) }],
  ["budget relaxed by one byte", { evaluateCandidate: loose({ packageBudgetBytes: 8_000_001 }) }],
  ["five cells accepted", { evaluateCandidate: loose({ cells: 5 }) }],
  ["NOT-RUN counted as PASS", { evaluateCandidate: (m) => { const e = criteria.evaluateCandidate(m); const failedGates = e.failed.filter((g) => e.gates[g as keyof typeof e.gates] === "FAIL"); return { ...e, verdict: failedGates.length ? "NO-GO" : "GO", failed: failedGates, gates: Object.fromEntries(Object.entries(e.gates).map(([k, s]) => [k, s === "NOT-RUN" ? "PASS" : s])) as typeof e.gates }; } }],
  ["no-confidence engine allowed alone", { evaluateCandidate: (m) => criteria.evaluateCandidate({ ...m, noConfidence: false }) }],
  ["composite promotes on agreement", { compositeCode: (code, agrees) => (agrees ? "text-matched" : criteria.compositeCode(code, agrees)) }],
  ["composite keeps a match without a second read", { compositeCode: (code, agrees) => (agrees === null ? code : criteria.compositeCode(code, agrees)) }],
  ["estimate ignores the baseline", { estimateWholeP95: (s, _b, cand) => Math.round(s + cand) }]
];
for (const [label, override] of mutants) check(`mutant killed: ${label}`, criteriaSuite({ ...criteria, ...override } as Criteria).length > 0);

// ── C. Holdout fixtures ──────────────────────────────────────────────────────────────────────────────────────────────

console.log("\nC. The holdout fixtures");
const holdout = (JSON.parse(read("scripts/ocr-engine-spike/holdout-fixtures.json")) as { holdout: Array<{ id: string; role: string; text: string; expected: string; fontSize: number }> }).holdout;
const otherIds = new Set([
  ...(JSON.parse(read("mock-site/public/ocr-fixtures.json")) as { fixtures: Array<{ id: string }> }).fixtures.map((f) => f.id),
  ...(JSON.parse(read("scripts/ocr-ambiguity/probe-fixtures.json")) as { confirmation: Array<{ id: string }>; multilineControls: Array<{ id: string }> }).confirmation.map((f) => f.id),
  ...(JSON.parse(read("scripts/ocr-ambiguity/probe-fixtures.json")) as { multilineControls: Array<{ id: string }> }).multilineControls.map((f) => f.id)
]);
check("holdout ids are unique", new Set(holdout.map((f) => f.id)).size === holdout.length);
check("holdout ids collide with no other fixture table", holdout.every((f) => !otherIds.has(f.id)));
check("holdout holds at least 5 negatives and 10 positives", holdout.filter((f) => f.role === "negative").length >= 5 && holdout.filter((f) => f.role === "positive").length >= 10);
const LOOKALIKE: Record<string, string> = { l: "1", I: "1", O: "0", S: "5" };
check("every negative differs only by a look-alike standing for a digit", holdout.filter((f) => f.role === "negative").every((f) => f.text !== f.expected && f.text.length === f.expected.length && [...f.text].every((ch, i) => ch === f.expected[i] || LOOKALIKE[ch] === f.expected[i])));
check("every positive equals its expected text", holdout.filter((f) => f.role === "positive").every((f) => f.text === f.expected));
const safe = (expected: string) => decideTextAssertion({ version: TEXT_ASSERTION_INPUT_VERSION, expected: { text: expected, match: "normalized" }, ocr: { ok: true, words: expected.split(" ").map((text) => ({ text, confidence: 99 })) } }).code === "text-matched";
check("every expected text is supported and not sensitive under the production decision", holdout.every((f) => safe(f.expected)), holdout.filter((f) => !safe(f.expected)).map((f) => f.id).join(","));

// ── D. Isolation ─────────────────────────────────────────────────────────────────────────────────────────────────────

console.log("\nD. Isolation and privacy at source level");
const host = read("scripts/ocr-engine-spike/spike-host.cjs");
const bridge = read("scripts/ocr-engine-spike/winocr-bridge.ps1");
const bench = read("scripts/benchmark-ocr-engine-spike.mts");
type Rule = [string, string, (s: string) => boolean, (s: string) => string];
const rules: Rule[] = [
  ["the spike host blocks the network before the engine loads", host, (s) => s.indexOf("blockNetwork") > -1 && s.indexOf("blockNetwork") < s.indexOf("require(path.join(dir, engine))") && s.includes("globalThis.fetch = async () => refuse();"), (s) => s.replace("globalThis.fetch = async () => refuse();", "")],
  ["the spike host verifies every file's SHA-256 before loading", host, (s) => /for \(const name of \[engine, wasm, data\]\)[\s\S]*?checksum-mismatch[\s\S]*?require\(path\.join\(dir, engine\)\)/.test(s), (s) => s.replace('return fail("checksum-mismatch");\n  }\n  if (!WebAssembly', "}\n  if (!WebAssembly")],
  ["the spike host accepts only allowlisted engines and data", host, (s) => s.includes('const ENGINES = new Set(["tesseract-core-simd-lstm.js", "tesseract-core-simd.js"]);') && s.includes("!ENGINES.has(engine) || !DATA.has(data)"), (s) => s.replace("!ENGINES.has(engine) || ", "")],
  ["the spike host writes no file and logs nothing", host, (s) => !/fs\.(?:writeFile|appendFile|createWriteStream|mkdir|rm|unlink|rename)|console\.|process\.std(?:out|err)/.test(s), (s) => s.replace("const send =", 'console.log("x");\nconst send =')],
  ["the Windows bridge writes no file and makes no web request", bridge, (s) => !/Out-File|Set-Content|Add-Content|New-Item|Invoke-WebRequest|Invoke-RestMethod|Start-Process|Write-Host|WebClient/i.test(s), (s) => `${s}\nOut-File x`],
  ["the benchmark passes the bridge as an encoded command, never changing the execution policy", bench, (s) => s.includes('"-EncodedCommand"') && !/ExecutionPolicy/i.test(s), (s) => s.replace('"-EncodedCommand"', '"-ExecutionPolicy", "Bypass", "-EncodedCommand"')],
  ["the benchmark runs the privacy guard before it writes", bench, (s) => s.indexOf("assertAggregateOnly(report, vocabulary, fixtureTexts)") > -1 && s.indexOf("assertAggregateOnly(report, vocabulary, fixtureTexts)") < s.indexOf("writeFileSync(outFile"), (s) => s.replace("assertAggregateOnly(report, vocabulary, fixtureTexts);", "")],
  ["the benchmark writes only its own folder", bench, (s) => (s.match(/writeFileSync\(/g) ?? []).length === 1 && s.includes('const OUT_DIR = path.join(LOCAL, "engine-spike");') && s.includes("const outFile = path.join(OUT_DIR"), (s) => s.replace('const OUT_DIR = path.join(LOCAL, "engine-spike");', 'const OUT_DIR = path.join(LOCAL, "sessions");')],
  ["the benchmark refuses a control that is not the production pin", bench, (s) => s.includes('blocked("the control candidate is not byte-identical to the production pin")'), (s) => s.replace('blocked("the control candidate is not byte-identical to the production pin");', "")],
  ["the benchmark uses the production N0 capture and preprocessing", bench, (s) => s.includes('import { captureElement } from "@src/visual/capture"') && s.includes('import { preprocessForOcr } from "@src/visual/ocr/preprocess"') && s.includes("stillness: true") && s.includes("contextPaddingCss: 0"), (s) => s.replace("stillness: true", "stillness: false")],
  ["composites are built only through compositeCode (demote-only)", bench, (s) => s.includes('trial.codes[composite] = compositeCode(trial.codes["c0-lstm-best"] as string, agrees(item, wordsOf(secondReply)));'), (s) => s.replace("compositeCode(trial.codes", "((c: string) => c)(trial.codes")]
];
for (const [label, source, rule, mutate] of rules) {
  check(label, rule(source));
  check("  …and fails on a mutated source", !rule(mutate(source)));
}
const productFiles = (dir: string): string[] =>
  readdirSync(path.join(root, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(path.join(root, rel)).isDirectory()) return name === "node_modules" ? [] : productFiles(rel);
    return /\.(?:ts|tsx|cjs|mjs|js)$/.test(name) ? [rel] : [];
  });
const reaching = [...productFiles("app"), ...productFiles("src"), ...productFiles("native-hosts")].filter((rel) => /ocr-engine-spike|spike-host|winocr|Windows\.Media\.Ocr|tesseract-core-simd\.js|4\.0\.0\/eng/.test(read(rel)));
check("nothing in app/, src/ or native-hosts/ reaches the spike or a non-pinned engine", reaching.length === 0, reaching.join(","));
const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
check("the spike runs only from its own explicit script (off by default)", pkg.scripts["benchmark:ocr-engine-spike"] === "tsx scripts/benchmark-ocr-engine-spike.mts" && Object.values(pkg.scripts).filter((v) => v.includes("benchmark-ocr-engine-spike")).length === 1);
check("the production pin is unchanged (simd-lstm, best_int)", read("src/offline/ocr-runtime.json").includes('"flavor": "simd-lstm"') && read("src/offline/ocr-runtime.json").includes('"variant": "4.0.0_best_int"'));

// ── E. Real candidates ───────────────────────────────────────────────────────────────────────────────────────────────

console.log("\nE. The real candidates");
const SPIKE = path.join(root, "scripts", "ocr-feasibility", "node_modules");
const SOURCES: Record<string, string> = {
  "tesseract-core-simd-lstm.js": "tesseract.js-core/tesseract-core-simd-lstm.js",
  "tesseract-core-simd-lstm.wasm": "tesseract.js-core/tesseract-core-simd-lstm.wasm",
  "tesseract-core-simd.js": "tesseract.js-core/tesseract-core-simd.js",
  "tesseract-core-simd.wasm": "tesseract.js-core/tesseract-core-simd.wasm",
  "eng-best-int.traineddata.gz": "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
  "eng-standard.traineddata.gz": "@tesseract.js-data/eng/4.0.0/eng.traineddata.gz"
};
type Message = { type: string; id?: string; [key: string]: unknown };
const startHost = (dir: string, env: Record<string, string>) => {
  const child = fork(path.join(root, "scripts", "ocr-engine-spike", "spike-host.cjs"), [], { env: { SystemRoot: process.env.SystemRoot ?? "", AWKIT_OCR_SPIKE_DIR: dir, ...env }, execArgv: [], serialization: "advanced", stdio: ["ignore", "ignore", "ignore", "ipc"] });
  const next = () => new Promise<Message>((resolve) => {
    const timer = setTimeout(() => resolve({ type: "timeout" }), 90_000);
    child.once("message", (m: Message) => {
      clearTimeout(timer);
      resolve(m);
    });
  });
  return { child, next };
};
if (!Object.values(SOURCES).every((s) => existsSync(path.join(SPIKE, s)))) {
  console.log("  NOT RUN  the lockfile-pinned spike install (scripts/ocr-feasibility) is absent");
} else {
  const dir = mkdtempSync(path.join(os.tmpdir(), "awkit-ocr-engine-spike-verify-"));
  const hashes: Record<string, string> = {};
  for (const [name, source] of Object.entries(SOURCES)) {
    copyFileSync(path.join(SPIKE, source), path.join(dir, name));
    hashes[name] = createHash("sha256").update(readFileSync(path.join(dir, name))).digest("hex");
  }
  const blank = { width: 96, height: 40, gray: new Uint8Array(96 * 40).fill(255) };
  const candidates: Array<[string, string, string, number]> = [
    ["c0-lstm-best", "tesseract-core-simd-lstm.js", "eng-best-int.traineddata.gz", 1],
    ["c1-lstm-standard", "tesseract-core-simd-lstm.js", "eng-standard.traineddata.gz", 1],
    ["c2-legacy-standard", "tesseract-core-simd.js", "eng-standard.traineddata.gz", 0],
    ["c3-combined-standard", "tesseract-core-simd.js", "eng-standard.traineddata.gz", 2]
  ];
  for (const [id, engine, data, oem] of candidates) {
    const files = [engine, engine.replace(/\.js$/, ".wasm"), data];
    const h = startHost(dir, { AWKIT_OCR_SPIKE_ENGINE: engine, AWKIT_OCR_SPIKE_DATA: data, AWKIT_OCR_SPIKE_OEM: String(oem), AWKIT_OCR_SPIKE_EXPECTED: JSON.stringify(Object.fromEntries(files.map((f) => [f, hashes[f]]))) });
    const ready = await h.next();
    check(`${id}: starts on its staged, hash-verified files`, ready.type === "ready", `${String(ready.reason ?? "")} ${String(ready.detail ?? "")}`);
    if (ready.type === "ready") {
      h.child.send({ type: "recognize", id: "blank", ...blank });
      const reply = await h.next();
      check(`${id}: a blank image reads no words`, reply.ok === true && Array.isArray(reply.words) && (reply.words as unknown[]).length === 0);
    }
    h.child.kill();
  }
  const tampered = startHost(dir, { AWKIT_OCR_SPIKE_ENGINE: "tesseract-core-simd.js", AWKIT_OCR_SPIKE_DATA: "eng-standard.traineddata.gz", AWKIT_OCR_SPIKE_OEM: "0", AWKIT_OCR_SPIKE_EXPECTED: JSON.stringify({ "tesseract-core-simd.js": hashes["tesseract-core-simd.js"], "tesseract-core-simd.wasm": "0".repeat(64), "eng-standard.traineddata.gz": hashes["eng-standard.traineddata.gz"] }) });
  const tamperedReply = await tampered.next();
  check("a tampered hash is refused before the engine loads", tamperedReply.type === "failed" && tamperedReply.reason === "checksum-mismatch");
  tampered.child.kill();
  const unknown = startHost(dir, { AWKIT_OCR_SPIKE_ENGINE: "tesseract-core.js", AWKIT_OCR_SPIKE_DATA: "eng-standard.traineddata.gz", AWKIT_OCR_SPIKE_OEM: "1", AWKIT_OCR_SPIKE_EXPECTED: "{}" });
  const unknownReply = await unknown.next();
  check("an engine outside the allowlist is refused", unknownReply.type === "failed" && unknownReply.reason === "config-invalid");
  unknown.child.kill();
  await new Promise((resolve) => setTimeout(resolve, 500));
  rmSync(dir, { recursive: true, force: true });
}

const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(bridge, "utf16le").toString("base64")], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
const lines: Array<Record<string, unknown>> = [];
let buffer = "";
const nextLine = () => new Promise<Record<string, unknown> | null>((resolve) => {
  const timer = setTimeout(() => resolve(null), 60_000);
  const poll = () => {
    if (lines.length) {
      clearTimeout(timer);
      resolve(lines.shift() as Record<string, unknown>);
    } else setTimeout(poll, 50);
  };
  poll();
});
ps.stdout.on("data", (chunk: Buffer) => {
  buffer += chunk.toString("utf8");
  let newline: number;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    try {
      lines.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // not ours
    }
  }
});
const winReady = await nextLine();
if (!winReady || winReady.available !== true) {
  console.log(`  NOT RUN  the Windows built-in recognizer is not available here (${String(winReady?.reason ?? "no reply")})`);
} else {
  check("the Windows bridge reports an en-US recognizer", winReady.available === true);
  const bgra = Buffer.alloc(96 * 40 * 4, 255);
  ps.stdin.write(`${JSON.stringify({ type: "recognize", id: "blank", w: 96, h: 40, b64: bgra.toString("base64") })}\n`);
  const reply = await nextLine();
  const words = reply ? (Array.isArray(reply.words) ? reply.words : reply.words ? [reply.words] : []) : null;
  check("the Windows bridge reads no words on a blank image", reply?.ok === true && words !== null && words.length === 0, JSON.stringify(reply)?.slice(0, 120));
}
try {
  ps.stdin.end();
} catch {
  // gone
}
setTimeout(() => ps.kill(), 1000).unref();

console.log(`\nverify:ocr-engine-spike: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
