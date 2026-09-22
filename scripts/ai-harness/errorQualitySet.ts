/**
 * The labelled set behind `verify:ai-error-quality-live` (Phase L, L5b), and the judge it applies.
 *
 * L5's own list, realised as run reports built the way `failureAnalysisPacket.ts` builds them, through
 * L5a's real `EvidenceBuffer` and `deriveFailureCause`: a transient toast before a timeout, native
 * validation, a 409 with a message and a 422 with field validation (one batch, two signatures), a 500 with
 * an error page over 500 identical rows, a transport failure beside an unrelated console error and an
 * unrelated warning, a page error before a timeout, a duplicate burst, a pass with a warning, and
 * insufficient evidence. Three cases beyond L5's list (`ANCHORING_ITEMS`, 2026-09-22): a second baseline
 * that takes an unrelated earlier event; the reverse, an unrelated error just after the real cause, where
 * the baseline is right; and a timeout beside only an unrelated console error, where the right answer is
 * to decline.
 *
 * Every event that explains its failure is labelled `cause` and every one that does not is labelled
 * `unrelated`, by the scenario's construction, never by what a model said. That is what lets the gate
 * compute L5's metrics: baseline accuracy (does the deterministic cause rest on a cause event), AI
 * accuracy (does the conclusion's primary evidence include a cause event and no unrelated one), the AI's
 * improvement over the baseline, false attribution, evidence-link accuracy, coalescing and calls per
 * batch, and privacy. ROADMAP rule 7 lets AI run automatically only where it beats the baseline on this
 * set; the gate records whether it did, and judges only the product's contract.
 *
 * `CANARY` rides only where L5a and the prompt builder promise to strip it: a URL's userinfo, query and
 * identifier segment, and a bearer token in page text.
 *
 * Electron-free: `verify:ai-error-analysis` audits the set and runs the judge's controls without a model.
 */

import { failureBatch } from "@main/ai/aiAssist";
import {
  buildFailureAnalysisRequest,
  coalesceFailures,
  failureSignature,
  parseFailureAnalysis,
  redactFailureAnalysis,
  type FailureAnalysis,
  type FailureAnalysisRequest
} from "@src/ai/failureAnalysis";
import type { ConcurrentRunReport } from "@src/reports/ExecutionReport";
import { EvidenceBuffer, EvidenceRunBudget } from "@src/runner/evidence/ExecutionEvidence";
import { deriveFailureCause, type FailureCauseCode, type RunnerFailureKind } from "@src/runner/evidence/FailureCauseBaseline";
import { INSTANCE_DIAGNOSTICS_SCHEMA_VERSION, type InstanceDiagnostics } from "@src/runner/evidence/FailureEvidenceCollector";
import { SemanticRedactor } from "@src/semantic/SemanticRedactor";

import type { FixtureEvent } from "./failureAnalysisPacket";

/** Planted where the product promises to strip it. */
export const CANARY = "QX7CANARY";
/** A route carrying the canary in its userinfo, an identifier segment and its query: L5a keeps only the template. */
const route = (path: string) => `https://${CANARY.toLowerCase()}:pw@shop.example${path}?token=${CANARY}-9f2`;

export type LabelledEvent = FixtureEvent & { tag?: "cause" | "unrelated" };
export interface LabelledRow {
  events: LabelledEvent[];
  kind: RunnerFailureKind;
  status?: "failed" | "passed";
}

export interface ErrorCase {
  id: string;
  /** Which items of L5's labelled set it realises. */
  covers: string[];
  rows: LabelledRow[];
  /** Rows the gate asks about, by index. Each is one explicit request, as the drawer makes it. */
  ask: number[];
  /** L5a's deterministic cause for the asked rows, or `null` for a pass (no cause is derived). */
  baselineCause: FailureCauseCode | null;
  /** Whether each asked row costs a model call. */
  expectsCall: boolean;
  /** The coalescing plan for the whole report. */
  batch: { failures: number; signatures: number; analyses: number };
}

