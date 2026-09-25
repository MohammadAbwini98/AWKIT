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
 *  - DX-3: a person reads every fresh text, displayed and withheld, under their own label. No displayed text
 *    with a confirmed unsupported claim or misattribution, and at least 80 % of displayed texts correct and
 *    actionable. A withheld text is read to measure the gate and never credited.
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

import { buildAuthoringRequest } from "@src/ai/authoringExplanation";
import { AI_ASSIST_MAX_NODES, sanitizeAuthoringAssistRequest } from "@src/ai/contracts/AiApi";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import { findResidualSecrets } from "@src/semantic/SemanticPolicyValidator";
import { isExecutionBlocking, validateFlowDefinition } from "@src/validation/FlowValidator";

import { isGenuineReviewer, type CaptureInputs, type ReviewCapture, type ReviewCaptureCase, type ReviewItem, type ReviewVerdict } from "./authoringQualityReview";
import { CANARY, LABELLED_SET, type LabelledCase } from "./authoringQualitySet";

/** DX-0, frozen at the commit that records the owner's decision (§0). Never edited to fit a run. */
export const DX0 = Object.freeze({
  commit: "335a0a7c",
  modelId: "Qwen3.5-0.8B-unpinned",
  modelSha256: "f5b14da98939b60bbe1019a964eba656407e1e0b64f1fe3003ff6d650e93bfec",
  runtimeBuild: "node-llama-cpp@3.21.1+llama.cpp@v0.4.0",
  instructionsSha256: "ab4b891fa050b9c0fbc85f6c04c93ff9b8effdc77167cbafbef0f7d35a9a3fa5",
  /** `git ls-files -s` blob ids: the runtime pin, and the three files the R4 mutation run covers. */
  blobs: Object.freeze({
    "src/offline/AiModelManifest.ts": "a6f2472e72b589fb37aa1ba543d588830972d1b2",
    "src/ai/authoringClaimScreen.ts": "3c3204fa350cb922e7b092705ede63f12ddf42a3",
    "src/ai/authoringExplanation.ts": "c4376cccfb79106bc5a88a577d4bf32364612c56",
    "app/main/ai/aiAssist.ts": "74180291114b7eecc9718b8d2761f4dc90665e2b"
  } as Record<string, string>)
});

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

const blobsMatch = (blobs: Readonly<Record<string, string>> | undefined) => blobs !== undefined && Object.entries(DX0.blobs).every(([p, id]) => blobs[p] === id);

/** Why a capture is not DX-0 evidence for the committed held-out corpus `heldOutSha256` (empty when it is). */
export function captureInputProblems(capture: ReviewCapture, heldOutSha256: string | null): string[] {
  const inputs: CaptureInputs | undefined = capture.inputs;
  if (!inputs) return ["taken before DX: no inputs recorded"];
  const problems: string[] = [];
  if (capture.modelId !== DX0.modelId || inputs.modelSha256 !== DX0.modelSha256) problems.push("model");
  if (inputs.runtimeBuild !== DX0.runtimeBuild) problems.push("runtime");
  if (!blobsMatch(inputs.blobs)) problems.push("source blobs");
  if (capture.instructionsSha256 !== DX0.instructionsSha256) problems.push("request");
  if (heldOutSha256 === null || inputs.heldOutSha256 !== heldOutSha256) problems.push("held-out corpus");
  return problems;
}

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
  /** Displayed texts a person found unsupported or misattributed; `null` while one is unread. */
  escapes: number | null;
  /** Withheld texts a person found correct, over all texts found correct; `null` while one is unread. */
  falseWithholding: { withheldCorrect: number; correct: number } | null;
}

export interface DxEvaluation {
  /** Captures that are DX evidence, and those taken on other inputs (which void it). */
  fresh: number;
  voided: Array<{ captureId: string; problems: string[] }>;
  runs: DxRun[];
  reading: { texts: number; read: number; displayed: number; displayedRead: number; correctAndActionable: number; confirmedUnsupported: number };
  criteria: Array<{ id: string; label: string; status: DxStatus; detail: string }>;
  verdict: DxStatus;
}

/** A DX verdict: a person's label and every field, `misattributed` included. */
const dxVerdictOf = (verdicts: readonly ReviewVerdict[]) => {
  const byItem = new Map(verdicts.filter((v) => isGenuineReviewer(v.reviewer) && typeof v.misattributed === "boolean").map((v) => [v.itemId, v]));
  return (item: ReviewItem) => byItem.get(item.id);
};
/** DX-3's zero-tolerance reading: an unsupported claim, a claim not grounded in the request, a misattribution. */
const failsDx3 = (v: ReviewVerdict) => v.unsupportedClaim || !v.grounded || v.misattributed === true;

/**
 * DX-0 and DX-2 to DX-5 over the captures (read with today's judge and gate) and the verdicts. `heldOut` is the
 * COMMITTED inventory, or `null` when there is none; `currentProblems` is `currentDx0Problems` for the tree.
 */
