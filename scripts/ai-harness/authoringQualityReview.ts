/**
 * L4b's human review of the labelled set (owner decision 3, 2026-09-22) and the explanation quality
 * target it feeds (owner decision 1: L4's proposed target, adopted provisionally, thresholds unchanged).
 *
 * `verify:ai-authoring-quality-live` writes one capture per run part here; a person lists what awaits
 * review with `npm run verify:ai-authoring-review -- --pending` and records a verdict with `-- --record`;
 * `npm run verify:ai-authoring-review` evaluates the target over every capture of the CURRENT request.
 *
 * Privacy, by construction:
 *  - the store is local and outside the repository: `%LOCALAPPDATA%/SpecterStudio/ai-quality-review/
 *    authoring` (or `AWKIT_AI_REVIEW_DIR`). Nothing here sends it anywhere;
 *  - an item holds the product's own Issues line for that issue (codes, severity, anchor kind, rule
 *    summary: product constants) and the model's text AFTER `SemanticRedactor`, with the labelled set's
 *    canary as a sensitive term. A text that still shows a residual secret or the canary after that is
 *    not written at all;
 *  - no flow, step name, value, selector, prompt nonce or file path is stored. A reviewer's label and
 *    note are redacted the same way, and refused if a residual secret survives.
 *
 * Nothing here can count an unreviewed answer as correct: the target's criterion 4 is `PENDING` until
 * every screen-clear explanation has a person's verdict, and `PENDING` is never `MET`.
 *
 * Electron-free: the harness, the launcher, the review CLI and `verify:ai-authoring` all import it.
 */

import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AuthoringAnswer, AuthoringRequest } from "@src/ai/authoringExplanation";
import { findResidualSecrets } from "@src/semantic/SemanticPolicyValidator";
import { SemanticRedactor } from "@src/semantic/SemanticRedactor";
import { writeJsonFileAtomic } from "@src/session/atomicWrite";
import { isExecutionBlocking, type FlowValidationCode } from "@src/validation/FlowValidator";

import { CANARY, judgeAuthoringAnswer, type AuthoringJudgement, type ExplanationCategory, type UnsupportedKind } from "./authoringQualitySet";

/** L4's proposed explanation quality target, as adopted by the owner. Never lowered to fit a result. */
export const QUALITY_TARGET = Object.freeze({
  adopted: "2026-09-22, provisionally (owner decision 1); criterion 3 revised 2026-09-23 (option B)",
  /** (2) On subject by proxy, in every complete run. */
  minOnSubject: 0.9,
  /**
   * (3) A corrective action in the explanation a person sees, in every complete run (owner, 2026-09-23,
   * option B). The model's own rate is reported beside it and never credited with the product's action.
   */
  minActionable: 0.8,
  /** (4) Of the screen-clear explanations, judged correct and actionable by a person. */
  minReviewedCorrectAndActionable: 0.8,
  /** (6) Complete runs over the whole labelled set. */
  minRuns: 2
});

export interface ReviewItem {
  /** `<captureId>/<caseId>/<issueId>`: stable, and holds no user data. */
  id: string;
  caseId: string;
  issueId: string;
  code: FlowValidationCode;
  blocking: boolean;
  fixable: boolean;
  /** What the model was told about this issue: the product's own Issues line. */
  evidence: string;
  /** The product's corrective step shown beside the text (captures since 2026-09-23; absent before). */
  step?: string;
  /** The model's explanation after redaction; `null` when it was withheld. */
  text: string | null;
  withheld?: "RESIDUAL_SECRET";
  /**
   * The character limit cut the model's text and the product kept its complete sentences (captures since
   * this field; absent before). Without it, an action cut and trimmed away reads like one never written.
   */
  cut?: true;
  /** The proxy judge's reading, taken on the answer the product accepted. */
  judged: { onSubject: boolean; misattributed: boolean; actionable: boolean; unsupported: UnsupportedKind[]; category: ExplanationCategory };
}

