/**
 * L4b's delivered-experience acceptance, DX-0 to DX-5 (owner decision 2026-09-25, option B, cap 25 %, held-out
 * set required, the owner as reader): docs/plans/ai-upgrade-v5/evidence/L4b-owner-decision-proposal-2026-09-25.md
 * §0 and §5. It sits beside the adopted quality target (authoringQualityReview.ts `evaluateQualityTarget`),
 * which is unchanged and stays on the record as NOT MET. Written before any fresh run: nothing here was fitted
 * to fresh output.
 *
 *  - DX-0: every fresh capture carries the inputs the launcher measured when it was taken (model bytes,
 *    runtime build, the frozen source blobs, the held-out corpus hash), and its request hash. A capture taken
 *    on anything else voids the fresh evidence; the working tree must still match as well.
 *  - DX-1 is proven by `verify:ai-authoring` §14 and `verify:ai-assist-gui` on the accepted build, not here.
 *  - DX-2: at least two complete fresh runs of the labelled set and one of the committed held-out set. A run
 *    left incomplete keeps DX-2 PENDING: a part can be completed, never dropped.
 *  - DX-3: every fresh text, displayed and withheld, is read by the automated technical review below
 *    (`dx3Reading`; owner, in their own words, 2026-09-26: no person reads). No displayed text with an
 *    unsupported fact, a claim contradicting the evidence, an invented cause or consequence, a misattribution or
 *    a leaked secret, and at least 80 % of displayed texts correct and actionable. A withheld text is read to
 *    measure the gate and never credited. Written before any revision-2 output.
 *  - DX-4: in every complete fresh run, labelled or held-out, at most 1 issue in 4 without a displayed AI text.
 *    Withheld by the gate, withheld for a residual secret or never delivered all count (§5: "the model must
 *    give a displayable explanation for at least 3 issues in 4"). Never averaged.
 *  - DX-5: the model's own rates before the gate, per run, reported beside DX.
 *
 * The held-out set's format and structural check are here too: each file is a flow the product accepts, outside
 * the labelled set, with something to ask about, inventoried by what the product's own validator and request
 * builder send. Which flows go in is decided by a rule committed before any candidate was enumerated
 * (authoringHeldOutSelection.ts; owner directive 2026-09-26, latest), never by a person's or the agent's choice.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { sentencesOf } from "@src/ai/authoringClaimScreen";
import { buildAuthoringRequest } from "@src/ai/authoringExplanation";
import { AI_ASSIST_MAX_NODES, sanitizeAuthoringAssistRequest } from "@src/ai/contracts/AiApi";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import { findResidualSecrets } from "@src/semantic/SemanticPolicyValidator";
import { FLOW_VALIDATION_RULES, isExecutionBlocking, validateFlowDefinition } from "@src/validation/FlowValidator";

import type { CaptureInputs, ReviewCapture, ReviewCaptureCase, ReviewItem } from "./authoringQualityReview";
import { CANARY, LABELLED_SET, REMEDY, SUBJECT, type LabelledCase } from "./authoringQualitySet";

/**
 * One acceptance revision's frozen inputs (DX-0). A change to any of them opens a new revision: its captures are
 * judged only against it, and an earlier revision's stay on the record, never counted again and never voiding a
 * later one. Never edited to fit a run.
 */
export interface DxRevision {
  revision: number;
  /** The commit that froze it. */
  commit: string;
  modelId: string;
  modelSha256: string;
  runtimeBuild: string;
  instructionsSha256: string;
  /** `git ls-files -s` blob ids: the runtime pin, and the three files the R4 mutation run covers. */
  blobs: Readonly<Record<string, string>>;
}

