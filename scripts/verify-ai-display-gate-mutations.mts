/**
 * verify:ai-display-gate-mutations — the mutation run of the L4b R4 display gate (`verify:ai-authoring` §14).
 *
 * Until 2026-09-25 this run was BLOCKED: it edited product source, and the session's permission classifier
 * denied that twice. Here no product file is ever written. Each mutant runs `verify:ai-authoring`, unchanged,
 * in a child process whose loader replaces one source file's text IN MEMORY as it loads
 * (`scripts/helpers/source-mutant-hooks.mjs`).
 *
 * A mutant is KILLED only when that run completes and reports at least one failed check. A survivor fails this
 * gate, and so does a crash, since a crash is not an assertion. Controls: each mutated file, loaded through
 * the same hook with no change, passes in full; every mutant's text occurs exactly once and proves it loaded;
 * and the three source files are byte-identical afterwards.
 *
 * `--dx` (verify:ai-dx-mutations) runs the same way over L4b's DX evaluator and held-out check instead
 * (scripts/ai-harness/authoringDx.ts, `verify:ai-authoring` §15): each rule it applies, broken one at a time.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERIFIER = join(root, "scripts", "verify-ai-authoring.mts");
const HOOKS = pathToFileURL(join(root, "scripts", "helpers", "source-mutant-hooks.mjs")).href;
const GATE = join(root, "src", "ai", "authoringClaimScreen.ts");
const PARSER = join(root, "src", "ai", "authoringExplanation.ts");
const ADAPTER = join(root, "app", "main", "ai", "aiAssist.ts");
const DX = process.argv.includes("--dx");
const DX_FILE = join(root, "scripts", "ai-harness", "authoringDx.ts");
const REVIEW_FILE = join(root, "scripts", "ai-harness", "authoringQualityReview.ts");
const SET_FILE = join(root, "scripts", "ai-harness", "authoringQualitySet.ts");
const FILES = DX ? [DX_FILE, REVIEW_FILE, SET_FILE] : [GATE, PARSER, ADAPTER];
const ANCHOR = String.raw`(?<=^|[.!?]\\s|Action:\\s)`;

interface Mutant {
  readonly id: string;
  readonly file: string;
  readonly find: string;
  readonly replace: string;
}

const GATE_MUTANTS: readonly Mutant[] = [
  { id: "gate-ignores-screens", file: GATE, find: "const reasons: ExplanationWithholdReason[] = unsupportedClaims(ref, text, supported);", replace: "const reasons: ExplanationWithholdReason[] = [];" },
  { id: "gate-ignores-causes", file: GATE, find: 'if (makesCausalClaim(own)) reasons.push("UNESTABLISHED_CAUSE");', replace: 'if (false) reasons.push("UNESTABLISHED_CAUSE");' },
  { id: "gate-ignores-consequences", file: GATE, find: 'if (makesConsequenceClaim(rest)) reasons.push("UNESTABLISHED_CONSEQUENCE");', replace: 'if (false) reasons.push("UNESTABLISHED_CONSEQUENCE");' },
  { id: "evidence-never-removed", file: GATE, find: "return rest;", replace: "return text;" },
  { id: "evidence-trusted-anywhere", file: GATE, find: ANCHOR, replace: "" },
  { id: "evidence-trusted-after-colon-or-semicolon", file: GATE, find: ANCHOR, replace: String.raw`(?<=^|[.!?;:]\\s|Action:\\s)` },
  { id: "flow-not-run-evidence-for-any-severity", file: GATE, find: "isExecutionBlocking(ref.issue) ? FLOW_NOT_RUN : /$^/", replace: "FLOW_NOT_RUN" },
  { id: "flow-not-run-evidence-for-any-subject", file: GATE, find: String.raw`(?:the flow|this flow|the run|the automation)\s+`, replace: String.raw`(?:the flow|this flow|the run|the automation|this step|it)\s+` },
  { id: "consequence-vocabulary-without-skip", file: GATE, find: '"skip(?:s|ped|ping)?",', replace: "" },
  { id: "consequence-vocabulary-without-forever", file: GATE, find: '"forever",', replace: "" },
  { id: "cause-connectives-without-due-to", file: GATE, find: "|due to|", replace: "|" },
  { id: "validation-failure-read-as-consequence", file: GATE, find: 'own.replace(VALIDATION_FAILED, " ")', replace: "own" },
  { id: "issue-id-as-step-not-a-position", file: GATE, find: '|\\b(?:steps?|nodes?|connectors?)\\s+["\'`“‘]?i\\d+\\b', replace: "" },
  // DX revision 2's one R4 change: a number ending a sentence of the request is held ("…from 1 to 1000.").
  { id: "number-ending-a-sentence-not-held", file: GATE, find: String.raw`(?![\\w,]|\\.\\d)`, replace: String.raw`(?![\\w.,])` },
  { id: "parser-drops-the-gate-decision", file: PARSER, find: "...(withheld.length > 0 ? { withheld } : {})", replace: "...({})" },
  { id: "adapter-sends-withheld-text", file: ADAPTER, find: "(withheld ? { issue, text: null, step, withheld } : { issue, text, step })", replace: "({ issue, text, step, ...(withheld ? { withheld } : {}) })" }
];

// Each control loads its file through the hook with its text unchanged.
const GATE_CONTROLS: readonly Mutant[] = [
  { id: "control-gate", file: GATE, find: "export function withholdReasons(", replace: "export function withholdReasons(" },
  { id: "control-parser", file: PARSER, find: "...(withheld.length > 0 ? { withheld } : {})", replace: "...(withheld.length > 0 ? { withheld } : {})" },
  { id: "control-adapter", file: ADAPTER, find: "(withheld ? { issue, text: null, step, withheld } : { issue, text, step })", replace: "(withheld ? { issue, text: null, step, withheld } : { issue, text, step })" }
];

// L4b's DX evaluator and held-out check: every rule of §0 and §5 it applies, broken one at a time. Since revision 2
// (owner, 2026-09-26), DX-3 is the automated review, and the judge's rules for the held-out set's three codes are here.
const CAP = "const overCap = runs.filter((r) => (r.sent - r.displayed) * wd > r.sent * wn);";
const DX0_STATUS = 'status: voided.length > 0 || currentProblems.length > 0 ? "NOT MET" : "MET",';
const DX_MUTANTS: readonly Mutant[] = [
  { id: "dx-cap-counts-only-the-gate", file: DX_FILE, find: CAP, replace: "const overCap = runs.filter((r) => r.gateWithheld * wd > r.sent * wn);" },
  { id: "dx-cap-averaged", file: DX_FILE, find: CAP, replace: "const overCap = runs.reduce((n, r) => n + r.sent - r.displayed, 0) * wd > runs.reduce((n, r) => n + r.sent, 0) * wn ? runs : [];" },
  { id: "dx-undelivered-uncounted", file: DX_FILE, find: "undelivered: sent - items.length,", replace: "undelivered: 0," },
  { id: "dx-withheld-credited", file: DX_FILE, find: "const good = displayed.filter(", replace: "const good = readable.filter(" },
  { id: "dx-escape-forgiven", file: DX_FILE, find: 'status: escaped.length > 0 ? "NOT MET"', replace: 'status: false ? "NOT MET"' },
  { id: "dx3-judged-before-dx2", file: DX_FILE, find: ": !dx2Met", replace: ": false" },
  { id: "dx3-actionable-not-required", file: DX_FILE, find: "readOf(i).correct && readOf(i).actionable", replace: "readOf(i).correct" },
  { id: "dx3-misattribution-not-a-defect", file: DX_FILE, find: 'if (item.judged.misattributed) defects.add("MISATTRIBUTED");', replace: "" },
  { id: "dx3-unsupported-facts-ignored", file: DX_FILE, find: 'if (screens.includes("FABRICATED_LITERAL") || screens.includes("OFF_DOMAIN")) defects.add("UNSUPPORTED_FACT");', replace: "" },
  { id: "dx3-contradictions-ignored", file: DX_FILE, find: 'k === "SEVERITY_OVERSTATED" || k === "SEVERITY_UNDERSTATED" || k === "AUTO_FIX_CLAIMED" || k === "WRONG_REMEDY"', replace: "false" },
  { id: "dx3-outcome-support-unchecked", file: DX_FILE, find: 'evidence.has(stem(w)))) defects.add("INVENTED_CONSEQUENCE");', replace: 'true)) defects.add("INVENTED_CONSEQUENCE");' },
  { id: "dx3-added-facts-unchecked", file: DX_FILE, find: 'if (added.length > 0) defects.add(causal ? "INVENTED_CAUSE" : "INVENTED_CONSEQUENCE");', replace: "" },
  { id: "dx3-cause-without-since", file: DX_FILE, find: "|which means|since|thus|", replace: "|which means|thus|" },
  { id: "dx3-outcomes-without-breaks", file: DX_FILE, find: String.raw`/\bbreaks\b|\bbroke(?:n)?\b|\b(?:may|might|could|would|will)\s+break\b/gi,`, replace: "" },
  { id: "dx3-not-running-for-any-severity", file: DX_FILE, find: "item.blocking && WHOLE_RUN.test(sentence)", replace: "WHOLE_RUN.test(sentence)" },
  { id: "dx3-secret-ignored", file: DX_FILE, find: 'if (item.text === null) return { defects: ["SECRET"],', replace: "if (item.text === null) return { defects: []," },
  { id: "dx-earlier-revision-voids", file: DX_FILE, find: "revisions.slice(0, -1).find(", replace: "revisions.slice(0, 0).find(" },
  { id: "dx-incomplete-run-dropped", file: DX_FILE, find: " && incomplete.length === 0", replace: "" },
  { id: "dx-void-ignored", file: DX_FILE, find: DX0_STATUS, replace: 'status: currentProblems.length > 0 ? "NOT MET" : "MET",' },
  { id: "dx-tree-unchecked", file: DX_FILE, find: DX0_STATUS, replace: 'status: voided.length > 0 ? "NOT MET" : "MET",' },
  { id: "dx-model-unchecked", file: DX_FILE, find: 'if (capture.modelId !== rev.modelId || inputs.modelSha256 !== rev.modelSha256) problems.push("model");', replace: "" },
  { id: "dx-runtime-unchecked", file: DX_FILE, find: 'if (inputs.runtimeBuild !== rev.runtimeBuild) problems.push("runtime");', replace: "" },
  { id: "dx-blobs-unchecked", file: DX_FILE, find: 'if (!blobsMatch(inputs.blobs, rev)) problems.push("source blobs");', replace: "" },
  { id: "dx-request-unchecked", file: DX_FILE, find: 'if (capture.instructionsSha256 !== rev.instructionsSha256) problems.push("request");', replace: "" },
  { id: "dx-held-out-unchecked", file: DX_FILE, find: 'if (heldOutSha256 === null || inputs.heldOutSha256 !== heldOutSha256) problems.push("held-out corpus");', replace: "" },
  { id: "dx-packet-lists-void", file: DX_FILE, find: ".filter((c) => c.inputs !== undefined && captureInputProblems(c, heldOutSha).length === 0)", replace: ".filter((c) => c.inputs !== undefined)" },
  { id: "held-out-hash-of-layout", file: DX_FILE, find: "const hash = sha256(JSON.stringify(value));", replace: "const hash = sha256(text);" },
  { id: "held-out-canary-unchecked", file: DX_FILE, find: "if (text.toUpperCase().includes(CANARY)) problems.push", replace: "if (false) problems.push" },
  { id: "held-out-labelled-id-unchecked", file: DX_FILE, find: "if (labelledIds.has(flow.id)) problems.push", replace: "if (false) problems.push" },
  { id: "held-out-secret-unchecked", file: DX_FILE, find: "if (secrets.length > 0) problems.push", replace: "if (false) problems.push" },
  { id: "held-out-minimum-dropped", file: DX_FILE, find: "issues < DX_RULES.minHeldOutIssues) problems.push", replace: "issues < 0) problems.push" },
  { id: "held-out-uncommitted-accepted", file: DX_FILE, find: "problems.push(`git cannot show that ${dir} is committed`);", replace: "" },
  // The reviewer-label guard the adopted target relies on: an agent's name inside a longer label is no person's.
  { id: "reviewer-agent-word-ignored", file: REVIEW_FILE, find: " && !AGENT_WORD.test(label)", replace: "" },
  // The judge's rules for the held-out set's three codes (revision 2).
  { id: "subject-flow-reference-dropped", file: SET_FILE, find: "  missingFlowReference: /\\brun[ -]another", replace: "  missingFlowReferenceDropped: /\\brun[ -]another" },
  { id: "subject-flow-reference-reads-any-flow", file: SET_FILE, find: "  missingFlowReference: /\\brun[ -]another[ -]flow\\b|", replace: "  missingFlowReference: /\\bflow\\b|\\brun[ -]another[ -]flow\\b|" },
  { id: "subject-connector-structure-dropped", file: SET_FILE, find: "  connectorStructure: /connector|connection|\\bedges?\\b|\\blinks?\\b|structur/i,", replace: "" },
  { id: "remedy-loop-bounds-dropped", file: SET_FILE, find: "  invalidLoopBounds: /\\bloop|iteration|\\blimit|\\bbounds?\\b|\\bnumber\\b|\\bcount\\b|\\b1000\\b/i", replace: "  invalidLoopBoundsDropped: /x/" }
];
const DX_CONTROLS: readonly Mutant[] = [
  { id: "control-dx", file: DX_FILE, find: "export function evaluateDx(", replace: "export function evaluateDx(" },
  { id: "control-review", file: REVIEW_FILE, find: "export function isGenuineReviewer(", replace: "export function isGenuineReviewer(" },
  { id: "control-set", file: SET_FILE, find: "export function heldOutCodeControlFailures(", replace: "export function heldOutCodeControlFailures(" }
];

const MUTANTS = DX ? DX_MUTANTS : GATE_MUTANTS;
const CONTROLS = DX ? DX_CONTROLS : GATE_CONTROLS;

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${!ok && detail ? ` — ${detail}` : ""}`);
}

const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const occurrences = (m: Mutant) => readFileSync(m.file, "utf8").split(m.find).length - 1;
const work = mkdtempSync(join(tmpdir(), "awkit-display-gate-mutants-"));

interface Outcome {
  readonly mutant: Mutant;
  readonly code: number | null;
  readonly loaded: boolean;
  readonly passedChecks: number | null;
  readonly totalChecks: number | null;
  readonly failures: string[];
  readonly tail: string;
}

// `--import` and `module.register` arrived in Node 20.6 and 18.19; an older Node chains `--loader`s instead.
const modern = typeof (nodeModule as { register?: unknown }).register === "function";
const loaderFlag = modern ? "--import" : "--loader";

function run(mutant: Mutant): Promise<Outcome> {
  const marker = join(work, `${mutant.id}.loaded`);
  return new Promise((done) => {
    const child = spawn(process.execPath, [loaderFlag, "tsx", loaderFlag, HOOKS, VERIFIER], {
      cwd: root,
      env: { ...process.env, AWKIT_SOURCE_MUTANT: JSON.stringify({ ...mutant, marker }), AWKIT_SOURCE_MUTANT_REGISTER: modern ? "1" : "0" },
      windowsHide: true
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill(), 300_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      const summary = /fix ranking: (\d+)\/(\d+) checks passed\./.exec(out);
      done({
        mutant,
        code,
        loaded: existsSync(marker),
        passedChecks: summary ? Number(summary[1]) : null,
        totalChecks: summary ? Number(summary[2]) : null,
        failures: [...out.matchAll(/^\s*✗ (.+)$/gm)].map((m) => m[1].trim()),
        tail: out.trim().split(/\r?\n/).slice(-3).join(" | ")
      });
    });
  });
}

async function runAll(mutants: readonly Mutant[], concurrency = 4): Promise<Outcome[]> {
  const results: Outcome[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, mutants.length) }, async () => {
      while (next < mutants.length) results.push(await run(mutants[next++]));
    })
  );
  return mutants.map((m) => results.find((r) => r.mutant === m)!);
}

console.log(`${DX ? "L4b DX evaluator" : "R4 display gate"} — mutation run of verify:ai-authoring (no source file is written)\n`);
const hashesBefore = FILES.map(sha);

console.log("Preconditions");
for (const m of [...CONTROLS, ...MUTANTS]) check(`${m.id}: its text occurs exactly once in ${m.file.slice(root.length + 1)}`, occurrences(m) === 1, `${occurrences(m)} occurrences`);
if (failed > 0) {
  console.log(`\n${passed} passed, ${failed} failed — FAIL (a mutant that does not apply cannot be run)`);
  process.exit(1);
}

console.log("\nControls: each file through the hook, unchanged, passes in full");
for (const r of await runAll(CONTROLS)) {
  check(
    `${r.mutant.id}: loaded through the hook, ${r.passedChecks ?? "?"}/${r.totalChecks ?? "?"} checks, exit ${r.code}`,
    r.loaded && r.code === 0 && r.totalChecks !== null && r.totalChecks > 0 && r.passedChecks === r.totalChecks,
    r.failures.slice(0, 3).join(" | ") || r.tail
  );
}
if (failed > 0) {
  console.log(`\n${passed} passed, ${failed} failed — FAIL (the hook itself does not load a file cleanly, so no mutant result would mean anything)`);
  process.exit(1);
}

console.log(`\nMutants (${MUTANTS.length}): each must be killed by a failed check`);
const outcomes = await runAll(MUTANTS);
for (const r of outcomes) {
  const killed = r.loaded && r.code !== 0 && r.totalChecks !== null && r.passedChecks !== null && r.passedChecks < r.totalChecks;
  const how = !r.loaded ? "never loaded" : r.totalChecks === null ? `crashed (exit ${r.code}), not an assertion` : killed ? `killed ${r.totalChecks - r.passedChecks!} check(s)` : "SURVIVED";
  check(`${r.mutant.id}: ${how}`, killed, r.failures.slice(0, 2).join(" | ") || r.tail);
  if (killed) console.log(`      e.g. ${r.failures[0]}`);
}
check(`every mutant was run (${outcomes.length} of ${MUTANTS.length})`, outcomes.length === MUTANTS.length && MUTANTS.length > 0);
check("no mutated source file changed", FILES.every((f, i) => sha(f) === hashesBefore[i]));
rmSync(work, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed — ${failed === 0 ? "PASS" : "FAIL"}`);
process.exit(failed === 0 ? 0 : 1);