export interface ReviewCaptureCase {
  caseId: string;
  /** Issues the request sent. An undelivered answer still counts them, so a failure cannot raise a rate. */
  sent: number;
  delivered: boolean;
  /** The fix order the product would show (empty when the model ranked nothing or it was withheld). */
  ranking: string[];
  rankingWithheld: boolean;
  rankingOrderCorrect: boolean | null;
  inferMs: number | null;
}

export interface ReviewCapture {
  version: 1;
  captureId: string;
  capturedAt: string;
  modelId: string;
  /** SHA-256 of the product's instructions: a capture of another request is not evidence for this one. */
  instructionsSha256: string;
  cases: ReviewCaptureCase[];
  items: ReviewItem[];
}

export interface ReviewVerdict {
  itemId: string;
  /** It says what is actually wrong with the flow. */
  correct: boolean;
  /** It names a step a person can take in the editor. */
  actionable: boolean;
  /** It rests only on what the request held. */
  grounded: boolean;
  /** It claims something the request does not support: an invented fix, cause, name, value or severity. */
  unsupportedClaim: boolean;
  reviewer: string;
  note?: string;
  reviewedAt: string;
}

export function reviewDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.AWKIT_AI_REVIEW_DIR) return env.AWKIT_AI_REVIEW_DIR;
  return path.join(env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "SpecterStudio", "ai-quality-review", "authoring");
}

export const instructionsSha256 = (request: AuthoringRequest): string => createHash("sha256").update(request.prompt.instructions).digest("hex");

const redactor = new SemanticRedactor({ customSensitiveTerms: [CANARY] });

/** Redact for persistence; `null` when something sensitive survives redaction, so nothing is written. */
export function redactForReview(text: string): string | null {
  const redacted = redactor.redactText(text);
  return findResidualSecrets(redacted).length > 0 || redacted.toUpperCase().includes(CANARY) ? null : redacted;
}

export interface CapturedCase {
  caseId: string;
  request: AuthoringRequest;
  /** `null` when no answer was accepted: refused, timed out or failed. */
  answer: AuthoringAnswer | null;
  judged: AuthoringJudgement | null;
  inferMs: number | null;
}