export const DX_REVISIONS: readonly DxRevision[] = Object.freeze([
  // Revision 1 (owner decision 2026-09-25, §0): DX NOT MET, labelled run 1 at 5/17 (L4b-dx-fresh-runs-2026-09-26.md).
  Object.freeze({
    revision: 1,
    commit: "335a0a7c",
    modelId: "Qwen3.5-0.8B-unpinned",
    modelSha256: "f5b14da98939b60bbe1019a964eba656407e1e0b64f1fe3003ff6d650e93bfec",
    runtimeBuild: "node-llama-cpp@3.21.1+llama.cpp@v0.4.0",
    instructionsSha256: "ab4b891fa050b9c0fbc85f6c04c93ff9b8effdc77167cbafbef0f7d35a9a3fa5",
    blobs: Object.freeze({
      "src/offline/AiModelManifest.ts": "a6f2472e72b589fb37aa1ba543d588830972d1b2",
      "src/ai/authoringClaimScreen.ts": "3c3204fa350cb922e7b092705ede63f12ddf42a3",
      "src/ai/authoringExplanation.ts": "c4376cccfb79106bc5a88a577d4bf32364612c56",
      "app/main/ai/aiAssist.ts": "74180291114b7eecc9718b8d2761f4dc90665e2b"
    })
  }),
  // Revision 2 (owner, in their own words, 2026-09-26): R5's request, and R4's one proven false positive fixed (a
  // number ending a sentence is held). The same pack, runtime, adapter and held-out set; DX-3 automated.
  Object.freeze({
    revision: 2,
    commit: "dc3d0c18",
    modelId: "Qwen3.5-0.8B-unpinned",
    modelSha256: "f5b14da98939b60bbe1019a964eba656407e1e0b64f1fe3003ff6d650e93bfec",
    runtimeBuild: "node-llama-cpp@3.21.1+llama.cpp@v0.4.0",
    instructionsSha256: "abea5095fad32abbf71f58f1dd2aac5cdca76221e0d493a92bd21c3389de310c",
    blobs: Object.freeze({
      "src/offline/AiModelManifest.ts": "a6f2472e72b589fb37aa1ba543d588830972d1b2",
      "src/ai/authoringClaimScreen.ts": "b8142e0b7928dc7143ffba030ba3f5e662a3363f",
      "src/ai/authoringExplanation.ts": "a8413cc040d013ecc284895c02f7ea51f0a6fb16",
      "app/main/ai/aiAssist.ts": "74180291114b7eecc9718b8d2761f4dc90665e2b"
    })
  }),
  // Revision 3: the same qualified 0.8B and held-out set, with a concise evidence-copying request.
  // The prior failures remain separate evidence and cannot be counted in this revision.
  Object.freeze({
    revision: 3,
    commit: "6da43a9e",
    modelId: "Qwen3.5-0.8B-unpinned",
    modelSha256: "f5b14da98939b60bbe1019a964eba656407e1e0b64f1fe3003ff6d650e93bfec",
    runtimeBuild: "node-llama-cpp@3.21.1+llama.cpp@v0.4.0",
    instructionsSha256: "407d8b735a371dc74d569884523bc6607187dc20a8e9146229f3d1ae0f8a7fce",
    blobs: Object.freeze({
      "src/offline/AiModelManifest.ts": "a6f2472e72b589fb37aa1ba543d588830972d1b2",
      "src/ai/authoringClaimScreen.ts": "b8142e0b7928dc7143ffba030ba3f5e662a3363f",
      "src/ai/authoringExplanation.ts": "38af77bb43a3d0ab352a6b1fc75f7fd37b565d02",
      "app/main/ai/aiAssist.ts": "74180291114b7eecc9718b8d2761f4dc90665e2b"
    })
  })
]);

/** The current revision: what fresh evidence is judged against. */
export const DX0: DxRevision = DX_REVISIONS[DX_REVISIONS.length - 1];

/** §5's thresholds, as ratios of integers so no rounding decides a boundary. */
export const DX_RULES = Object.freeze({
  /** DX-4: issues without a displayed AI text, at most `num/den` of a run's issues (4 of 17). */
  maxNoDisplay: { num: 1, den: 4 },
  /** DX-3: displayed texts judged correct and actionable, at least `num/den`. */
  minCorrectAndActionable: { num: 4, den: 5 },
  labelledRuns: 2,
  heldOutRuns: 1,
  minHeldOutIssues: 17
});

// ── The held-out set: format and structural check ───────────────────────────────────────────────

/**
 * Repository-relative. `flows/` holds one flow per `.json` file, exactly as the product saves a flow
 * (`{ id, name, nodes, edges, ... }`); `inventory.json` is written once by `npm run verify:ai-authoring-held-out`
 * and committed beside it.
 */
export const HELD_OUT_DIR = path.join("docs", "plans", "ai-upgrade-v5", "evidence", "L4b-held-out");

export interface HeldOutCase {
  /** `ho-` and the first 12 hex of `sha256`: stable, and carries nothing from the file's name or content. */
  id: string;
  file: string;
  /** SHA-256 of the parsed file re-serialized, so line endings and indentation do not change it. */
  sha256: string;
  /** What the product's request sends for this flow, in order, as the harness checks it. */
  sent: LabelledCase["sent"];
  truncated: number;
}

export interface HeldOutInventory {
  version: 1;
  /** SHA-256 over the cases' `sha256`, sorted by case id, one per line. */
  corpusSha256: string;
  issues: number;
  cases: HeldOutCase[];
}

export type HeldOutRead =
  | { ok: true; inventory: HeldOutInventory; flows: ReadonlyMap<string, FlowProfile> }
  | { ok: false; notProvided: boolean; problems: string[] };

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
/** A UTF-8 byte-order mark, as some editors save JSON. Written as a char code: an escape can reach disk as the raw character. */
const BOM = String.fromCharCode(0xfeff);
/** Code-unit order, never the host's locale: the corpus hash depends on it. */
const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The request the product builds for a flow with no saved library beside it, as the harness sends it. */
export const heldOutRequest = (flow: FlowProfile) => buildAuthoringRequest(validateFlowDefinition(flow, { referenceableFlowIds: new Set([flow.id]) }));

/**
 * One candidate flow file's structural rules (the README's), named `where` in each problem. It makes a case only
 * when the product accepts it and its validator finds an issue; any problem still refuses the set. Shared by
 * `readHeldOut` and the held-out selection (authoringHeldOutSelection.ts), so a selected flow passes this exactly.
 */
