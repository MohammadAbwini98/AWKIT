/**
 * verify:ai-gpu-quality (`--execution auto`) and verify:ai-gpu-quality-cpu-baseline (`--execution cpu`): the curated
 * Qwen3.5-0.8B's live acceptance gates under one execution arm, for L8a's question "does the GPU keep the quality
 * of the qualified CPU & RAM configuration?".
 *
 * Each gate runs through its existing launcher, `verify-ai-explanation-live.mts --execution <arm>`, with its own
 * labelled set, judge, deadlines and thresholds; nothing is re-judged here:
 *   - failure analysis and locator upgrade (L5b/L3 feature requests, typical and largest, accepted);
 *   - L3's locator-quality set (every plan proven in real Chromium, the page as judge, 0 false targets);
 *   - L4b's authoring set and L5's error set, in `--cases` groups of at most three model calls, so each run fits the
 *     launcher's 575 s part budget on a CPU slower than the qualifying host (on the GPU they take seconds). The
 *     groups cover every labelled case exactly once.
 * Printed per gate: its checks and exit code; its recorded quality (L5 accuracy, attribution, declines and evidence
 * links; L4b delivery and proxies; L3's evidence totals); and every model call's execution as the launcher printed
 * it (resolved mode, backend, offload, cold load, first token, generation, tokens, end to end), summed over the run.
 *
 * Where it ran is part of the evidence: Windows' display adapters and this process's session, at the start and the
 * end. The auto arm is NVIDIA evidence only at the physical console with no Remote Desktop adapter; anywhere else it
 * is INCONCLUSIVE. The CPU arm runs anywhere. Authoring review captures go to this qualification's own store
 * (`ai-quality-review-l8a`), never the one `verify:ai-authoring-review` judges.
 *
 * Exit 0 when every gate passed, 1 when any failed, 2 when any was NOT RUN or INCONCLUSIVE (an Automatic run that did
 * not resolve to the GPU included), or the topology was not the console's. Full gate output is kept in a temp folder.
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const armFlag = process.argv.indexOf("--execution");
const arm = armFlag >= 0 ? process.argv[armFlag + 1] : undefined;
if (arm !== "cpu" && arm !== "auto") {
  console.error('--execution takes "cpu" or "auto"');
  process.exit(1);
}
// `--part 1` runs the feature, authoring and locator-quality gates and `--part 2` the whole L5 error set, so each
// part of the GPU arm fits the 600 s tool ceiling; no part leaves a labelled set split across the two.
const partFlag = process.argv.indexOf("--part");
const part = partFlag >= 0 ? Number(process.argv[partFlag + 1]) : 0;
if (partFlag >= 0 && part !== 1 && part !== 2) {
  console.error("--part takes 1 or 2");
  process.exit(1);
}

interface Gate {
  name: string;
  feature: string;
  cases?: string[];
}
/** Every labelled case of the authoring and error sets exactly once, at most three model calls per group. */
const GATES: readonly Gate[] = [
  { name: "failure-analysis", feature: "failureAnalysis" },
  { name: "locator-upgrade", feature: "locatorUpgrade" },
  { name: "authoring-A1", feature: "authoringQuality", cases: ["casing", "locator-orphan", "branch"] },
  { name: "authoring-A2", feature: "authoringQuality", cases: ["cycle", "values", "duplicate-timeout"] },
  { name: "authoring-A3", feature: "authoringQuality", cases: ["priority", "warnings", "single"] },
  { name: "error-G1", feature: "errorQuality", cases: ["toast-timeout", "native-validation", "pass-with-warning", "insufficient"] },
  { name: "error-G2", feature: "errorQuality", cases: ["conflict-and-validation", "server-error-rows"] },
  { name: "error-G3", feature: "errorQuality", cases: ["cause-then-unrelated-console", "transport-noise", "pageerror-timeout"] },
  { name: "error-G4", feature: "errorQuality", cases: ["burst", "unrelated-server-error-first", "timeout-unrelated-console"] },
  { name: "error-G5", feature: "errorQuality", cases: ["earlier-step-unrelated-error", "earlier-step-cause"] },
  { name: "error-G6", feature: "errorQuality", cases: ["rq-linked-vs-background", "rq-legacy", "rq-issued-before"] },
  { name: "error-G7", feature: "errorQuality", cases: ["rq-off-target", "rq-linked-earlier-step", "rq-uncertain"] },
  { name: "locator-quality", feature: "locatorQuality" }
];