const runner = (atMs: number, kind: RunnerFailureKind, message: string): LabelledEvent => ({ atMs, source: "runner.failure", severity: "error", payload: { kind, message } });

const conflict = (status: 409 | 422): LabelledRow => ({
  kind: "assertion",
  events: [
    { atMs: 600, source: "http.error", severity: "error", payload: { method: "POST", url: route(`/api/orders/${CANARY}4417/save`), status, resourceType: "fetch" }, tag: "cause" },
    status === 409
      ? { atMs: 700, source: "ui.alert", severity: "error", payload: { text: "This order was changed by someone else. Reload it before saving." }, tag: "cause" }
      : { atMs: 650, source: "ui.fieldInvalid", severity: "warning", payload: { field: "postcode", label: "Postcode", reason: "patternMismatch" }, tag: "cause" },
    runner(1_200, "assertion", "The saved banner did not appear.")
  ]
});

const serverError = (row: number): LabelledRow => ({
  kind: "assertion",
  events: [
    { atMs: 800, source: "http.error", severity: "error", payload: { method: "POST", url: route(`/api/orders/${40_001 + row}/confirm`), status: 500, resourceType: "xhr" }, tag: "cause" },
    { atMs: 900, source: "page.errorDocument", severity: "error", payload: { status: 500, title: "Server error", heading: "Something went wrong on our side" }, tag: "cause" },
    runner(1_300, "assertion", "The order summary heading was not visible.")
  ]
});