export function checkHeldOutFlow(where: string, raw: string): { problems: string[]; flow?: FlowProfile; heldOutCase?: HeldOutCase } {
  const labelledIds = new Set(LABELLED_SET.map((c) => c.flow.id));
  const problems: string[] = [];
  const text = raw.startsWith(BOM) ? raw.slice(1) : raw;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { problems: [`${where}: not JSON`] };
  }
  const intake = sanitizeAuthoringAssistRequest({ requestId: "held-out", profile: value });
  if (!intake) return { problems: [`${where}: not a flow the product accepts (an id, a nodes array, an edges array, at most ${AI_ASSIST_MAX_NODES} nodes)`] };
  const flow = intake.profile;
  if (text.toUpperCase().includes(CANARY)) problems.push(`${where}: carries the labelled set's canary, so it is labelled-set material`);
  if (labelledIds.has(flow.id)) problems.push(`${where}: its flow id "${flow.id}" is a labelled flow's`);
  // The corpus is committed to the repository. The request never carries values or URLs, so a placeholder
  // changes nothing the model is asked.
  const secrets = findResidualSecrets(text);
  if (secrets.length > 0) problems.push(`${where}: holds what the product's redaction treats as sensitive (${secrets.join(", ")}); replace it with a placeholder`);
  let request: ReturnType<typeof heldOutRequest>;
  try {
    request = heldOutRequest(flow);
  } catch {
    return { problems: [...problems, `${where}: the validator refuses it`] };
  }
  if (!request) return { problems: [...problems, `${where}: the validator finds no issue, so there is nothing to ask about`] };
  const hash = sha256(JSON.stringify(value));
  const sent = request.issues.map((ref) => ({ code: ref.issue.code, fixable: ref.fixable, blocking: isExecutionBlocking(ref.issue) }));
  return { problems, flow, heldOutCase: { id: `ho-${hash.slice(0, 12)}`, file: where, sha256: hash, sent, truncated: request.truncated } };
}

/** Read and check the held-out flows under `dir`. Structural only: no model, no display gate. */
export function readHeldOut(dir: string): HeldOutRead {
  const flowsDir = path.join(dir, "flows");
  const entries = fs.existsSync(flowsDir) ? fs.readdirSync(flowsDir, { withFileTypes: true }).sort((a, b) => byCodeUnits(a.name, b.name)) : [];
  if (entries.length === 0) return { ok: false, notProvided: true, problems: [`no held-out flows in ${flowsDir}`] };
  const problems: string[] = [];
  const cases: HeldOutCase[] = [];
  const flows = new Map<string, FlowProfile>();
  for (const entry of entries) {
    const where = entry.name;
    if (!entry.isFile() || !where.toLowerCase().endsWith(".json")) {
      problems.push(`${where}: only .json flow files belong in flows/`);
      continue;
    }
    const checked = checkHeldOutFlow(where, fs.readFileSync(path.join(flowsDir, where), "utf8"));
    problems.push(...checked.problems);
    if (!checked.flow || !checked.heldOutCase) continue;
    const { id } = checked.heldOutCase;
    if (flows.has(id)) {
      problems.push(`${where}: the same flow as ${cases.find((c) => c.id === id)?.file}`);
      continue;
    }
    flows.set(id, checked.flow);
    cases.push(checked.heldOutCase);
  }
  const issues = cases.reduce((n, c) => n + c.sent.length, 0);
  if (problems.length === 0 && issues < DX_RULES.minHeldOutIssues) problems.push(`${cases.length} flow(s) send ${issues} issue(s); the held-out set needs at least ${DX_RULES.minHeldOutIssues}`);
  if (problems.length > 0) return { ok: false, notProvided: false, problems };
  cases.sort((a, b) => byCodeUnits(a.id, b.id));
  return { ok: true, inventory: { version: 1, corpusSha256: sha256(cases.map((c) => c.sha256).join("\n")), issues, cases }, flows };
}

export const inventoryPath = (dir: string) => path.join(dir, "inventory.json");

/** Why `inventory` is not the committed held-out set under `dir` (empty when it is). Needs git. */
export function heldOutCommitProblems(dir: string, inventory: HeldOutInventory): string[] {
  const problems: string[] = [];
  let committed: unknown = null;
  try {
    committed = JSON.parse(fs.readFileSync(inventoryPath(dir), "utf8"));
  } catch {
    return [`no readable ${inventoryPath(dir)}; npm run verify:ai-authoring-held-out writes it, then commit it`];
  }
  if (JSON.stringify(committed) !== JSON.stringify(inventory)) problems.push("inventory.json does not match the flows as they are now");
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    const tracked = new Set(git("ls-files", "-z", "--", dir).split("\0").filter(Boolean).map((p) => path.normalize(p)));
    const expected = [inventoryPath(dir), ...inventory.cases.map((c) => path.join(dir, "flows", c.file))].map((p) => path.normalize(path.relative(process.cwd(), path.resolve(p))));
    const untracked = expected.filter((p) => !tracked.has(p));
    if (untracked.length > 0) problems.push(`not committed: ${untracked.join(", ")}`);
    if (git("status", "--porcelain", "--", dir).trim() !== "") problems.push(`uncommitted changes under ${dir}`);
  } catch {
    problems.push(`git cannot show that ${dir} is committed`);
  }
  return problems;
}

// ── DX-0: the inputs ────────────────────────────────────────────────────────────────────────────

