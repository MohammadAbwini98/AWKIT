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
 *
 * `--job-status` (verify:ai-job-status-mutations) runs `verify:ai-job-status` over L9's job-status tracker,
 * ETA history, time budgets, settings sanitizer, qualification and the service's job reporting: each honesty
 * rule and bound, broken one at a time.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DX = process.argv.includes("--dx");
const JOB_STATUS = process.argv.includes("--job-status");
const VERIFIER = join(root, "scripts", JOB_STATUS ? "verify-ai-job-status.mts" : "verify-ai-authoring.mts");
/** The verifier's own summary line: passed and total checks. */
const SUMMARY = JOB_STATUS ? /AI job status: (\d+)\/(\d+) checks passed\./ : /fix ranking: (\d+)\/(\d+) checks passed\./;
const HOOKS = pathToFileURL(join(root, "scripts", "helpers", "source-mutant-hooks.mjs")).href;
const GATE = join(root, "src", "ai", "authoringClaimScreen.ts");
const PARSER = join(root, "src", "ai", "authoringExplanation.ts");
const ADAPTER = join(root, "app", "main", "ai", "aiAssist.ts");
const DX_FILE = join(root, "scripts", "ai-harness", "authoringDx.ts");
const REVIEW_FILE = join(root, "scripts", "ai-harness", "authoringQualityReview.ts");
const SET_FILE = join(root, "scripts", "ai-harness", "authoringQualitySet.ts");
const JOBS = join(root, "src", "ai", "AiJobStatus.ts");
const HISTORY = join(root, "src", "ai", "AiEtaHistory.ts");
const BUDGETS = join(root, "src", "ai", "AiTimeBudgets.ts");
const SETTINGS = join(root, "src", "ai", "AiSettings.ts");
const QUALIFICATION = join(root, "src", "ai", "AiQualification.ts");
const SERVICE = join(root, "src", "ai", "AiService.ts");
const MODEL_PACK = join(root, "src", "ai", "AiModelPack.ts");
const FILES = JOB_STATUS ? [JOBS, HISTORY, BUDGETS, SETTINGS, QUALIFICATION, SERVICE, MODEL_PACK] : DX ? [DX_FILE, REVIEW_FILE, SET_FILE] : [GATE, PARSER, ADAPTER];
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