export const ERROR_SET: readonly ErrorCase[] = Object.freeze([
  {
    id: "toast-timeout",
    covers: ["transient toast before timeout"],
    rows: [
      {
        kind: "timeout",
        events: [
          { atMs: 1_000, source: "ui.toast", severity: "error", payload: { text: "Payment declined: the card issuer refused the charge." }, tag: "cause" },
          runner(31_000, "timeout", "Timed out after 30000 ms waiting for the order confirmation to be visible.")
        ]
      }
    ],
    ask: [0],
    baselineCause: "uiErrorMessage",
    expectsCall: true,
    batch: { failures: 1, signatures: 1, analyses: 1 }
  },
  {
    id: "native-validation",
    covers: ["native validation"],
    rows: [
      {
        kind: "timeout",
        events: [
          { atMs: 400, source: "ui.fieldInvalid", severity: "warning", payload: { field: "email", label: "Email", reason: "valueMissing" }, tag: "cause" },
          runner(30_400, "timeout", "Timed out after 30000 ms waiting for the submission confirmation.")
        ]
      }
    ],
    ask: [0],
    baselineCause: "uiValidation",
    expectsCall: true,
    batch: { failures: 1, signatures: 1, analyses: 1 }
  },
  {
    id: "conflict-and-validation",
    covers: ["409 + message", "422 + field validation", "multiple signatures in one batch"],
    rows: [conflict(409), conflict(422)],
    ask: [0, 1],
    baselineCause: "httpError",
    expectsCall: true,
    batch: { failures: 2, signatures: 2, analyses: 2 }
  },
  {
    id: "server-error-rows",
    covers: ["500 + error page", "500 identical failing rows"],
    rows: Array.from({ length: 500 }, (_, row) => serverError(row)),
    ask: [0],
    baselineCause: "httpError",
    expectsCall: true,
    batch: { failures: 500, signatures: 1, analyses: 1 }
  },
  {
    id: "transport-noise",
    covers: ["transport failure", "unrelated console error", "unrelated warning"],
    rows: [
      {
        kind: "assertion",
        events: [
          { atMs: 200, source: "console.error", severity: "error", payload: { text: `Analytics beacon rejected: Authorization Bearer ${CANARY}token7731 has expired.` }, tag: "unrelated" },
          { atMs: 300, source: "ui.status", severity: "info", payload: { text: "Tip: you can reorder items by dragging them." }, tag: "unrelated" },
          {
            atMs: 400,
            source: "network.failed",
            severity: "warning",
            payload: { method: "GET", url: "https://metrics.shop.example/pixel.gif", failure: "net::ERR_BLOCKED_BY_CLIENT", resourceType: "image" },
            tag: "unrelated"
          },
          {
            atMs: 1_500,
            source: "network.failed",
            severity: "error",
            payload: { method: "POST", url: route(`/api/orders/${CANARY}4417/submit`), failure: "net::ERR_CONNECTION_RESET", resourceType: "fetch" },
            tag: "cause"
          },
          runner(2_000, "assertion", "The order confirmation did not appear.")
        ]
      }
    ],
    ask: [0],
    // The baseline takes the earliest direct event, the blocked analytics pixel: wrong by construction.
    baselineCause: "transportFailure",
    expectsCall: true,
    batch: { failures: 1, signatures: 1, analyses: 1 }
  },
  {
    id: "pageerror-timeout",
    covers: ["pageerror before timeout"],
    rows: [
      {
        kind: "timeout",
        events: [
          { atMs: 700, source: "page.error", severity: "error", payload: { name: "TypeError", message: "Cannot read properties of undefined (reading 'total') at renderSummary" }, tag: "cause" },
          runner(30_700, "timeout", "Timed out after 30000 ms waiting for the order total to be visible.")
        ]
      }
    ],
    ask: [0],
    baselineCause: "scriptError",
    expectsCall: true,
    batch: { failures: 1, signatures: 1, analyses: 1 }
  },
  {
    id: "burst",
    covers: ["duplicate burst"],
    rows: [
      {
        kind: "assertion",
        events: [
          ...[500, 501, 502].map((atMs): LabelledEvent => ({ atMs, source: "ui.toast", severity: "error", payload: { text: "Could not save the draft." }, tag: "cause" })),
          { atMs: 503, source: "ui.alert", severity: "error", payload: { text: "Saving is temporarily unavailable. Try again in a few minutes." }, tag: "cause" },
          runner(1_100, "assertion", "The draft saved banner did not appear.")
        ]
      }
    ],
    ask: [0],
    baselineCause: "uiErrorMessage",
    expectsCall: true,
    batch: { failures: 1, signatures: 1, analyses: 1 }
  },
  {
    id: "pass-with-warning",
    covers: ["pass with warning"],
    rows: [
      {
        kind: "other",
        status: "passed",
        events: [
          { atMs: 300, source: "ui.status", severity: "info", payload: { text: "Some prices are shown in your local currency." } },
          { atMs: 400, source: "console.error", severity: "error", payload: { text: "The chat widget used a deprecated API." } }
        ]
      }
    ],
    ask: [0],
    baselineCause: null,
    expectsCall: false,
    batch: { failures: 0, signatures: 0, analyses: 0 }
  },
  {
    id: "insufficient",
    covers: ["insufficient evidence"],
    rows: [{ kind: "other", events: [] }],
    ask: [0],
    baselineCause: "insufficient",
    expectsCall: false,
    batch: { failures: 1, signatures: 1, analyses: 0 }
  },
  // Added for baseline anchoring (2026-09-22), after the prompt change was designed, so not tuned on:
  // a second failure whose baseline takes an unrelated earlier event, of a different shape.
  {
    id: "unrelated-server-error-first",
    covers: ["an unrelated earlier server error the baseline takes"],
    rows: [
      {
        kind: "assertion",
        events: [
          { atMs: 300, source: "http.error", severity: "error", payload: { method: "GET", url: route("/api/recommendations"), status: 503, resourceType: "fetch" }, tag: "unrelated" },
          {
            atMs: 1_400,
            source: "page.error",
            severity: "error",
            payload: { name: "TypeError", message: "Cannot read properties of null (reading 'addEventListener') at bindSaveAddressButton" },
            tag: "cause"
          },
          runner(1_900, "assertion", "The address saved banner did not appear.")
        ]
      }
    ],
    ask: [0],
    // The baseline takes the earliest direct event, the recommendations 503: wrong by construction.
    baselineCause: "httpError",
    expectsCall: true,
    batch: { failures: 1, signatures: 1, analyses: 1 }
  },
  // The reverse trap, added with the newest-first order so that order cannot win by position alone: the
  // real cause comes first and an unrelated error lands just before the failure. The baseline is right.
  {
    id: "cause-then-unrelated-console",
    covers: ["an unrelated console error after the real cause"],
    rows: [
      {
        kind: "assertion",
        events: [
          { atMs: 600, source: "http.error", severity: "error", payload: { method: "POST", url: route(`/api/payments/${CANARY}7730/authorize`), status: 502, resourceType: "fetch" }, tag: "cause" },
          { atMs: 700, source: "ui.alert", severity: "error", payload: { text: "We could not take your payment. You have not been charged." }, tag: "cause" },
          { atMs: 1_600, source: "console.error", severity: "error", payload: { text: "Analytics beacon rejected: the tracking endpoint answered 403." }, tag: "unrelated" },
          runner(1_900, "assertion", "The order confirmation did not appear.")
        ]
      }
    ],
    ask: [0],
    baselineCause: "httpError",
    expectsCall: true,
    batch: { failures: 1, signatures: 1, analyses: 1 }
  },
  // The tier where the model decides: nothing but an unrelated console error beside the runner's timeout.
  // Declining is the right answer; concluding on the console error is a false attribution.
  {
    id: "timeout-unrelated-console",
    covers: ["a timeout beside only an unrelated console error"],
    rows: [
      {
        kind: "timeout",
        events: [
          { atMs: 500, source: "console.error", severity: "error", payload: { text: "Failed to load resource: the server responded with a status of 404 (favicon.ico)" }, tag: "unrelated" },
          runner(30_500, "timeout", "Timed out after 30000 ms waiting for the invoice download link to be visible.")
        ]
      }
    ],
    ask: [0],
    baselineCause: "timeout",
    expectsCall: true,
    batch: { failures: 1, signatures: 1, analyses: 1 }
  }
]);