/** `git hash-object` of each path, which applies the checkout's line-ending filters as `git ls-files -s` does. */
export function gitBlobs(paths: readonly string[], cwd = process.cwd()): Record<string, string> {
  const ids = execFileSync("git", ["hash-object", "--", ...paths], { encoding: "utf8", cwd }).split(/\r?\n/).filter(Boolean);
  return Object.fromEntries(paths.map((p, k) => [p, ids[k] ?? ""]));
}

const blobsMatch = (blobs: Readonly<Record<string, string>> | undefined, rev: DxRevision) => blobs !== undefined && Object.entries(rev.blobs).every(([p, id]) => blobs[p] === id);

/** Why a capture is not revision `rev`'s DX-0 evidence for the committed held-out corpus `heldOutSha256` (empty when it is). */
export function captureInputProblems(capture: ReviewCapture, heldOutSha256: string | null, rev: DxRevision = DX0): string[] {
  const inputs: CaptureInputs | undefined = capture.inputs;
  if (!inputs) return ["taken before DX: no inputs recorded"];
  const problems: string[] = [];
  if (capture.modelId !== rev.modelId || inputs.modelSha256 !== rev.modelSha256) problems.push("model");
  if (inputs.runtimeBuild !== rev.runtimeBuild) problems.push("runtime");
  if (!blobsMatch(inputs.blobs, rev)) problems.push("source blobs");
  if (capture.instructionsSha256 !== rev.instructionsSha256) problems.push("request");
  if (heldOutSha256 === null || inputs.heldOutSha256 !== heldOutSha256) problems.push("held-out corpus");
  return problems;
}

/** The earlier revision whose inputs a capture carries exactly, or `undefined`: such a capture is kept, never counted. */
const earlierRevisionOf = (capture: ReviewCapture, heldOutSha256: string | null, revisions: readonly DxRevision[]) =>
  revisions.slice(0, -1).find((rev) => captureInputProblems(capture, heldOutSha256, rev).length === 0);

/** Why the working tree no longer holds DX-0's sources and request (empty when it does). Needs git. */
export function currentDx0Problems(instructionsSha256: string, runtimeBuild: string | null): string[] {
  const now = gitBlobs(Object.keys(DX0.blobs));
  return [
    ...Object.entries(DX0.blobs).filter(([p, id]) => now[p] !== id).map(([p, id]) => `${p} is ${now[p].slice(0, 8)}, frozen ${id.slice(0, 8)}`),
    ...(instructionsSha256 !== DX0.instructionsSha256 ? [`request instructions sha256 ${instructionsSha256.slice(0, 8)}, frozen ${DX0.instructionsSha256.slice(0, 8)}`] : []),
    ...(runtimeBuild !== DX0.runtimeBuild ? [`AI_RUNTIME_PIN.build ${runtimeBuild}, frozen ${DX0.runtimeBuild}`] : [])
  ];
}

// ── The evaluation ──────────────────────────────────────────────────────────────────────────────

export type DxStatus = "MET" | "NOT MET" | "PENDING";

export interface DxRun {
  corpus: "labelled" | "held-out";
  run: number;
  sent: number;
  displayed: number;
  /** Withheld from display by R4, text kept for a person. */
  gateWithheld: number;
  /** Not kept: something sensitive survived redaction. */
  secretWithheld: number;
  /** Issues with no explanation at all: an answer refused, timed out or not explaining them. */
  undelivered: number;
  /** DX-5, before the gate: the proxy's readings over every explanation the product accepted. */
  ownOnSubject: number;
  ownActionable: number;
  /** DX-3: displayed texts with a defect, a residual secret the product would show included. */
  escapes: number;
  /** DX-3: withheld texts read correct, over all texts read correct. Reported, never capped (§5). */
  falseWithholding: { withheldCorrect: number; correct: number };
}

export interface DxEvaluation {
  /** Captures that are DX evidence, those taken on other inputs (which void it), and an earlier revision's (kept). */
  fresh: number;
  voided: Array<{ captureId: string; problems: string[] }>;
  earlier: Array<{ captureId: string; revision: number }>;
  runs: DxRun[];
  /** DX-3 over every fresh text: `defects` tallies the displayed ones, by reason. */
  reading: { texts: number; displayed: number; correctAndActionable: number; escapes: number; defects: Partial<Record<Dx3Defect, number>>; unjudgeable: number };
  criteria: Array<{ id: string; label: string; status: DxStatus; detail: string }>;
  verdict: DxStatus;
}

// ── DX-3: the automated technical review (owner, in their own words, 2026-09-26) ─────────────────────

/**
 * Why a text fails DX-3. A displayed text with any of them is an escape, and one escape is NOT MET.
 *  - MISATTRIBUTED: it explains another sent issue than its own (the judge's `SUBJECT` reading);
 *  - UNSUPPORTED_FACT: a name, value, position, selector or out-of-flow remedy the request never held (the
 *    `FABRICATED_LITERAL` and `OFF_DOMAIN` screens);
 *  - CONTRADICTS_EVIDENCE: a severity, blocking, fix or remedy claim its own issue line contradicts (the
 *    `SEVERITY_*`, `AUTO_FIX_CLAIMED` and `WRONG_REMEDY` screens);
 *  - INVENTED_CAUSE, INVENTED_CONSEQUENCE: a cause or a run-time outcome its own issue's evidence does not state
 *    (`claimDefects`, DX-3's own reading, wider than the display gate's);
 *  - SECRET: what the product's redaction treats as sensitive, or the labelled set's canary.
 */