export function buildReviewCapture(modelId: string, cases: readonly CapturedCase[], now = new Date()): ReviewCapture {
  const captureId = `${now.toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;
  const items: ReviewItem[] = [];
  for (const { caseId, request, answer, judged } of cases) {
    if (!answer || !judged) continue;
    const lines = request.prompt.fields.flatMap((field) => ("text" in field && typeof field.text === "string" ? field.text.split("\n") : []));
    for (const explanation of answer.explanations) {
      const ref = request.issues.find((r) => r.id === explanation.issueId);
      const reading = judged.perExplanation.find((p) => p.issueId === explanation.issueId);
      if (!ref || !reading) continue;
      const text = redactForReview(explanation.text);
      items.push({
        id: `${captureId}/${caseId}/${ref.id}`,
        caseId,
        issueId: ref.id,
        code: ref.issue.code,
        blocking: isExecutionBlocking(ref.issue),
        fixable: ref.fixable,
        evidence: lines.find((line) => line.startsWith(`${ref.id}: `)) ?? "",
        step: explanation.step,
        text,
        ...(text === null ? { withheld: "RESIDUAL_SECRET" as const } : {}),
        ...(explanation.cut ? { cut: true as const } : {}),
        judged: { onSubject: reading.onSubject, misattributed: reading.misattributed, actionable: reading.actionable, unsupported: reading.unsupported, category: reading.category }
      });
    }
  }
  return {
    version: 1,
    captureId,
    capturedAt: now.toISOString(),
    modelId,
    instructionsSha256: instructionsSha256(cases[0].request),
    cases: cases.map(({ caseId, request, answer, judged, inferMs }) => ({
      caseId,
      sent: request.issues.length,
      delivered: answer !== null,
      ranking: answer?.ranking ?? [],
      rankingWithheld: judged?.rankingWithheld ?? false,
      rankingOrderCorrect: judged?.rankingOrderCorrect ?? null,
      inferMs
    })),
    items
  };
}

/** One explanation today's judge reads differently from the reading its capture was taken with. */
export interface Reread {
  itemId: string;
  code: FlowValidationCode;
  before: ReviewItem["judged"];
  after: ReviewItem["judged"];
}

/**
 * A capture read again by TODAY's judge, in memory: the file keeps the model's text and the reading it was
 * taken with, a person's verdicts are untouched, and nothing is written back. Each explanation is judged
 * against what its capture kept of the request: its case's Issues lines, and the instructions only when the
 * capture's hash is today's (an earlier request's are not retained). A case whose ids no longer carry the
 * same codes, blocking and fixes in today's labelled set keeps its captured reading.
 */
export function rereadCapture(
  capture: ReviewCapture,
  requestFor: (caseId: string) => AuthoringRequest | undefined
): { capture: ReviewCapture; changed: Reread[]; reread: number; instructionsRetained: boolean } {
  const items = capture.items.map((item) => ({ ...item }));
  const changed: Reread[] = [];
  let reread = 0;
  let instructionsRetained = false;
  for (const caseId of new Set(items.map((item) => item.caseId))) {
    const request = requestFor(caseId);
    const inCase = items.filter((item) => item.caseId === caseId);
    const refs = inCase.map((item) =>
      request?.issues.find((ref) => ref.id === item.issueId && ref.issue.code === item.code && ref.fixable === item.fixable && isExecutionBlocking(ref.issue) === item.blocking)
    );
    if (!request || refs.some((ref) => ref === undefined)) continue;
    instructionsRetained = instructionsSha256(request) === capture.instructionsSha256;
    const asked: AuthoringRequest = {
      ...request,
      prompt: { ...request.prompt, instructions: instructionsRetained ? request.prompt.instructions : "", fields: [{ name: "Issues", text: inCase.map((item) => item.evidence).join("\n") }] }
    };
    const shown = inCase.flatMap((item, k) => (item.text === null ? [] : [{ item, text: item.text, ref: refs[k]! }]));
    const answer: AuthoringAnswer = {
      ok: true,
      explanations: shown.map(({ item, text, ref }) => ({ issueId: item.issueId, issue: ref.issue, text, step: ref.step, ...(item.cut ? { cut: true as const } : {}) })),
      ranking: []
    };
    judgeAuthoringAnswer(asked, answer).perExplanation.forEach((p, k) => {
      const item = shown[k].item;
      const after = { onSubject: p.onSubject, misattributed: p.misattributed, actionable: p.actionable, unsupported: p.unsupported, category: p.category };
      reread += 1;
      if (JSON.stringify(after) === JSON.stringify(item.judged)) return;
      changed.push({ itemId: item.id, code: item.code, before: item.judged, after });
      item.judged = after;
    });
  }
  return { capture: { ...capture, items }, changed, reread, instructionsRetained };
}

export async function writeReviewCapture(dir: string, capture: ReviewCapture): Promise<string> {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `capture-${capture.captureId}.json`);
  await writeJsonFileAtomic(file, capture);
  return file;
}

const REVIEWS_FILE = "reviews.json";

export interface ReviewStore {
  captures: ReviewCapture[];
  verdicts: ReviewVerdict[];
  /** Files that could not be read as a capture or the verdict list. Reported, never silently skipped. */
  malformed: string[];
}

export function loadReviewStore(dir: string): ReviewStore {
  const store: ReviewStore = { captures: [], verdicts: [], malformed: [] };
  if (!fs.existsSync(dir)) return store;
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".json")) continue;
    try {
      const value = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      if (name === REVIEWS_FILE) {
        if (value?.version !== 1 || !Array.isArray(value.verdicts)) throw new Error("shape");
        store.verdicts = value.verdicts;
      } else if (name.startsWith("capture-")) {
        if (value?.version !== 1 || typeof value.instructionsSha256 !== "string" || !Array.isArray(value.cases) || !Array.isArray(value.items)) throw new Error("shape");
        store.captures.push(value);
      }
    } catch {
      store.malformed.push(name);
    }
  }
  return store;
}

/**
 * Reviewer labels that name no person: the CLI's documented placeholders, generic words and agents. Compared
 * lowercased with spaces and hyphens read as underscores. `YOUR_LABEL` reached the store before this guard.
 */
const NOT_A_REVIEWER = new Set([
  "your_label", "yourlabel", "label", "reviewer", "reviewer_label", "your_name", "name", "placeholder", "example", "test",
  "todo", "tbd", "xxx", "n/a", "none", "null", "undefined", "unknown", "anonymous",
  "agent", "ai", "assistant", "claude", "claude_code", "codex", "gemini"
]);

/**
 * A label a person chose for themselves: 1-40 characters, not a placeholder, not an agent, and not a template
 * slot such as `<label>`. A verdict under any other label is refused, and one already stored is kept for
 * audit but never counted toward the target.
 */
export function isGenuineReviewer(reviewer: unknown): boolean {
  if (typeof reviewer !== "string") return false;
  const label = reviewer.trim();
  return label.length > 0 && label.length <= 40 && !/^[<{[(].*[>}\])]$/.test(label) && !NOT_A_REVIEWER.has(label.toLowerCase().replace(/[\s-]+/g, "_"));
}

export type VerdictInput = Omit<ReviewVerdict, "reviewedAt">;

/**
 * Record (or replace) one person's verdict on one captured explanation. Refuses rather than stores anything
 * sensitive or anything under a label that names no person. A stored verdict under such a label is kept
 * beside the new one, for audit; only a person's own earlier verdict on the item is replaced.
 */
export async function recordVerdict(dir: string, input: VerdictInput, now = new Date()): Promise<{ ok: true } | { ok: false; reason: string }> {
  const store = loadReviewStore(dir);
  if (store.malformed.includes(REVIEWS_FILE)) return { ok: false, reason: `${REVIEWS_FILE} is malformed; fix or move it first` };
  if (!store.captures.some((c) => c.items.some((i) => i.id === input.itemId && i.text !== null))) return { ok: false, reason: `no reviewable captured explanation ${input.itemId}` };
  for (const key of ["correct", "actionable", "grounded", "unsupportedClaim"] as const) if (typeof input[key] !== "boolean") return { ok: false, reason: `${key} must be yes or no` };
  const reviewer = input.reviewer ? redactForReview(input.reviewer) : null;
  if (!reviewer || reviewer.length > 40) return { ok: false, reason: "a reviewer label of 1-40 characters with nothing sensitive in it is required" };
  if (!isGenuineReviewer(reviewer)) return { ok: false, reason: `"${reviewer}" is a placeholder or an agent, not a person's label; record the verdict under your own label` };
  const note = input.note === undefined ? undefined : redactForReview(input.note);
  if (input.note !== undefined && (note === null || (note ?? "").length > 400)) return { ok: false, reason: "the note must be at most 400 characters with nothing sensitive in it" };
  const verdict: ReviewVerdict = {
    itemId: input.itemId,
    correct: input.correct,
    actionable: input.actionable,
    grounded: input.grounded,
    unsupportedClaim: input.unsupportedClaim,
    reviewer,
    ...(note ? { note } : {}),
    reviewedAt: now.toISOString()
  };
  fs.mkdirSync(dir, { recursive: true });
  await writeJsonFileAtomic(path.join(dir, REVIEWS_FILE), { version: 1, verdicts: [...store.verdicts.filter((v) => v.itemId !== input.itemId || !isGenuineReviewer(v.reviewer)), verdict] });
  return { ok: true };
}