// L9: every honesty rule and bound the job-status contract, the ETA history and the budgets promise.
const JOB_STATUS_MUTANTS: readonly Mutant[] = [
  { id: "progress-in-any-stage", file: JOBS, find: "job.progress = MEASURABLE_STAGES.has(job.stage) ? validProgress(patch.progress) : null;", replace: "job.progress = validProgress(patch.progress);" },
  { id: "stage-change-keeps-progress", file: JOBS, find: "      job.stage = patch.stage;\n      job.progress = null;", replace: "      job.stage = patch.stage;" },
  { id: "progress-past-its-denominator", file: JOBS, find: "{ done: Math.min(done, total), total, unit }", replace: "{ done, total, unit }" },
  { id: "overrun-never-said", file: JOBS, find: "overrun: ran > estimate.maxMs", replace: "overrun: false" },
  { id: "eta-not-counted-down", file: JOBS, find: "remainingMaxMs: Math.max(0, estimate.maxMs - ran),", replace: "remainingMaxMs: estimate.maxMs," },
  { id: "every-terminal-job-recorded", file: JOBS, find: 'if (state === "completed" && job.cold !== null && job.runningSince !== null && !fellBackCold) {', replace: "if (job.cold !== null && job.runningSince !== null && !fellBackCold) {" },
  { id: "unknown-warmth-recorded", file: JOBS, find: 'if (state === "completed" && job.cold !== null && job.runningSince !== null && !fellBackCold) {', replace: 'if (state === "completed" && job.runningSince !== null && !fellBackCold) {' },
  { id: "no-history-never-said", file: JOBS, find: "noHistory: job.cold !== null && job.estimate === null && job.runningSince !== null && job.askedWithProfile,", replace: "noHistory: false," },
  { id: "no-history-while-pending", file: JOBS, find: "noHistory: job.cold !== null && job.estimate === null && job.runningSince !== null && job.askedWithProfile,", replace: 'noHistory: job.cold !== null && (job.estimate === null || job.estimate === "pending") && job.runningSince !== null && job.askedWithProfile,' },
  // awkit-djnl.17 (independent QC of L9): each fix, undone.
  { id: "no-history-before-placement-known", file: JOBS, find: " && job.runningSince !== null && job.askedWithProfile,", replace: " && job.runningSince !== null," },
  { id: "fallen-back-cold-run-recorded", file: JOBS, find: " && !fellBackCold) {", replace: ") {" },
  { id: "stage-report-keeps-progress", file: SERVICE, find: "{ stage, progress: null }", replace: "{ stage }" },
  { id: "history-any-other-version-unwritable", file: HISTORY, find: 'if (typeof version === "number" && version > AI_ETA_HISTORY_VERSION) return', replace: "if (version !== AI_ETA_HISTORY_VERSION) return" },
  { id: "late-estimate-accepted", file: JOBS, find: "if (job.estimateToken !== token || isTerminal(job.state)) return;", replace: "if (isTerminal(job.state)) return;" },
  { id: "requeue-keeps-eta", file: JOBS, find: 'if (patch.state === "queued") {', replace: 'if (patch.state === "queued" && false) {' },
  { id: "cancel-undone-by-running", file: JOBS, find: '!(job.state === "cancelling" && patch.state === "running")', replace: "true" },
  { id: "terminal-job-mutable", file: JOBS, find: "  update(key: string, patch: AiJobPatch): void {\n    const job = this.jobs.get(key);\n    if (!job || isTerminal(job.state)) return;", replace: "  update(key: string, patch: AiJobPatch): void {\n    const job = this.jobs.get(key);\n    if (!job) return;" },
  { id: "lists-other-owners-jobs", file: JOBS, find: ".filter((job) => job.owner === owner)", replace: ".filter(() => true)" },
  { id: "publishes-unowned-work", file: JOBS, find: "if (!job || job.owner === null || !this.deps.publish) return;", replace: "if (!job || !this.deps.publish) return;" },
  { id: "inverted-range-trusted", file: JOBS, find: "return finite(minMs) && finite(maxMs) && minMs <= maxMs &&", replace: "return finite(minMs) && finite(maxMs) &&" },
  { id: "finished-jobs-kept-forever", file: JOBS, find: "for (const job of finished) if (now - (job.endedAt ?? now) > retainMs) this.jobs.delete(job.key);", replace: "" },
  { id: "confidence-inflated", file: JOBS, find: 'return samples >= 10 ? "high" : samples >= 3 ? "medium" : "low";', replace: 'return "high";' },
  { id: "history-any-key", file: HISTORY, find: "const KEY = /^[A-Za-z0-9._|:@+-]{8,400}$/;", replace: String.raw`const KEY = /^[\s\S]{1,4000}$/;` },
  { id: "history-any-duration", file: HISTORY, find: "typeof value === \"number\" && Number.isInteger(value) && value > 0 && value <= AI_ETA_HISTORY_LIMITS.maxSampleMs;", replace: 'typeof value === "number";' },
  { id: "history-cold-and-warm-mixed", file: HISTORY, find: "return entry ? estimateFromSamples(cold ? entry.cold : entry.warm) : null;", replace: "return entry ? estimateFromSamples([...entry.cold, ...entry.warm]) : null;" },
  { id: "history-samples-uncapped", file: HISTORY, find: "cold: entry.cold.slice(-AI_ETA_HISTORY_LIMITS.samplesPerKey),", replace: "cold: entry.cold," },
  { id: "history-keys-uncapped", file: HISTORY, find: "[[key, entries.get(key)!] as const, ...others].slice(0, AI_ETA_HISTORY_LIMITS.maxKeys);", replace: "[[key, entries.get(key)!] as const, ...others];" },
  { id: "history-drops-the-newest", file: HISTORY, find: ".sort((a, b) => Date.parse(b[1].updatedAt) - Date.parse(a[1].updatedAt));", replace: ".sort((a, b) => Date.parse(a[1].updatedAt) - Date.parse(b[1].updatedAt));" },
  { id: "history-newer-version-overwritten", file: HISTORY, find: "if (!snapshot.writable) return false;", replace: "" },
  { id: "history-corrupt-file-lost", file: HISTORY, find: "await rename(this.filePath, target).catch(() => undefined);", replace: "" },
  { id: "history-never-trims", file: HISTORY, find: "const trim = sorted.length >= AI_ETA_HISTORY_LIMITS.trimFrom;", replace: "const trim = false;" },
  { id: "history-writes-unserialized", file: HISTORY, find: "return runExclusive(dirname(this.filePath), async () => {", replace: "return runExclusive(dirname(this.filePath) + Math.random(), async () => {" },
  { id: "budget-bounds-ignored", file: BUDGETS, find: "seconds * SECOND >= bounds.minMs && seconds * SECOND <= bounds.maxMs;", replace: "seconds > 0;" },
  { id: "changed-budget-unnoticed", file: BUDGETS, find: ".filter((feature) => budgets[FEATURE_BUDGET[feature]] !== AI_TIME_BUDGETS[FEATURE_BUDGET[feature]].defaultMs);", replace: ".filter(() => false);" },
  { id: "explanation-default-moved", file: BUDGETS, find: "authoringExplanation: Object.freeze({ defaultMs: 125 * SECOND,", replace: "authoringExplanation: Object.freeze({ defaultMs: 120 * SECOND," },
  { id: "service-limit-unbounded", file: BUDGETS, find: "export const MAX_INFERENCE_BUDGET_MS = Math.max(...INFERENCE_BUDGETS.map((id) => AI_TIME_BUDGETS[id].maxMs));", replace: "export const MAX_INFERENCE_BUDGET_MS = Number.MAX_SAFE_INTEGER;" },
  { id: "settings-clamp-instead-of-refuse", file: SETTINGS, find: "else if (!isBudgetSeconds(id, seconds)) errors.push(budgetBoundsSentence(id));", replace: "else if (!isBudgetSeconds(id, seconds)) next[id] = Math.min(Math.max(Math.round(Number(seconds) || 0), 15), 600);" },
  { id: "settings-unknown-budget-ignored", file: SETTINGS, find: 'if (!isAiBudgetId(id)) errors.push("timeBudgetSeconds names an unknown budget.");', replace: "if (!isAiBudgetId(id)) continue;" },
  { id: "settings-stored-out-of-range-kept", file: SETTINGS, find: "for (const id of AI_BUDGET_IDS) if (isBudgetSeconds(id, storedBudgets[id])) timeBudgetSeconds[id]", replace: 'for (const id of AI_BUDGET_IDS) if (typeof storedBudgets[id] === "number") timeBudgetSeconds[id]' },
  { id: "changed-budget-still-qualified", file: QUALIFICATION, find: "const qualified = listed.filter((feature) => !changed.has(feature));", replace: "const qualified = listed;" },
  { id: "changed-budget-reason-dropped", file: QUALIFICATION, find: 'if (listed.length > 0) return view("compatible-unqualified", "TIME_BUDGET_CHANGED");', replace: "" },
  { id: "feature-budget-ignored", file: SERVICE, find: "const timeoutMs = settings.budgets ? settings.budgets[FEATURE_BUDGET[request.feature]] : request.timeoutMs;", replace: "const timeoutMs = request.timeoutMs;" },
  { id: "load-budget-ignored", file: SERVICE, find: "const loadMs = settings.budgets?.modelLoad ?? AI_HOST_TIMEOUTS.loadMs;", replace: "const loadMs = AI_HOST_TIMEOUTS.loadMs;" },
  { id: "probe-budget-ignored", file: SERVICE, find: "settings.budgets?.compatibilityProbe ?? AI_HOST_TIMEOUTS.probeMs,", replace: "AI_HOST_TIMEOUTS.probeMs," },
  { id: "generation-never-reported", file: SERVICE, find: 'if (update.stage === "generation") this.deps.jobs?.update(job.request.requestId, { stage: "generation" });', replace: "" },
  { id: "generation-before-first-token", file: SERVICE, find: 'profile: this.jobProfile(settings.executionMode ?? "cpu"), stage: "prompt-evaluation" });', replace: 'profile: this.jobProfile(settings.executionMode ?? "cpu"), stage: "generation" });' },
  { id: "load-progress-dropped", file: SERVICE, find: "if (progress && this.running) this.deps.jobs?.update(this.running.request.requestId, { progress });", replace: "" },
  { id: "warm-job-read-as-cold", file: SERVICE, find: "{ cold: false, profile: this.jobProfile(mode) }", replace: "{ cold: true, profile: this.jobProfile(mode) }" },
  { id: "timeout-read-as-failure", file: SERVICE, find: 'outcome.code === "TIMEOUT" ? "timed-out" : "failed"', replace: '"failed"' },
  { id: "cancelling-not-reported", file: SERVICE, find: 'this.deps.jobs?.update(requestId, { state: "cancelling", cancellable: false });', replace: "" },
  { id: "queue-positions-not-reported", file: SERVICE, find: "    this.queue.splice(index === -1 ? this.queue.length : index, 0, job);\n    this.reportQueue();", replace: "    this.queue.splice(index === -1 ? this.queue.length : index, 0, job);" },
  { id: "hold-reason-not-reported", file: SERVICE, find: "queuePosition: index + 1, holdReason: this.holdReason })", replace: "queuePosition: index + 1, holdReason: null })" },
  { id: "owner-id-unchecked", file: SERVICE, find: "REQUEST_ID.test(request.owner.requestId))) &&", replace: "true)) &&" },
  { id: "gpu-placement-assumed-for-eta", file: SERVICE, find: ": this.profileFor === key && this.refusedKey !== key", replace: ": true" },
  { id: "fallback-reason-dropped", file: SERVICE, find: "fallbackReason: this.profile.fallbackReason", replace: "fallbackReason: null" },
  { id: "copy-progress-unreported", file: MODEL_PACK, find: "report?.(written, total);", replace: "" },
  { id: "cancelled-copy-reads-as-failure", file: MODEL_PACK, find: 'return { ok: false, code: options.signal?.aborted ? "ABORTED" : "COPY_FAILED" };', replace: 'return { ok: false, code: "COPY_FAILED" };' }
];
const JOB_STATUS_CONTROLS: readonly Mutant[] = [
  { id: "control-tracker", file: JOBS, find: "export class AiJobTracker {", replace: "export class AiJobTracker {" },
  { id: "control-history", file: HISTORY, find: "export class AiEtaHistoryStore {", replace: "export class AiEtaHistoryStore {" },
  { id: "control-budgets", file: BUDGETS, find: "export function resolveAiTimeBudgets(", replace: "export function resolveAiTimeBudgets(" },
  { id: "control-settings", file: SETTINGS, find: "export function normalizeAiSettings(", replace: "export function normalizeAiSettings(" },
  { id: "control-qualification", file: QUALIFICATION, find: "export function describeQualification(", replace: "export function describeQualification(" },
  { id: "control-service", file: SERVICE, find: "export class AiService {", replace: "export class AiService {" },
  { id: "control-model-pack", file: MODEL_PACK, find: "export class AiModelPackStore {", replace: "export class AiModelPackStore {" }
];