export type Dx3Defect = "MISATTRIBUTED" | "UNSUPPORTED_FACT" | "CONTRADICTS_EVIDENCE" | "INVENTED_CAUSE" | "INVENTED_CONSEQUENCE" | "SECRET";

export interface Dx3Reading {
  defects: Dx3Defect[];
  /** The judge has a subject and a remedy rule for the code, so it can read the text at all. */
  judgeable: boolean;
  /** Names its own issue's subject, and no other sent issue's instead. */
  onSubject: boolean;
  /** Names a corrective step a person can take: the judge's reading of the model's own text, never the product's step. */
  actionable: boolean;
  /** On subject, with no defect. */
  correct: boolean;
}

/**
 * Run-time outcomes DX-3 reads. Wider than the display gate on purpose: it adds the forms the gate's documented
 * coverage limits name (L4 › R4, limits 1 and 8), so an outcome the gate lets through is still read here. Every
 * word of a matched outcome must be in the issue's own evidence (`evidenceStems`).
 */
const OUTCOMES: readonly RegExp[] = [
  /\bfail(?:s|ed|ing|ures?)?\b/gi,
  /\bstop(?:s|ped|ping)?\b/gi,
  /\bhalt(?:s|ed|ing)?\b/gi,
  /\babort(?:s|ed|ing)?\b/gi,
  /\bcrash(?:es|ed|ing)?\b/gi,
  /\bhang(?:s|ing)?\b|\bfreez(?:e|es|ing)\b|\bfroze(?:n)?\b/gi,
  /\bterminat(?:e|es|ed|ing)\b/gi,
  /\bskip(?:s|ped|ping)?\b/gi,
  /\bignor(?:e|es|ed|ing)\b/gi,
  /\bfinish(?:es|ed|ing)?\b/gi,
  /\b(?:times?|timed|timing) out\b/gi,
  /\bthrow(?:s|n|ing)?\b/gi,
  /\bforever\b|\binfinite(?:ly)?\b|\bendless(?:ly)?\b/gi,
  /\btwice\b|\brepeatedly\b|\bmore than once\b/gi,
  /\bnever (?:runs?|executes?|starts?|reach(?:es)?|completes?)\b/gi,
  /\bsucce(?:ed|eds|eded|ss)\b/gi,
  /\breports? (?:success|an? error|a failure)\b/gi,
  /\bresolv(?:e|es|ed|ing) to\b/gi,
  /\bwithout reaching\b/gi,
  /\b(?:runtime|run-time)(?:-cycle)? errors?\b/gi,
  // Beyond the gate: its limits 1 and 8. "Break" alone is a corrective verb ("break the loop"), so only with a modal.
  /\bbreaks\b|\bbroke(?:n)?\b|\b(?:may|might|could|would|will)\s+break\b/gi,
  /\blos(?:e|es|t|ing)\b/gi,
  /\bdoes nothing\b|\bnothing happens\b/gi,
  /\bends? up\b/gi
];
/**
 * Something not running. DX-3 accepts it only as its issue's own "blocks the run", said of the whole flow or run,
 * never of a step or a part ("only this step", "it"), as the gate does (QC, 2026-09-25).
 */
