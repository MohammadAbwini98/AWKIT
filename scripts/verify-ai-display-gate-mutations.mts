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
const FILES = [GATE, PARSER, ADAPTER];
const ANCHOR = String.raw`(?<=^|[.!?]\\s|Action:\\s)`;

interface Mutant {
  readonly id: string;
  readonly file: string;
  readonly find: string;
  readonly replace: string;
}

const MUTANTS: readonly Mutant[] = [
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
  { id: "parser-drops-the-gate-decision", file: PARSER, find: "...(withheld.length > 0 ? { withheld } : {})", replace: "...({})" },
  { id: "adapter-sends-withheld-text", file: ADAPTER, find: "(withheld ? { issue, text: null, step, withheld } : { issue, text, step })", replace: "({ issue, text, step, ...(withheld ? { withheld } : {}) })" }
];

// Each control loads its file through the hook with its text unchanged.
const CONTROLS: readonly Mutant[] = [
  { id: "control-gate", file: GATE, find: "export function withholdReasons(", replace: "export function withholdReasons(" },
  { id: "control-parser", file: PARSER, find: "...(withheld.length > 0 ? { withheld } : {})", replace: "...(withheld.length > 0 ? { withheld } : {})" },
  { id: "control-adapter", file: ADAPTER, find: "(withheld ? { issue, text: null, step, withheld } : { issue, text, step })", replace: "(withheld ? { issue, text: null, step, withheld } : { issue, text, step })" }
];

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

console.log("R4 display gate — mutation run of verify:ai-authoring (no product file is written)\n");
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
check("no product source file changed", FILES.every((f, i) => sha(f) === hashesBefore[i]));
rmSync(work, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed — ${failed === 0 ? "PASS" : "FAIL"}`);
process.exit(failed === 0 ? 0 : 1);