export type CriterionStatus = "MET" | "NOT MET" | "PENDING";

export interface TargetEvaluation {
  completeRuns: number;
  /**
   * `actionable` is the model's own text by proxy; `repeatsProductAction` of those repeat the product's action
   * word for word. `visibleActionable` is criterion 3: the explanation a person sees holds a corrective action.
   */
  runs: Array<{ run: number; sent: number; delivered: number; onSubject: number; misattributed: number; actionable: number; repeatsProductAction: number; visibleActionable: number; ranked: number; orderViolations: number; withheld: number }>;
  review: { screenClear: number; screenClearReviewed: number; screenClearCorrectAndActionable: number; screenHits: number; screenHitsReviewed: number; confirmedUnsupported: number };
  criteria: Array<{ id: number; label: string; status: CriterionStatus; detail: string }>;
  verdict: CriterionStatus;
}

/**
 * Criterion 3 (option B): the explanation a person sees holds a corrective action, either the product's,
 * shown beside every accepted answer (`step`, never model text), or the model's own. An answer with a screen
 * hit or a misattribution never counts, because it puts other guidance beside the product's. An undelivered
 * answer has no item, so its issues still count against the rate.
 */
const visibleCorrective = (i: ReviewItem) => !i.judged.misattributed && i.judged.unsupported.length === 0 && (!!i.step || i.judged.actionable);

