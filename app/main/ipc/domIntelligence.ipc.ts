/**
 * L11 DOM-intelligence IPC (awkit-djnl.19): Settings status and the Element Spy / Designer diagnosis.
 *
 * Both channels are authorized here in main before anything runs. The diagnosis loads the step ITSELF
 * (the saved flow from its store, or main's own copy of a draft action) — the renderer names ids only —
 * and reads only the Recorder/Element Spy's live page, which `getLivePage` withholds during a
 * protected-login handoff or after protected-login detection. `LocatorFactory.diagnose` is read-only: it
 * never clicks, fills or rewrites anything, so there is no path from here to a silent locator change.
 */

import { join } from "node:path";

import { ipcMain } from "electron";

import type { FlowStep, LocatorElementFingerprint } from "@src/profiles/FlowProfile";
import { buildRecordedStep } from "@src/recorder/buildRecordedFlow";
import { recorderService } from "@src/recorder/RecorderService";
import { LocatorFactory, type LocatorDiagnosis } from "@src/runner/LocatorFactory";
import { FileLocatorRecoveryStore, stepCandidatesDigest } from "@src/runner/LocatorRecoveryStore";
import {
  DIAGNOSIS_FAILURE_MESSAGES,
  DRIFT_MAX_STEPS,
  classifyDrift,
  sanitizeDiagnosisRequest,
  sanitizeDriftRequest,
  type DomDiagnosisFailureCode,
  type DomDiagnosisResponse,
  type DomDriftResponse,
  type DomDriftStep,
  type DomIntelligenceStatusView,
  type DomSimilarRowsLoopResponse,
  type DomSimilarRowsResponse
} from "@src/runner/domIntelligence/DomIntelligenceApi";
import { extractSimilarRows } from "@src/runner/domIntelligence/similarRows";
import { MemoryDomReferenceStore, buildDomReference, type DomReferenceStore } from "@src/runner/domIntelligence/domReference";
import { routeKey } from "@src/runner/routeIdentity";
import { Permission } from "@src/security/authz/Permissions";
import { SemanticRedactor } from "@src/semantic/SemanticRedactor";

import { getRuntimePaths } from "../appPaths";
import { domIntelligenceRuntimeRoot, domIntelligenceStatus, getDomIntelligenceProvider, getDomReferenceStore } from "../domIntelligence/domIntelligenceRuntime";
import { createFlowProfileStore } from "../profileStores";
import { assertSenderPermission, assertSenderSuperUser } from "../security/sessionContext";
import type { AuthorizedActor } from "@src/security/authz/AuthorizationService";

const failure = (code: DomDiagnosisFailureCode): { ok: false; code: DomDiagnosisFailureCode; message: string } => ({ ok: false, code, message: DIAGNOSIS_FAILURE_MESSAGES[code] });
const labelRedactor = new SemanticRedactor({ maxContentLength: 120 });
/** L12.19: the loop selector main proved for the last similar-rows answer, bound to that inspection. */
let similarRowsLoop: { inspectedAt: string; selector: string; rows: number; pageAlias: string } | null = null;

/**
 * The step's most recent runtime identity (winner memory for any scenario) and the route it was proven on,
 * else its recorded identity.
 */
async function expectedIdentity(step: FlowStep, flowId: string | undefined): Promise<{ fingerprint?: LocatorElementFingerprint; route?: string }> {
  if (flowId && step.locator) {
    const digest = stepCandidatesDigest(step.locator);
    const suffix = `\u0000${flowId}\u0000${step.id}`;
    const records = await new FileLocatorRecoveryStore(join(getRuntimePaths().root, "locator-recovery")).list().catch(() => []);
    const latest = records
      .filter((record) => record.scopeKey.endsWith(suffix) && record.candidatesDigest === digest && record.fingerprint)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (latest?.fingerprint) return { fingerprint: latest.fingerprint, route: latest.route };
  }
  return { fingerprint: step.locator?.identity?.fingerprint };
}

/**
 * L12.17: every diagnosis that actually read a protected page is recorded on the security audit trail: who,
 * when, and the detector's reason code. Never the page, a selector or a URL. Best effort, like denials.
 */
async function auditProtectedDiagnosis(actor: AuthorizedActor, reason: string): Promise<void> {
  try {
    const { getSecurityKernel } = await import("../security/securityKernel");
    const kernel = await getSecurityKernel();
    await kernel.store.appendAudit({
      at: new Date().toISOString(),
      eventType: "PROTECTED_DIAGNOSIS_USED",
      result: "success",
      reasonCode: reason,
      actorUserId: actor.user.id,
      actorName: actor.user.username,
      sessionId: actor.sessionRef,
      targetType: "ipc-channel",
      targetId: "domIntelligence:diagnoseStep",
      detail: { surface: reason }
    });
  } catch {
    // An unwritable audit trail must not turn a finished read-only diagnosis into an error.
  }
}