/** Cases beyond L5's list, added for baseline anchoring (2026-09-22). The rows of 4f81424a are the other nine cases. */
export const ANCHORING_ITEMS = Object.freeze([
  "an unrelated earlier server error the baseline takes",
  "an unrelated console error after the real cause",
  "a timeout beside only an unrelated console error"
]);

/** L5's list, so the set can be checked to realise every item. */
export const L5_LABELLED_ITEMS = Object.freeze([
  "transient toast before timeout",
  "native validation",
  "409 + message",
  "422 + field validation",
  "500 + error page",
  "transport failure",
  "pageerror before timeout",
  "unrelated console error",
  "duplicate burst",
  "unrelated warning",
  "pass with warning",
  "insufficient evidence",
  "500 identical failing rows",
  "multiple signatures in one batch"
]);

export interface RowLabels {
  cause: string[];
  unrelated: string[];
}

/**
 * The stored run report `failedRun` builds, with any number of instances, and each instance's labels as
 * evidence ids. A repeated event folds into its first occurrence, so its label lands on that one id.
 */
export function buildCase(c: ErrorCase): { report: ConcurrentRunReport & { id: string }; labels: Map<string, RowLabels> } {
  const executionId = `exec-quality-${c.id}`;
  const started = Date.parse("2026-09-21T09:00:00.000Z");
  const budget = new EvidenceRunBudget();
  const labels = new Map<string, RowLabels>();
  let longest = 0;
  const instances = c.rows.map((row, index) => {
    const instanceId = `${executionId}-row${index + 1}`;
    let clock = 0;
    const buffer = new EvidenceBuffer({ executionId, instanceId }, budget, { redactor: new SemanticRedactor(), now: () => clock });
    const context = { flowId: "flow-checkout", nodeId: "n-confirm", stepIndex: 6 };
    const cause = new Set<string>();
    const unrelated = new Set<string>();
    for (const { atMs, tag, ...event } of row.events) {
      clock = atMs;
      const stored = buffer.add({ ...event, context });
      if (stored && tag === "cause") cause.add(stored.id);
      if (stored && tag === "unrelated") unrelated.add(stored.id);
    }
    labels.set(instanceId, { cause: [...cause], unrelated: [...unrelated] });
    const evidence = [...buffer.list()];
    const failedAt = row.events.length ? row.events[row.events.length - 1].atMs : 0;
    longest = Math.max(longest, failedAt);
    const status = row.status ?? "failed";
    const runnerEvent = evidence.find((event) => event.source === "runner.failure");
    const diagnostics: InstanceDiagnostics = {
      schemaVersion: INSTANCE_DIAGNOSTICS_SCHEMA_VERSION,
      evidence,
      summary: buffer.summary(),
      ...(status === "failed"
        ? { cause: deriveFailureCause(evidence, { kind: row.kind, stepStartOffsetMs: row.events[0]?.atMs ?? 0, failedAtOffsetMs: failedAt, ...(runnerEvent ? { evidenceId: runnerEvent.id } : {}) }) }
        : {})
    };
    return { instanceId, status, durationMs: failedAt, ...(status === "failed" ? { error: "The step failed." } : {}), screenshots: [], downloadedFiles: [], diagnostics };
  });
  const failed = instances.filter((instance) => instance.status === "failed").length;
  const report = {
    id: executionId,
    executionId,
    scenarioId: "wf-checkout",
    scenarioName: "Checkout",
    runMode: "dataDrivenConcurrent",
    maxConcurrentInstances: 1,
    status: failed > 0 ? "failed" : "passed",
    startedAt: new Date(started).toISOString(),
    endedAt: new Date(started + longest).toISOString(),
    durationMs: longest,
    passedFlows: instances.length - failed,
    failedFlows: failed,
    skippedFlows: 0,
    instances,
    runtimeInputs: {}
  } as unknown as ConcurrentRunReport & { id: string };
  return { report, labels };
}

