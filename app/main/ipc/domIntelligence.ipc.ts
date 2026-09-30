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
  sanitizeDiagnosisRequest,
  type DomDiagnosisFailureCode,
  type DomDiagnosisResponse,
  type DomIntelligenceStatusView
} from "@src/runner/domIntelligence/DomIntelligenceApi";
import { MemoryDomReferenceStore, buildDomReference, type DomReferenceStore } from "@src/runner/domIntelligence/domReference";
import { routeKey } from "@src/runner/routeIdentity";
import { Permission } from "@src/security/authz/Permissions";
import { SemanticRedactor } from "@src/semantic/SemanticRedactor";

import { getRuntimePaths } from "../appPaths";
import { domIntelligenceRuntimeRoot, domIntelligenceStatus, getDomIntelligenceProvider, getDomReferenceStore } from "../domIntelligence/domIntelligenceRuntime";
import { createFlowProfileStore } from "../profileStores";
import { assertSenderPermission } from "../security/sessionContext";

const failure = (code: DomDiagnosisFailureCode): DomDiagnosisResponse => ({ ok: false, code, message: DIAGNOSIS_FAILURE_MESSAGES[code] });
const labelRedactor = new SemanticRedactor({ maxContentLength: 120 });

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
    const page = recorderService.getLivePage(alias);
    if (!page) return failure("NO_LIVE_PAGE");
    try {
      const identity = await expectedIdentity(step, flowId);
      const diagnosis = await new LocatorFactory(page).diagnose(step, {
        provider: getDomIntelligenceProvider(),
        references,
        expected: identity.fingerprint,
        expectedRoute: identity.route,
        describe: true
      });
      return { ok: true, diagnosis: { ...redactDiagnosis(diagnosis), page: alias } };
    } catch {
      return failure("FAILED");
    }
  });
}