/**
 * The target over captures of ONE request and model. Run `k` is each case's `k`-th measurement, in
 * capture order, so two parts make one run; a run counts only once every case has one.
 */
export function evaluateQualityTarget(captures: readonly ReviewCapture[], verdicts: readonly ReviewVerdict[], caseIds: readonly string[]): TargetEvaluation {
  const measurements = new Map(caseIds.map((id) => [id, [] as Array<{ capture: ReviewCapture; measured: ReviewCaptureCase }>]));
  for (const capture of [...captures].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))) {
    for (const measured of capture.cases) measurements.get(measured.caseId)?.push({ capture, measured });
  }
  const completeRuns = caseIds.length === 0 ? 0 : Math.min(...[...measurements.values()].map((m) => m.length));
  // Only a person's verdict counts: one under a placeholder or an agent's label is as good as none.
  const verdictOf = new Map(verdicts.filter((v) => isGenuineReviewer(v.reviewer)).map((v) => [v.itemId, v]));
  const runs: TargetEvaluation["runs"] = [];
  const counted: ReviewItem[] = [];
  for (let k = 0; k < completeRuns; k += 1) {
    const inRun = [...measurements.values()].map((m) => m[k]);
    const items = inRun.flatMap(({ capture, measured }) => capture.items.filter((item) => item.caseId === measured.caseId));
    counted.push(...items);
    const count = (pick: (item: ReviewItem) => boolean) => items.filter(pick).length;
    runs.push({
      run: k + 1,
      sent: inRun.reduce((n, { measured }) => n + measured.sent, 0),
      delivered: inRun.filter(({ measured }) => measured.delivered).length,
      onSubject: count((i) => i.judged.onSubject),
      misattributed: count((i) => i.judged.misattributed),
      actionable: count((i) => i.judged.actionable),
      repeatsProductAction: count((i) => i.judged.actionable && !!i.step && !!i.text?.includes(i.step)),
      visibleActionable: count(visibleCorrective),
      ranked: inRun.reduce((n, { measured }) => n + measured.ranking.length, 0),
      orderViolations: inRun.filter(({ measured }) => measured.rankingOrderCorrect === false).length,
      withheld: inRun.filter(({ measured }) => measured.rankingWithheld).length
    });
  }

  const screenHits = counted.filter((i) => i.judged.unsupported.length > 0);
  const screenClear = counted.filter((i) => i.judged.category === "unverified");
  const confirmed = counted.filter((i) => {
    const v = verdictOf.get(i.id);
    return v !== undefined && (v.unsupportedClaim || !v.grounded);
  });
  const clearReviewed = screenClear.filter((i) => verdictOf.has(i.id));
  const clearGood = clearReviewed.filter((i) => verdictOf.get(i.id)!.correct && verdictOf.get(i.id)!.actionable);
  const hitsReviewed = screenHits.filter((i) => verdictOf.has(i.id));
  const misattributed = runs.reduce((n, r) => n + r.misattributed, 0);
  const violations = runs.reduce((n, r) => n + r.orderViolations, 0);
  const ranked = runs.reduce((n, r) => n + r.ranked, 0);
  const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${Math.round((n / d) * 1000) / 10} %`);
  const everyRun = (pick: (r: TargetEvaluation["runs"][number]) => number, min: number) => runs.length > 0 && runs.every((r) => r.sent > 0 && pick(r) >= min * r.sent);
  const perRun = (pick: (r: TargetEvaluation["runs"][number]) => number) => runs.map((r) => `run ${r.run} ${pick(r)}/${r.sent}`).join(", ") || "no complete run";

  const criteria: TargetEvaluation["criteria"] = [
    {
      id: 1,
      label: "no confirmed unsupported claim, no misattributed explanation",
      // A person reading a screen-clear answer can still confirm a claim the screens missed, so this
      // cannot be MET while any answer the target sends to a person is unread.
      status:
        misattributed > 0 || confirmed.length > 0
          ? "NOT MET"
          : completeRuns === 0
            ? "NOT MET"
            : hitsReviewed.length < screenHits.length || clearReviewed.length < screenClear.length
              ? "PENDING"
              : "MET",
      detail: `${misattributed} misattributed, ${confirmed.length} confirmed by a person; awaiting a person: ${screenHits.length - hitsReviewed.length} of ${screenHits.length} screen hits, ${screenClear.length - clearReviewed.length} of ${screenClear.length} screen-clear`
    },
    {
      id: 2,
      label: `at least ${QUALITY_TARGET.minOnSubject * 100} % on subject by proxy, in every complete run`,
      status: everyRun((r) => r.onSubject, QUALITY_TARGET.minOnSubject) ? "MET" : "NOT MET",
      detail: perRun((r) => r.onSubject)
    },
    {
      id: 3,
      label: `at least ${QUALITY_TARGET.minActionable * 100} % of issues get a corrective action in the explanation a person sees, in every complete run`,
      status: everyRun((r) => r.visibleActionable, QUALITY_TARGET.minActionable) ? "MET" : "NOT MET",
      detail: `${perRun((r) => r.visibleActionable)}; the model's own text, reported and not credited: ${runs.map((r) => `run ${r.run} ${r.actionable}/${r.sent} (${r.repeatsProductAction} repeat the product's action word for word)`).join(", ") || "no complete run"}`
    },
    {
      id: 4,
      label: `a person reads every screen-clear explanation and judges at least ${QUALITY_TARGET.minReviewedCorrectAndActionable * 100} % correct and actionable`,
      status:
        screenClear.length === 0 || clearGood.length + (screenClear.length - clearReviewed.length) < QUALITY_TARGET.minReviewedCorrectAndActionable * screenClear.length
          ? "NOT MET"
          : clearReviewed.length < screenClear.length
            ? "PENDING"
            : "MET",
      detail: `${screenClear.length} screen-clear, ${clearReviewed.length} reviewed, ${clearGood.length} judged correct and actionable (${pct(clearGood.length, screenClear.length)})`
    },
    {
      id: 5,
      label: "when the model ranks, no order violation (an empty fix order is acceptable: owner decision 4)",
      status: violations > 0 ? "NOT MET" : completeRuns === 0 ? "NOT MET" : "MET",
      detail: `${ranked} fix(es) ranked, ${violations} order violation(s), ${runs.reduce((n, r) => n + r.withheld, 0)} order(s) withheld by the product`
    },
    {
      id: 6,
      label: `measured on at least ${QUALITY_TARGET.minRuns} complete runs`,
      status: completeRuns >= QUALITY_TARGET.minRuns ? "MET" : "NOT MET",
      detail: `${completeRuns} complete run(s)`
    }
  ];
  const verdict: CriterionStatus = criteria.every((c) => c.status === "MET") ? "MET" : criteria.some((c) => c.status === "NOT MET") ? "NOT MET" : "PENDING";
  return {
    completeRuns,
    runs,
    review: {
      screenClear: screenClear.length,
      screenClearReviewed: clearReviewed.length,
      screenClearCorrectAndActionable: clearGood.length,
      screenHits: screenHits.length,
      screenHitsReviewed: hitsReviewed.length,
      confirmedUnsupported: confirmed.length
    },
    criteria,
    verdict
  };
}