/** The request `analyzeFailure` builds for one named instance: its own evidence, its group's count. */
export function requestFor(report: ConcurrentRunReport, instanceId: string): FailureAnalysisRequest | undefined {
  const batch = failureBatch(report);
  const entry = batch.find((candidate) => candidate.instanceId === instanceId);
  if (!entry) return undefined;
  const signature = failureSignature(entry);
  const group = coalesceFailures(batch).groups.find((candidate) => candidate.signature === signature);
  return buildFailureAnalysisRequest({
    signature,
    instanceIds: group?.instanceIds ?? [entry.instanceId],
    count: group?.count ?? 1,
    representative: entry,
    analyse: entry.baseline.cause !== "insufficient" && entry.baseline.evidenceIds.length > 0
  });
}

/** Whether an offered id's WHOLE line reached the prompt. A prefix is not a line. */
function shownWhole(request: FailureAnalysisRequest, promptUser: string, id: string): boolean {
  const lines = request.prompt.fields.flatMap((field) => field.text?.split("\n") ?? []);
  return lines.some((line) => line.startsWith(`${id}: `) && promptUser.includes(`\n${line}`));
}

export interface FailureJudgement {
  /** The deterministic cause rests first on a cause event; where there is none, not on an unrelated one. */
  baselineCorrect: boolean;
  concluded: boolean;
  /** Concluded, with a cause event among the primary evidence and no unrelated one; where there is no cause event, declined. */
  aiCorrect: boolean;
  /** Concluded, with an unrelated event as primary evidence, or no cause event there at all. */
  falseAttribution: boolean;
  /** The label of each primary id, in the answer's order, and of the one the baseline rests on first. */
  primaryLabels: Array<"cause" | "unrelated" | "other">;
  baselineLeadLabel: "cause" | "unrelated" | "other";
  /** Concluded, citing the event the baseline rests on first as primary: where the baseline is wrong, the echo. */
  citesBaselineLead: boolean;
  cited: number;
  citedShownWhole: number;
}