const MUTANTS = JOB_STATUS ? JOB_STATUS_MUTANTS : DX ? DX_MUTANTS : GATE_MUTANTS;
const CONTROLS = JOB_STATUS ? JOB_STATUS_CONTROLS : DX ? DX_CONTROLS : GATE_CONTROLS;

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
      const summary = SUMMARY.exec(out);
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

console.log(
  `${JOB_STATUS ? "L9 job status, ETA history and budgets" : DX ? "L4b DX evaluator" : "R4 display gate"} — mutation run of ${JOB_STATUS ? "verify:ai-job-status" : "verify:ai-authoring"} (no source file is written)\n`
);
const hashesBefore = FILES.map(sha);

console.log("Preconditions");
// One check naming every offender, so the mutant results below are not pushed out of a bounded log.
const misplaced = [...CONTROLS, ...MUTANTS].filter((m) => occurrences(m) !== 1);
check(
  `every control's and mutant's text occurs exactly once in its file (${CONTROLS.length + MUTANTS.length} checked)`,
  misplaced.length === 0,
  misplaced.map((m) => `${m.id}: ${occurrences(m)} in ${m.file.slice(root.length + 1)}`).join("; ")
);
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
  if (killed) console.log(`      e.g. ${r.failures[0]?.slice(0, 160)}`);
}
const notKilled = outcomes.filter((r) => !(r.loaded && r.code !== 0 && r.totalChecks !== null && r.passedChecks !== null && r.passedChecks < r.totalChecks));
if (notKilled.length > 0) console.log(`\n  not killed: ${notKilled.map((r) => r.mutant.id).join(", ")}`);
check(`every mutant was run (${outcomes.length} of ${MUTANTS.length})`, outcomes.length === MUTANTS.length && MUTANTS.length > 0);
check("no mutated source file changed", FILES.every((f, i) => sha(f) === hashesBefore[i]));
rmSync(work, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed — ${failed === 0 ? "PASS" : "FAIL"}`);
process.exit(failed === 0 ? 0 : 1);