export function evaluateDx(
  captures: readonly ReviewCapture[],
  verdicts: readonly ReviewVerdict[],
  heldOut: HeldOutInventory | null,
  currentProblems: readonly string[]
): DxEvaluation {
  const heldOutSha = heldOut?.corpusSha256 ?? null;
  const withInputs = captures.filter((c) => c.inputs !== undefined);
  const voided = withInputs.map((c) => ({ captureId: c.captureId, problems: captureInputProblems(c, heldOutSha) })).filter((v) => v.problems.length > 0);
  const fresh = withInputs.filter((c) => captureInputProblems(c, heldOutSha).length === 0).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const verdictOf = dxVerdictOf(verdicts);

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
      const allRead = readable.every((i) => verdictOf(i) !== undefined);
      const correct = readable.filter((i) => verdictOf(i)?.correct === true && !failsDx3(verdictOf(i)!));
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
        escapes: allRead ? shown.filter((i) => failsDx3(verdictOf(i)!)).length : null,
        falseWithholding: allRead ? { withheldCorrect: correct.filter((i) => i.displayWithheld).length, correct: correct.length } : null
      });
    }
  }

  // Every fresh text counts, in a complete run or not: a part cannot be left out of the reading.
  const readable = fresh.flatMap((c) => c.items).filter((i) => i.text !== null);
  const displayed = readable.filter((i) => !i.displayWithheld);
  const confirmed = displayed.filter((i) => verdictOf(i) !== undefined && failsDx3(verdictOf(i)!));
  const good = displayed.filter((i) => verdictOf(i)?.correct === true && verdictOf(i)?.actionable === true);
  const unreadDisplayed = displayed.filter((i) => verdictOf(i) === undefined);
  const unread = readable.filter((i) => verdictOf(i) === undefined);
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
      detail:
        [
          voided.length > 0 ? `${voided.length} capture(s) on other inputs, so the fresh runs are void: ${voided.map((v) => `${v.captureId} (${v.problems.join(", ")})`).join("; ")}` : "",
          currentProblems.length > 0 ? `the working tree differs: ${currentProblems.join("; ")}` : ""
        ].filter(Boolean).join("; ") || `${fresh.length} fresh capture(s), all on DX-0; the working tree matches`
    },
    {
      id: "DX-2",
      label: `fresh evidence: at least ${DX_RULES.labelledRuns} complete labelled runs and ${DX_RULES.heldOutRuns} complete held-out run, none left incomplete`,
      status: dx2Met ? "MET" : "PENDING",
      detail: `${heldOut === null ? "the held-out set is not committed; " : ""}labelled ${completeOf.labelled} complete, held-out ${completeOf["held-out"]} complete${incomplete.length > 0 ? `; incomplete: ${incomplete.join(", ")}` : ""}`
    },
    {
      id: "DX-3",
      label: `a person reads every fresh text; 0 displayed with a confirmed unsupported claim or misattribution, at least ${(cn / cd) * 100} % of displayed correct and actionable`,
      // A confirmed escape can never be undone. The 80 % is over every planned run's displayed texts, so it is
      // judged only once DX-2 holds, and unread texts count only for what they could still make it.
      status:
        confirmed.length > 0
          ? "NOT MET"
          : !dx2Met
            ? "PENDING"
            : displayed.length === 0 || (good.length + unreadDisplayed.length) * cd < displayed.length * cn
              ? "NOT MET"
              : unread.length > 0
                ? "PENDING"
                : "MET",
      detail: `${readable.length - unread.length} of ${readable.length} fresh text(s) read (${displayed.length} displayed, ${readable.length - displayed.length} withheld); ${confirmed.length} displayed confirmed unsupported or misattributed; ${good.length} of ${displayed.length} displayed correct and actionable`
    },
    {
      id: "DX-4",
      label: `in every complete fresh run, at most ${wn} issue in ${wd} without a displayed AI text`,
      status: overCap.length > 0 ? "NOT MET" : dx2Met ? "MET" : "PENDING",
      detail: `${perRun((r) => `${r.sent - r.displayed}/${r.sent} (gate ${r.gateWithheld}, secret ${r.secretWithheld}, undelivered ${r.undelivered})`)}; false-withholding ${perRun((r) => (r.falseWithholding ? `${r.falseWithholding.withheldCorrect}/${r.falseWithholding.correct}` : "unread"))}; escapes ${perRun((r) => (r.escapes === null ? "unread" : String(r.escapes)))}`
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
    runs,
    reading: { texts: readable.length, read: readable.length - unread.length, displayed: displayed.length, displayedRead: displayed.length - unreadDisplayed.length, correctAndActionable: good.length, confirmedUnsupported: confirmed.length },
    criteria,
    verdict
  };
}

/** Every fresh text still awaiting a person's DX reading, in item-id order, so the list says nothing about the gate. */
export function dxPending(captures: readonly ReviewCapture[], verdicts: readonly ReviewVerdict[], heldOut: HeldOutInventory | null): ReviewItem[] {
  const verdictOf = dxVerdictOf(verdicts);
  const heldOutSha = heldOut?.corpusSha256 ?? null;
  return captures
    .filter((c) => c.inputs !== undefined && captureInputProblems(c, heldOutSha).length === 0)
    .flatMap((c) => c.items)
    .filter((i) => i.text !== null && verdictOf(i) === undefined)
    .sort((a, b) => byCodeUnits(a.id, b.id));
}