export function judgeFailureAnswer(request: FailureAnalysisRequest, answer: FailureAnalysis, labels: RowLabels, promptUser: string): FailureJudgement {
  const cause = new Set(labels.cause);
  const unrelated = new Set(labels.unrelated);
  const primary = answer.primaryEvidenceIds;
  const cited = [...primary, ...answer.secondaryEvidenceIds];
  const concluded = !answer.insufficient;
  const falseAttribution = concluded && (primary.some((id) => unrelated.has(id)) || !primary.some((id) => cause.has(id)));
  const labelOf = (id: string) => (cause.has(id) ? "cause" : unrelated.has(id) ? "unrelated" : "other");
  const lead = request.group.representative.baseline.evidenceIds[0] ?? "";
  // A row with no cause event: the right answer is "not enough evidence", for the baseline and the AI.
  const noCause = cause.size === 0;
  return {
    baselineCorrect: noCause ? !unrelated.has(lead) : cause.has(lead),
    concluded,
    aiCorrect: noCause ? !concluded : concluded && !falseAttribution,
    falseAttribution,
    primaryLabels: primary.map(labelOf),
    baselineLeadLabel: labelOf(lead),
    citesBaselineLead: concluded && primary.includes(lead),
    cited: cited.length,
    citedShownWhole: cited.filter((id) => shownWhole(request, promptUser, id)).length
  };
}

/**
 * The product-contract failures the live gate refuses, on one request and its answer: the canary in what
 * the model was shown or in the answer, a refused answer, a residual secret, a citation whose line the
 * model was not shown whole. Empty when it holds.
 */
export function deliveryViolations(request: FailureAnalysisRequest, value: unknown, prompt: { system: string; user: string }): string[] {
  const violations: string[] = [];
  const shown = `${prompt.system}\n${prompt.user}`.toUpperCase();
  if (shown.includes(CANARY)) violations.push("CANARY_IN_PROMPT");
  const answer = parseFailureAnalysis(value, request);
  if (!answer.ok) return [...violations, `REFUSED_${answer.code}`];
  const { insufficient, category, explanation, primaryEvidenceIds, secondaryEvidenceIds, investigationSteps } = answer;
  const stored = redactFailureAnalysis({ insufficient, category, explanation, primaryEvidenceIds, secondaryEvidenceIds, investigationSteps }, new SemanticRedactor());
  if (!stored) violations.push("RESIDUAL_SECRET");
  if ([category, explanation, ...investigationSteps].join("\n").toUpperCase().includes(CANARY)) violations.push("CANARY_IN_ANSWER");
  if ([...primaryEvidenceIds, ...secondaryEvidenceIds].some((id) => !shownWhole(request, prompt.user, id))) violations.push("CITED_NOT_SHOWN");
  return violations;
}

/**
 * The judge and the delivery check on scripted answers, so neither can pass vacuously. `transport-noise`
 * is the case to use: it has a cause, three unrelated events, and a baseline that is wrong.
 */