/** Labels are page text shown to the user: redacted like every other projected string. */
function redactDiagnosis(diagnosis: LocatorDiagnosis): LocatorDiagnosis {
  const element = <T extends { owner: { name: string } } | undefined>(value: T): T =>
    value ? ({ ...value, owner: { ...value.owner, name: labelRedactor.redactText(value.owner.name) } } as T) : value;
  return {
    ...diagnosis,
    ...(diagnosis.snapshot ? { snapshot: { ...diagnosis.snapshot, element: element(diagnosis.snapshot.element) } } : {}),
    provider: { ...diagnosis.provider, candidates: diagnosis.provider.candidates.map((candidate) => ({ ...candidate, element: element(candidate.element) })) }
  };
}

export function registerDomIntelligenceIpc(): void {
  ipcMain.handle("domIntelligence:getStatus", async (event): Promise<DomIntelligenceStatusView> => {
    await assertSenderPermission(event, Permission.PAGE_SETTINGS);
    return {
      ...(await domIntelligenceStatus()),
      recoveryEngine: process.env.AWKIT_LOCATOR_RECOVERY_ENGINE === "legacy" ? "legacy" : "snapshot",
      runtimeShipped: domIntelligenceRuntimeRoot() !== null
    };
  });

  ipcMain.handle("domIntelligence:diagnoseStep", async (event, raw: unknown): Promise<DomDiagnosisResponse> => {
    await assertSenderPermission(event, Permission.PAGE_RECORDER);
    const request = sanitizeDiagnosisRequest(raw);
    if (!request) return failure("INVALID_REQUEST");
    // L12.17: reading a sign-in or MFA page needs the Super User role (a direct grant is not enough), the
    // permission and a fresh re-authentication. A denial is audited; a use is audited below.
    const actor = request.includeProtected
      ? await assertSenderSuperUser(event, Permission.DOM_INTELLIGENCE_PROTECTED_DIAGNOSIS, {
          sensitive: true,
          audit: { eventType: "PROTECTED_DIAGNOSIS_DENIED", channel: "domIntelligence:diagnoseStep" }
        })
      : undefined;

    let step: FlowStep | undefined;
    let flowId: string | undefined;
    let references: DomReferenceStore = getDomReferenceStore();
    if (request.source === "flow") {
      await assertSenderPermission(event, Permission.PAGE_FLOWS);
      const flow = await createFlowProfileStore().get(request.flowId).catch(() => null);
      step = flow?.nodes.find((node) => node.id === request.stepId);
      flowId = request.flowId;
    } else {
      // A draft step has no saved reference yet: its own redacted capture is bound in memory for this
      // one diagnosis only, and never written anywhere.
      const action = await recorderService.getDraftAction(request.actionId);
      step = action ? buildRecordedStep(action) : undefined;
      const capture = action?.locator?.blueprintCapture?.domReference;
      if (step?.locator && capture) {
        step = { ...step, locator: { ...step.locator, blueprintId: `draft-${request.actionId}` } };
        const reference = buildDomReference(capture, {
          referenceId: `draft-${request.actionId}`,
          bindingDigest: stepCandidatesDigest(step.locator!),
          source: "recorder",
          route: routeKey(action?.locator?.blueprintCapture?.url)
        });
        const memory = new MemoryDomReferenceStore();
        if (reference) await memory.put(reference);
        references = memory;
      }
    }
    if (!step) return failure("STEP_NOT_FOUND");
    if (!step.locator) return failure("NO_LOCATOR");
    const alias = step.pageAlias ?? "main";
    const page = recorderService.getLivePage(alias, { allowProtected: actor !== undefined });
    if (!page) return failure("NO_LIVE_PAGE");
    try {
      const identity = await expectedIdentity(step, flowId);
      const diagnosis = await new LocatorFactory(page).diagnose(step, {
        provider: getDomIntelligenceProvider(),
        references,
        expected: identity.fingerprint,
        expectedRoute: identity.route,
        flowId,
        allowProtected: actor !== undefined,
        describe: true
      });
      if (actor && diagnosis.protectedOverride) await auditProtectedDiagnosis(actor, diagnosis.protectedOverride);
      return { ok: true, diagnosis: { ...redactDiagnosis(diagnosis), page: alias } };
    } catch {
      return failure("FAILED");
    }
  });

  // L12.13: "every row like this one" for the Element Spy's inspected element, as redacted text.
  ipcMain.handle("domIntelligence:similarRows", async (event): Promise<DomSimilarRowsResponse> => {
    await assertSenderPermission(event, Permission.PAGE_RECORDER);
    await assertSenderPermission(event, Permission.RECORDER_ELEMENT_SPY);
    similarRowsLoop = null;
    const live = recorderService.getInspectionTarget();
    if (!live) return { ok: false, code: "NO_INSPECTION", message: "Inspect an element in the Element Spy first." };
    try {
      const { inspection, page } = live;
      const located = await new LocatorFactory(page).resolve({ id: "element-spy", type: "click", name: inspection.owner.name, locator: inspection.locator } as FlowStep);
      if ((await located.count()) !== 1) return { ok: false, code: "FAILED", message: "The inspected element is no longer unique on the page." };
      const frame = await located.elementHandle().then((handle) => handle?.ownerFrame());
      if (!frame) return { ok: false, code: "FAILED", message: "The inspected element is no longer on the page." };
      const result = await extractSimilarRows(frame, located, getDomIntelligenceProvider(), (text) => labelRedactor.redactText(text));
      if (result.ok) {
        if (result.loop) similarRowsLoop = { inspectedAt: inspection.inspectedAt, selector: result.loop, rows: result.total, pageAlias: inspection.pageAlias };
        return { ok: true, rows: result.rows, total: result.total, loop: result.loop !== undefined };
      }
      return result.reason === "protected-surface"
        ? { ok: false, code: "PROTECTED", message: "This page has a protected sign-in field, so it is not read." }
        : result.reason === "provider-unavailable"
          ? { ok: false, code: "UNAVAILABLE", message: "DOM intelligence is not available in this build or is turned off." }
          : { ok: false, code: "FAILED", message: "Similar elements could not be found on this page." };
    } catch {
      return { ok: false, code: "FAILED", message: "Similar elements could not be found on this page." };
    }
  });

  // L12.19: add a for-each loop over the rows the last similarRows call proved, for the same inspection only.
  ipcMain.handle("domIntelligence:addSimilarRowsLoop", async (event): Promise<DomSimilarRowsLoopResponse> => {
    await assertSenderPermission(event, Permission.PAGE_RECORDER);
    await assertSenderPermission(event, Permission.RECORDER_ELEMENT_SPY);
    const loop = similarRowsLoop;
    const inspection = recorderService.getInspectionTarget()?.inspection;
    if (!loop || !inspection || inspection.inspectedAt !== loop.inspectedAt) {
      return { ok: false, message: "Find similar rows for the inspected element first." };
    }
    const added = await recorderService.addSimilarRowsLoop(loop.selector, loop.rows, loop.pageAlias);
    return added.ok ? added : { ok: false, message: added.reason };
  });

  // L12.9: the pre-run drift check. Every element step of a saved flow is diagnosed read-only on the Spy's
  // live page (the same LocatorFactory.diagnose, never an action), and reported as one status per step.
  ipcMain.handle("domIntelligence:checkDrift", async (event, raw: unknown): Promise<DomDriftResponse> => {
    await assertSenderPermission(event, Permission.PAGE_RECORDER);
    await assertSenderPermission(event, Permission.PAGE_FLOWS);
    const request = sanitizeDriftRequest(raw);
    if (!request) return failure("INVALID_REQUEST");
    const flow = await createFlowProfileStore().get(request.flowId).catch(() => null);
    if (!flow) return failure("STEP_NOT_FOUND");
    const started = performance.now();
    const steps: DomDriftStep[] = [];
    let skipped = 0;
    for (const step of flow.nodes.filter((node) => node.locator).slice(0, DRIFT_MAX_STEPS)) {
      const page = recorderService.getLivePage(step.pageAlias ?? "main");
      const name = labelRedactor.redactText(step.name ?? step.id).slice(0, 120);
      if (!page) {
        skipped += 1;
        steps.push({ stepId: step.id, name, status: "not-here" });
        continue;
      }
      try {
        const identity = await expectedIdentity(step, request.flowId);
        const diagnosis = await new LocatorFactory(page).diagnose(step, {
          provider: getDomIntelligenceProvider(),
          references: getDomReferenceStore(),
          expected: identity.fingerprint,
          expectedRoute: identity.route,
          flowId: request.flowId
        });
        steps.push({ stepId: step.id, name, status: classifyDrift(diagnosis) });
      } catch {
        steps.push({ stepId: step.id, name, status: "not-here" });
      }
    }
    if (steps.length > 0 && skipped === steps.length) return failure("NO_LIVE_PAGE");
    return { ok: true, steps, checked: steps.length - skipped, skipped, ms: performance.now() - started };
  });
}