const NOT_RUN = /\b(?:cannot|can't|can not|won't|will not|unable to|does not|doesn't|do not|don't)\s+(?:be\s+)?(?:run|start|execute|begin)\b|\bprevent(?:s|ed|ing)?\b|\bfrom (?:running|starting|executing|being run)\b/gi;
const WHOLE_RUN = /\b(?:the|this) (?:flow|run|automation|execution)\b/i;
/** Severity, the screens' to judge both ways: a validation failure claimed, and "(does not) block the run". */
const SEVERITY_PHRASES = /\bfail(?:s|ed|ing)?\s+(?:the\s+|its\s+)?validation\b|\bvalidation\s+(?:\w+\s+){0,2}?fail(?:s|ed|ing|ures?)?\b|\b(?:(?:does|do)(?:n't| not)\s+|not\s+)?block(?:s|ed|ing)?\s+(?:the\s+)?(?:run|flow|execution)\b/gi;
/** A stated cause: the gate's connectives and those its limit 2 names. "So that" states a purpose, not a cause. */
const CAUSE = /\b(?:because|caus(?:e|es|ed|ing)|due to|as a result|results? in|resulted in|resulting in|leads? to|led to|therefore|which means|since|thus|hence|consequently|thereby|owing to|so (?:it|its|the|this|they))\b/i;

/** A crude English stem, applied alike to the text and the evidence: "stops", "stopped" and "stop" all read "stop". */
const stem = (word: string): string => {
  const w = word.toLowerCase();
  return (w.length > 4 ? w.replace(/(?:ing|ed|es|s|e|ly)$/, "") : w.replace(/(?:s|e)$/, "")).replace(/([b-df-hj-np-tv-z])\1$/, "$1");
};
/** Words, camelCase split so an echoed rule code ("deadEndNode") reads as its words. */
const wordsOf = (text: string): string[] => text.replace(/([a-z])([A-Z])/g, "$1 $2").match(/[A-Za-z]+/g) ?? [];
/**
 * Words a claim may use without the evidence holding them: function words, the product's own vocabulary (every
 * request's instructions and Issues format), corrective verbs, and the claim markers themselves. Anything else in a
 * sentence that states a cause or an outcome is a fact that sentence adds, and DX-3 reads it as invented.
 */
const GENERIC = new Set(
  (
    "a an the this that these those it its they them their there here is are was were be been being am has have had having do does did done " +
    "not no nor never none and or but if then than so as at by for from in into of on onto to with without within via per when where which who " +
    "whom whose what why how while until unless only also just still yet any each every all both either neither one ones two other another same " +
    "own more most less least such some very too again once further instead rather else can cannot could may might must should would will shall " +
    "need needs needed able unable about after before over under up down out off above below between through during toward towards upon " +
    "make makes made get gets got let lets keep keeps kept use uses used using take takes took go goes went going come comes came become becomes " +
    "say says said mean means meant seem seems happen happens happened " +
    "automation flow flows step steps node nodes connector connectors issue issues rule rules validation validator error errors warning " +
    "warnings run runs running ran path person editor editing action actions fix fixes fixable safe application severity finding findings " +
    "summary code codes value values setting settings configuration configured missing set problem wrong correct correctly incorrect " +
    "invalid valid required require requires " +
    "add apply attach assign change choose connect convert configure decrease define delete disconnect drop edit enter give insert lower " +
    "move pick provide reconnect reduce regenerate remove rename replace rewrite select shorten specify supply switch update review approve " +
    "because cause causes caused causing due result results resulted resulting lead leads led therefore since thus hence consequently thereby owing"
  )
    .split(/\s+/)
    .map(stem)
);

/** Everything the issue's own evidence says, as stems: its Issues line (code, severity, blocking, place, summary, action). */
const evidenceStems = (item: ReviewItem): Set<string> =>
  new Set(wordsOf(`${item.evidence} ${FLOW_VALIDATION_RULES[item.code].summary} ${item.step ?? ""}`).map(stem));

/**
 * DX-3's reading of the causes and run-time outcomes in `text`, sentence by sentence, against the issue's OWN evidence.
 *  - Each outcome it states must be in that evidence, every word of it. The flow not running counts only for an
 *    issue that blocks the run, said of the whole flow or run.
 *  - A sentence that states a cause or an outcome adds no fact: every other word of it is in the evidence or generic.
 * Lexical, so it reads words, never their relation: a supported cause stated backwards, or an "or" read as "and", is
 * read as supported (limits recorded in L4b's DX evidence).
 */
function claimDefects(item: ReviewItem, text: string): Dx3Defect[] {
  const evidence = evidenceStems(item);
  const defects = new Set<Dx3Defect>();
  for (const sentence of sentencesOf(text)) {
    let rest = sentence.replace(SEVERITY_PHRASES, " ");
    const causal = CAUSE.test(rest);
    let outcome = false;
    for (const pattern of OUTCOMES) {
      for (const m of rest.matchAll(pattern)) {
        outcome = true;
        if (!wordsOf(m[0]).every((w) => ["a", "an", "the", "to", "of"].includes(w.toLowerCase()) || evidence.has(stem(w)))) defects.add("INVENTED_CONSEQUENCE");
      }
      rest = rest.replace(pattern, " ");
    }
    for (const _m of rest.matchAll(NOT_RUN)) {
      outcome = true;
      if (!(item.blocking && WHOLE_RUN.test(sentence) && !/\bonly\b/i.test(sentence))) defects.add("INVENTED_CONSEQUENCE");
    }
    rest = rest.replace(NOT_RUN, " ");
    if (!causal && !outcome) continue;
    const added = wordsOf(rest).filter((w) => w.length >= 3 && !GENERIC.has(stem(w)) && !evidence.has(stem(w)));
    if (added.length > 0) defects.add(causal ? "INVENTED_CAUSE" : "INVENTED_CONSEQUENCE");
  }
  return [...defects];
}

/**
 * DX-3's reading of one captured text: the automated technical review that replaces a person's reading for Phase L
 * technical acceptance (owner, in their own words, 2026-09-26). Deterministic, and written before any revision-2
 * output. It can prove a text wrong, and it reads "correct" only as on subject with no defect it can see.
 */
export function dx3Reading(item: ReviewItem): Dx3Reading {
  const judgeable = SUBJECT[item.code] !== undefined && REMEDY[item.code] !== undefined;
  if (item.text === null) return { defects: ["SECRET"], judgeable, onSubject: false, actionable: false, correct: false };
  const defects = new Set<Dx3Defect>();
  const screens = item.judged.unsupported;
  if (item.judged.misattributed) defects.add("MISATTRIBUTED");
  if (screens.includes("FABRICATED_LITERAL") || screens.includes("OFF_DOMAIN")) defects.add("UNSUPPORTED_FACT");
  if (screens.some((k) => k === "SEVERITY_OVERSTATED" || k === "SEVERITY_UNDERSTATED" || k === "AUTO_FIX_CLAIMED" || k === "WRONG_REMEDY")) defects.add("CONTRADICTS_EVIDENCE");
  for (const d of claimDefects(item, item.text)) defects.add(d);
  if (findResidualSecrets(item.text).length > 0 || item.text.toUpperCase().includes(CANARY)) defects.add("SECRET");
  const onSubject = judgeable && item.judged.onSubject && !item.judged.misattributed;
  return { defects: [...defects], judgeable, onSubject, actionable: judgeable && item.judged.actionable, correct: onSubject && defects.size === 0 };
}

/**
 * DX-0 and DX-2 to DX-5 over the captures, read with today's judge and gate. `heldOut` is the COMMITTED inventory, or
 * `null` when there is none; `currentProblems` is `currentDx0Problems` for the tree. The last of `revisions` is the one
 * judged: a capture on an earlier revision's inputs is kept on the record, never counted, and voids nothing.
 */
export function evaluateDx(
  captures: readonly ReviewCapture[],
  heldOut: HeldOutInventory | null,
  currentProblems: readonly string[],
  revisions: readonly DxRevision[] = DX_REVISIONS
): DxEvaluation {
  const current = revisions[revisions.length - 1];
  const heldOutSha = heldOut?.corpusSha256 ?? null;
  const withInputs = captures.filter((c) => c.inputs !== undefined);
  const earlier = withInputs.flatMap((c) => {
    const rev = earlierRevisionOf(c, heldOutSha, revisions);
    return rev ? [{ captureId: c.captureId, revision: rev.revision }] : [];
  });
  const ofCurrent = withInputs.filter((c) => !earlier.some((e) => e.captureId === c.captureId));
  const voided = ofCurrent.map((c) => ({ captureId: c.captureId, problems: captureInputProblems(c, heldOutSha, current) })).filter((v) => v.problems.length > 0);
  const fresh = ofCurrent.filter((c) => captureInputProblems(c, heldOutSha, current).length === 0).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const readings = new Map(fresh.flatMap((c) => c.items).map((i) => [i.id, dx3Reading(i)]));
  const readOf = (item: ReviewItem) => readings.get(item.id)!;
  /** Shown to the person: a readable text the gate let through, or a residual secret the product has no gate for. */
  const shownOf = (items: readonly ReviewItem[]) => items.filter((i) => !i.displayWithheld);
  const escapesOf = (items: readonly ReviewItem[]) => shownOf(items).filter((i) => readOf(i).defects.length > 0);

  const runs: DxRun[] = [];
  const incomplete: string[] = [];
  const completeOf: Record<DxRun["corpus"], number> = { labelled: 0, "held-out": 0 };
  const corpora: Array<[DxRun["corpus"], string[]]> = [
    ["labelled", LABELLED_SET.map((c) => c.id)],
    ["held-out", heldOut?.cases.map((c) => c.id) ?? []]
  ];
  for (const [corpus, ids] of corpora) {
    const measurements = new Map(ids.map((id) => [id, [] as Array<{ capture: ReviewCapture; measured: ReviewCaptureCase }>]));
    for (const capture of fresh) for (const measured of capture.cases) measurements.get(measured.caseId)?.push({ capture, measured });
    const counts = [...measurements.values()].map((m) => m.length);
    const complete = ids.length === 0 ? 0 : Math.min(...counts);
    completeOf[corpus] = complete;
    if (ids.length > 0 && Math.max(...counts) > complete) incomplete.push(`${corpus} run ${complete + 1} (${counts.filter((n) => n > complete).length} of ${ids.length} cases measured)`);
    for (let k = 0; k < complete; k += 1) {
      const inRun = [...measurements.values()].map((m) => m[k]);
      const items = inRun.flatMap(({ capture, measured }) => capture.items.filter((i) => i.caseId === measured.caseId));
      const sent = inRun.reduce((n, { measured }) => n + measured.sent, 0);
      const readable = items.filter((i) => i.text !== null);
      const shown = readable.filter((i) => !i.displayWithheld);
      const correct = readable.filter((i) => readOf(i).correct);
      runs.push({
        corpus,
        run: k + 1,
        sent,
        displayed: shown.length,
        gateWithheld: readable.length - shown.length,
        secretWithheld: items.length - readable.length,
        undelivered: sent - items.length,
        ownOnSubject: items.filter((i) => i.judged.onSubject).length,
        ownActionable: items.filter((i) => i.judged.actionable).length,
        escapes: escapesOf(items).length,
        falseWithholding: { withheldCorrect: correct.filter((i) => i.displayWithheld).length, correct: correct.length }
      });
    }
  }

  // Every fresh text counts, in a complete run or not: a part cannot be left out of the reading.
  const all = fresh.flatMap((c) => c.items);
  const readable = all.filter((i) => i.text !== null);
  const displayed = readable.filter((i) => !i.displayWithheld);
  const escaped = escapesOf(all);
  const good = displayed.filter((i) => readOf(i).correct && readOf(i).actionable);
  const unjudgeable = all.filter((i) => !readOf(i).judgeable);
  const defects: Partial<Record<Dx3Defect, number>> = {};
  for (const i of escaped) for (const d of readOf(i).defects) defects[d] = (defects[d] ?? 0) + 1;
  const { num: cn, den: cd } = DX_RULES.minCorrectAndActionable;
  const { num: wn, den: wd } = DX_RULES.maxNoDisplay;
  const overCap = runs.filter((r) => (r.sent - r.displayed) * wd > r.sent * wn);
  const dx2Met = heldOut !== null && completeOf.labelled >= DX_RULES.labelledRuns && completeOf["held-out"] >= DX_RULES.heldOutRuns && incomplete.length === 0;
  const perRun = (pick: (r: DxRun) => string) => runs.map((r) => `${r.corpus} run ${r.run} ${pick(r)}`).join("; ") || "no complete fresh run";

  const criteria: DxEvaluation["criteria"] = [
    {
      id: "DX-0",
      label: "frozen inputs: every fresh capture and the working tree on DX-0",
      status: voided.length > 0 || currentProblems.length > 0 ? "NOT MET" : "MET",
      // An earlier revision's captures are its own record: named here, never counted, never voiding this one.
      detail:
        ([
          voided.length > 0 ? `${voided.length} capture(s) on other inputs, so the fresh runs are void: ${voided.map((v) => `${v.captureId} (${v.problems.join(", ")})`).join("; ")}` : "",
          currentProblems.length > 0 ? `the working tree differs: ${currentProblems.join("; ")}` : ""
        ].filter(Boolean).join("; ") || `${fresh.length} fresh capture(s), all on revision ${current.revision}'s DX-0; the working tree matches`) +
        (earlier.length > 0 ? `; ${earlier.length} capture(s) of an earlier revision kept on the record, not counted` : "")
    },
    {
      id: "DX-2",
      label: `fresh evidence: at least ${DX_RULES.labelledRuns} complete labelled runs and ${DX_RULES.heldOutRuns} complete held-out run, none left incomplete`,
      status: dx2Met ? "MET" : "PENDING",
      detail: `${heldOut === null ? "the held-out set is not committed; " : ""}labelled ${completeOf.labelled} complete, held-out ${completeOf["held-out"]} complete${incomplete.length > 0 ? `; incomplete: ${incomplete.join(", ")}` : ""}`
    },
    {
      id: "DX-3",
      label: `the automated technical review reads every fresh text; 0 displayed with a defect, at least ${(cn / cd) * 100} % of displayed correct and actionable`,
      // An escape can never be undone. The 80 % is over every planned run's displayed texts, so it is judged only
      // once DX-2 holds. Automated by the owner's decision (2026-09-26): no person's reading is asked for.
      status: escaped.length > 0 ? "NOT MET" : !dx2Met ? "PENDING" : displayed.length === 0 || good.length * cd < displayed.length * cn ? "NOT MET" : "MET",
      detail: `automated: ${readable.length} fresh text(s) read (${displayed.length} displayed, ${readable.length - displayed.length} withheld); ${escaped.length} displayed with a defect${escaped.length > 0 ? ` (${Object.entries(defects).map(([d, n]) => `${d} ${n}`).join(", ")})` : ""}; ${good.length} of ${displayed.length} displayed correct and actionable; ${unjudgeable.length} text(s) the judge has no rule for`
    },
    {
      id: "DX-4",
      label: `in every complete fresh run, at most ${wn} issue in ${wd} without a displayed AI text`,
      status: overCap.length > 0 ? "NOT MET" : dx2Met ? "MET" : "PENDING",
      detail: `${perRun((r) => `${r.sent - r.displayed}/${r.sent} (gate ${r.gateWithheld}, secret ${r.secretWithheld}, undelivered ${r.undelivered})`)}; false-withholding ${perRun((r) => `${r.falseWithholding.withheldCorrect}/${r.falseWithholding.correct}`)}; escapes ${perRun((r) => String(r.escapes))}`
    },
    {
      id: "DX-5",
      label: "the raw result stays visible: the model's own rates before the gate, beside the adopted target (NOT MET)",
      status: runs.length > 0 ? "MET" : "PENDING",
      detail: `on subject ${perRun((r) => `${r.ownOnSubject}/${r.sent}`)}; actionable in its own text ${perRun((r) => `${r.ownActionable}/${r.sent}`)}`
    }
  ];
  const verdict: DxStatus = criteria.every((c) => c.status === "MET") ? "MET" : criteria.some((c) => c.status === "NOT MET") ? "NOT MET" : "PENDING";
  return {
    fresh: fresh.length,
    voided,
    earlier,
    runs,
    reading: { texts: readable.length, displayed: displayed.length, correctAndActionable: good.length, escapes: escaped.length, defects, unjudgeable: unjudgeable.length },
    criteria,
    verdict
  };
}

/** Every fresh text of the current revision with DX-3's reading of it, in item-id order: the review's own record. */
export function dxReadings(captures: readonly ReviewCapture[], heldOut: HeldOutInventory | null): Array<{ item: ReviewItem; reading: Dx3Reading }> {
  const heldOutSha = heldOut?.corpusSha256 ?? null;
  return captures
    .filter((c) => c.inputs !== undefined && captureInputProblems(c, heldOutSha).length === 0)
    .flatMap((c) => c.items)
    .sort((a, b) => byCodeUnits(a.id, b.id))
    .map((item) => ({ item, reading: dx3Reading(item) }));
}