// ── Where it runs ───────────────────────────────────────────────────────────────────────────────

function topology() {
  const adapters = spawnSync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_VideoController | ForEach-Object { '{0}|{1}' -f $_.PNPDeviceID, $_.Name }"],
    { encoding: "utf8", windowsHide: true, timeout: 60_000 }
  );
  const list = String(adapters.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ pnp: line.split("|")[0] ?? "", name: line.split("|").slice(1).join("|") }));
  // `query session` marks this process's session with ">"; its name is "console" at the physical console.
  const sessions = spawnSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "query.exe"), ["session"], { encoding: "utf8", windowsHide: true, timeout: 60_000 });
  const own = String(sessions.stdout ?? "")
    .split(/\r?\n/)
    .find((line) => line.startsWith(">"));
  const fields = own?.slice(1).trim().split(/\s+/) ?? [];
  const sessionName = fields.length >= 4 ? fields[0] : "";
  const state = fields.find((field) => /^(Active|Disc|Conn|Listen)$/i.test(field)) ?? "unknown";
  const remoteAdapter = list.some((a) => /^SWD\\REMOTEDISPLAYENUM\\/i.test(a.pnp));
  return {
    adapters: list.map((a) => `${a.name} (${a.pnp.split("\\").slice(0, 2).join("\\")})`),
    nvidia: list.some((a) => /^PCI\\VEN_10DE&/i.test(a.pnp)),
    remoteAdapter,
    session: `${sessionName || "(unnamed)"} ${state}`,
    console: /^console$/i.test(sessionName) && /^Active$/i.test(state) && !remoteAdapter
  };
}

// ── One gate ────────────────────────────────────────────────────────────────────────────────────

const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
const logDir = fs.mkdtempSync(path.join(os.tmpdir(), `awkit-gpu-quality-${arm}-`));
const env = {
  ...process.env,
  AWKIT_AI_REVIEW_DIR: process.env.AWKIT_AI_REVIEW_DIR ?? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "SpecterStudio", "ai-quality-review-l8a", "authoring")
};

function runGate(gate: Gate): Promise<{ exit: number; text: string; seconds: number }> {
  const args = [tsxCli, path.join("scripts", "verify-ai-explanation-live.mts"), "--feature", gate.feature, ...(gate.cases ? ["--cases", gate.cases.join(",")] : []), "--execution", arm!];
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env, windowsHide: true });
    let text = "";
    child.stdout.on("data", (chunk) => (text += chunk));
    child.stderr.on("data", (chunk) => (text += chunk));
    child.on("close", (code) => {
      fs.writeFileSync(path.join(logDir, `${gate.name}.log`), text, "utf8");
      resolve({ exit: code ?? 1, text, seconds: Math.round((Date.now() - started) / 1000) });
    });
  });
}