export function errorControlFailures(request: FailureAnalysisRequest, labels: RowLabels, prompt: { system: string; user: string }): string[] {
  const failures: string[] = [];
  const expect = (label: string, ok: boolean) => {
    if (!ok) failures.push(label);
  };
  const [cause] = labels.cause;
  const [unrelated] = labels.unrelated;
  const runnerId = request.evidence.find((event) => event.source === "runner.failure")?.id;
  if (!cause || !unrelated || !runnerId) return ["the controls need a case with a cause, an unrelated event and a runner record"];
  const answer = (primary: string[], explanation = "The order request never reached the server: the connection was reset.") => ({
    version: 1,
    conclusion: [{ primaryEvidenceIds: primary, secondaryEvidenceIds: [], category: "transport failure", explanation, investigationSteps: ["Check the order service is reachable."] }]
  });
  const judge = (value: unknown) => {
    const parsed = parseFailureAnalysis(value, request);
    return parsed.ok ? judgeFailureAnswer(request, parsed, labels, prompt.user) : null;
  };

  const right = judge(answer([cause]));
  expect("a conclusion resting on the cause is correct and no false attribution", right?.aiCorrect === true && right.falseAttribution === false);
  expect("...and delivered", deliveryViolations(request, answer([cause]), prompt).length === 0);
  expect("...every citation shown whole", right?.cited === 1 && right.citedShownWhole === 1);
  const wrong = judge(answer([unrelated]));
  expect("a conclusion resting on an unrelated event is a false attribution", wrong?.falseAttribution === true && wrong.aiCorrect === false);
  const mixed = judge(answer([unrelated, cause]));
  expect("naming an unrelated event beside the cause is still a false attribution", mixed?.falseAttribution === true);
  expect("the case's baseline is judged wrong, as constructed", right?.baselineCorrect === false);
  const lead = request.group.representative.baseline.evidenceIds[0];
  expect(
    "citing the baseline's own lead is recorded as an echo, and citing the cause is not",
    labels.unrelated.includes(lead) && judge(answer([lead]))?.citesBaselineLead === true && right?.citesBaselineLead === false
  );
  expect("a canary in the answer is refused", deliveryViolations(request, answer([cause], `Reset while sending ${CANARY}.`), prompt).includes("CANARY_IN_ANSWER"));
  expect("a canary in the prompt is refused", deliveryViolations(request, answer([cause]), { ...prompt, user: `${prompt.user}\n${CANARY.toLowerCase()}` }).includes("CANARY_IN_PROMPT"));
  expect("an id the request did not offer is refused", deliveryViolations(request, answer(["ev999"]), prompt).includes("REFUSED_UNKNOWN_EVIDENCE"));
  expect("the runner's own record as the cause is refused", deliveryViolations(request, answer([runnerId]), prompt).includes("REFUSED_UNSUPPORTED_CONCLUSION"));
  expect("declining beside a direct cause is refused", deliveryViolations(request, { version: 1, conclusion: [] }, prompt).includes("REFUSED_CONTRADICTORY"));
  return failures;
}

/**
 * The judge on a row with no cause event (`timeout-unrelated-console`): a decline is right and delivered,
 * a conclusion on the unrelated event is a false attribution, and a baseline resting on the runner's own
 * record is right.
 */
export function noCauseControlFailures(request: FailureAnalysisRequest, labels: RowLabels, prompt: { system: string; user: string }): string[] {
  const failures: string[] = [];
  const expect = (label: string, ok: boolean) => {
    if (!ok) failures.push(label);
  };
  const [unrelated] = labels.unrelated;
  if (labels.cause.length > 0 || !unrelated || request.mustConclude) return ["the no-cause controls need a case with no cause event, an unrelated one, and a decline allowed"];
  const judge = (value: unknown) => {
    const parsed = parseFailureAnalysis(value, request);
    return parsed.ok ? judgeFailureAnswer(request, parsed, labels, prompt.user) : null;
  };
  const decline = { version: 1, conclusion: [] };
  const declined = judge(decline);
  expect("with no cause event, declining is correct and no false attribution", declined?.aiCorrect === true && declined.falseAttribution === false && declined.concluded === false);
  expect("...and delivered", deliveryViolations(request, decline, prompt).length === 0);
  expect("...and the baseline resting on the runner's own record is correct", declined?.baselineCorrect === true);
  const blamed = judge({
    version: 1,
    conclusion: [{ primaryEvidenceIds: [unrelated], secondaryEvidenceIds: [], category: "missing icon", explanation: "The favicon failed to load.", investigationSteps: [] }]
  });
  expect("with no cause event, a conclusion on the unrelated event is a false attribution", blamed?.falseAttribution === true && blamed.aiCorrect === false);
  return failures;
}