/** The JSON a launcher printed after a step label, e.g. "    the labelled set: …: {…}". */
function detailAfter(text: string, labelStart: string): Record<string, unknown> | null {
  const line = text.split(/\r?\n/).find((l) => l.trimStart().startsWith(labelStart) && l.includes(": {"));
  if (!line) return null;
  try {
    return JSON.parse(line.slice(line.indexOf(": {") + 2)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const CALL_LINE =
  /^\s+· (\w+) (\w+)(?:\/(\w+))?: ([\w-]+) on (\w+) \(([^)]*)\), answer (\S+)(?:, cold load (\S+) ms|, warm), first token (\S+) ms, generation (\S+) ms, (\S+)\/(\d+) out \((\S+) in\), (\d+) ms end to end$/;
interface Call {
  gate: string;
  feature: string;
  status: string;
  resolved: string;
  backend: string;
  answer: string;
  coldLoadMs: number | null;
  firstTokenMs: number | null;
  generationMs: number | null;
  outputTokens: number | null;
  maxOutputTokens: number;
  wallMs: number;
}
const num = (value: string | undefined) => (value === undefined || value === "-" || value === "?" ? null : Number(value));

function callsOf(gate: string, text: string): Call[] {
  return text
    .split(/\r?\n/)
    .map((line) => CALL_LINE.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({
      gate,
      feature: m[1],
      status: m[3] ? `${m[2]}/${m[3]}` : m[2],
      resolved: m[4],
      backend: m[5],
      answer: m[7],
      coldLoadMs: num(m[8]),
      firstTokenMs: num(m[9]),
      generationMs: num(m[10]),
      outputTokens: num(m[11]),
      maxOutputTokens: Number(m[12]),
      wallMs: Number(m[14])
    }));
}

const ratio = (value: unknown) => {
  const m = /^(\d+)\/(\d+)$/.exec(String(value ?? ""));
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
};
const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

// ── Run ─────────────────────────────────────────────────────────────────────────────────────────

const selected = GATES.filter((gate) => part === 0 || (part === 2) === (gate.feature === "errorQuality"));
console.log(`verify:ai-gpu-quality${arm === "cpu" ? "-cpu-baseline" : part ? `-part${part}` : ""} — the 0.8B's live acceptance gates under --execution ${arm}${part ? `, part ${part} (${selected.length} of ${GATES.length} gates)` : ""}\n`);
const before = topology();
console.log(`  · at the start: session ${before.session}; adapters ${before.adapters.join("; ")}`);
let failed = 0;
let unsettled = 0;
const results: Array<{ gate: Gate; exit: number; seconds: number; checks: string }> = [];
const calls: Call[] = [];
const error = { baselineRight: 0, aiRight: 0, rows: 0, improvement: 0, falseAttributions: 0, declined: 0, linksShown: 0, linksCited: 0 };
const authoring = { cases: 0, accepted: 0, rejected: 0, inconclusive: 0, issuesSent: 0, explained: 0, onSubject: 0, misattributed: 0, actionable: 0, cutByGrammar: 0, displayWithheld: 0 };
const perRow: string[] = [];
let locatorEvidence: string | null = null;

for (const gate of selected) {
  const run = await runGate(gate);
  const checks = run.text.match(/(\d+) passed, (\d+) failed/g)?.at(-1) ?? "no summary";
  results.push({ gate, exit: run.exit, seconds: run.seconds, checks });
  const verdict = run.exit === 0 ? "PASS" : run.exit === 2 ? "INCONCLUSIVE / NOT RUN" : "FAIL";
  console.log(`\n  ${run.exit === 0 ? "✓" : run.exit === 2 ? "?" : "✗"} ${gate.name} (${gate.feature}${gate.cases ? `: ${gate.cases.join(", ")}` : ""}) — ${verdict}, ${checks}, ${run.seconds} s`);
  for (const line of run.text.split(/\r?\n/).filter((l) => /^\s+✗ /.test(l))) console.log(`      ${line.trim().slice(0, 400)}`);
  if (run.exit === 1) failed += 1;
  if (run.exit === 2) unsettled += 1;
  calls.push(...callsOf(gate.name, run.text));
  if (gate.feature === "errorQuality") {
    const q = detailAfter(run.text, "the labelled set: every row delivered");
    if (q) {
      const [b, rows] = ratio(q.baselineAccuracy);
      const [a] = ratio(q.aiAccuracy);
      const [shown, cited] = ratio(q.evidenceLinkAccuracy);
      error.baselineRight += b;
      error.aiRight += a;
      error.rows += rows;
      error.improvement += Number(q.aiImprovementOverBaseline ?? 0);
      error.falseAttributions += Number(q.falseAttributions ?? 0);
      error.declined += Number(q.declined ?? 0);
      error.linksShown += shown;
      error.linksCited += cited;
      perRow.push(...((q.perRow as string[] | undefined) ?? []));
      console.log(`      L5: baseline ${q.baselineAccuracy}, AI ${q.aiAccuracy}, false attributions ${q.falseAttributions}, declined ${q.declined}, links ${q.evidenceLinkAccuracy}`);
    }
  }
  if (gate.feature === "authoringQuality") {
    const q = detailAfter(run.text, "the labelled set: every answer delivered");
    if (q) {
      const responses = (q.responses ?? {}) as Record<string, number>;
      authoring.cases += Number(q.cases ?? 0);
      authoring.accepted += responses.accepted ?? 0;
      authoring.rejected += responses.rejected ?? 0;
      authoring.inconclusive += responses.inconclusive ?? 0;
      authoring.issuesSent += Number(q.issuesSent ?? 0);
      authoring.explained += Number(q.explained ?? 0);
      authoring.onSubject += ratio(q.onSubject)[0];
      authoring.misattributed += Number(q.misattributed ?? 0);
      authoring.actionable += ratio(q.actionable)[0];
      authoring.cutByGrammar += Number(q.cutByGrammar ?? 0);
      authoring.displayWithheld += Number(q.displayWithheld ?? 0);
      console.log(`      L4b: ${q.cases} cases, responses ${JSON.stringify(responses)}, on subject ${q.onSubject}, actionable ${q.actionable}, misattributed ${q.misattributed}, unsupported ${JSON.stringify(q.unsupported)}, cut by grammar ${q.cutByGrammar}`);
    }
  }
  if (gate.feature === "locatorQuality") {
    const line = run.text.split(/\r?\n/).find((l) => l.trimStart().startsWith("evidence: "));
    locatorEvidence = line?.trim() ?? null;
    const file = /evidence: (\S+\.json)/.exec(line ?? "")?.[1];
    if (file && fs.existsSync(path.join(ROOT, file))) {
      const saved = JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8")) as { result: string; execution: unknown; caseCounts: Record<string, number>; totals: Record<string, number> };
      console.log(`      L3: ${saved.result}, execution ${JSON.stringify(saved.execution)}, cases ${JSON.stringify(saved.caseCounts)}, totals ${JSON.stringify(saved.totals)}`);
    }
  }
}

const after = topology();
console.log(`\n  · at the end: session ${after.session}; adapters ${after.adapters.join("; ")}`);

// ── Summary ─────────────────────────────────────────────────────────────────────────────────────

const answered = calls.filter((c) => c.answer !== "none");
const cold = calls.map((c) => c.coldLoadMs).filter((v): v is number => v !== null);
const pick = (key: "firstTokenMs" | "generationMs" | "wallMs") => answered.map((c) => c[key]).filter((v): v is number => v !== null);
const atCap = answered.filter((c) => c.outputTokens !== null && c.outputTokens >= c.maxOutputTokens).length;
const configurations = [...new Set(answered.map((c) => `${c.resolved} on ${c.backend}, answer ${c.answer}`))];
console.log(`\n  summary under --execution ${arm}:`);
console.log(`    gates: ${results.filter((r) => r.exit === 0).length} PASS, ${failed} FAIL, ${unsettled} INCONCLUSIVE/NOT RUN of ${results.length}`);
console.log(`    model calls: ${calls.length} recorded, ${answered.length} answered, ${calls.length - answered.length} with no answer (${calls.filter((c) => c.answer === "none").map((c) => `${c.gate} ${c.status}`).join(", ") || "none"})`);
console.log(`    configurations answered in: ${configurations.join(" | ") || "none"}`);
console.log(`    L5 error set: baseline ${error.baselineRight}/${error.rows}, AI ${error.aiRight}/${error.rows}, improvement ${error.improvement}, false attributions ${error.falseAttributions}, declined ${error.declined}, links ${error.linksShown}/${error.linksCited}`);
console.log(`    L5 per row: ${perRow.join("; ")}`);
console.log(
  `    L4b authoring set: ${authoring.cases} cases, accepted ${authoring.accepted}, rejected ${authoring.rejected}, inconclusive ${authoring.inconclusive}, explained ${authoring.explained}/${authoring.issuesSent}, on subject ${authoring.onSubject}/${authoring.issuesSent}, actionable ${authoring.actionable}/${authoring.issuesSent}, misattributed ${authoring.misattributed}, cut by grammar ${authoring.cutByGrammar}, display withheld ${authoring.displayWithheld}`
);
console.log(`    L3 locator set: ${locatorEvidence ?? "no evidence line"}`);
console.log(
  `    timings (median over answered calls): first token ${median(pick("firstTokenMs"))} ms, generation ${median(pick("generationMs"))} ms, end to end ${median(pick("wallMs"))} ms; cold loads ${cold.join(", ") || "none"} ms; answers at the output cap ${atCap}/${answered.length}`
);
console.log(`    full gate output: ${logDir}`);

const offConsole = arm === "auto" && !(before.console && after.console && before.nvidia);
if (offConsole) console.log(`\n  ? INCONCLUSIVE: the auto arm is NVIDIA evidence only at the physical console with no Remote Desktop adapter (start: ${before.session}, remote adapter ${before.remoteAdapter}; end: ${after.session}, remote adapter ${after.remoteAdapter})`);
const exit = failed > 0 ? 1 : unsettled > 0 || offConsole ? 2 : 0;
console.log(`\n${results.filter((r) => r.exit === 0).length} gates passed, ${failed} failed, ${unsettled} inconclusive or not run — exit ${exit}`);
process.exit(exit);
