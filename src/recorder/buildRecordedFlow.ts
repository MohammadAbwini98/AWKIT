import { randomUUID } from "node:crypto";
import type { ElementIdentityContract, FlowProfile, FlowStep, LocatorGuard, StepLocator, WaitCondition } from "../profiles/FlowProfile";
import { isPositionalLocator } from "../profiles/locatorApproval";
import {
  automaticInteractionDecision,
  isPrerequisiteOnlyLocatorReview,
  supportsAutomaticPrerequisiteTrial
} from "../profiles/interactionPrerequisiteDecision";
import { resolveStepSafety } from "../runner/runtime/StepSafetyPolicy";
import { hashFingerprint, hashToken } from "../runner/locatorFingerprint";
import type { PageBlueprint, ElementBlueprint } from "../runner/LocatorBlueprintStore";
import { computeFrameKey, computePageKey } from "../runner/LocatorBlueprintStore";
import type { RecordedAction, RecordedActionLocator } from "./RecorderTypes";

/** A step whose side effect is dangerous enough to require a runtime identity guard on a positional locator. */
function isSensitiveAction(action: RecordedAction): boolean {
  const level = resolveStepSafety({ type: action.type, name: action.name, value: action.valueSource?.value }).sideEffectLevel;
  return level === "dangerousMutation" || level === "externalCommit";
}

/** Hash a capture-time guard's RAW fingerprint and precondition values before persisting. */
function hashGuard(draft: LocatorGuard): LocatorGuard {
  return {
    ...draft,
    fingerprint: hashFingerprint(draft.fingerprint),
    preconditions: draft.preconditions?.map((precondition) => ({ kind: precondition.kind, expected: hashToken(precondition.expected) }))
  };
}

function hashIdentity(draft: ElementIdentityContract, locator: RecordedActionLocator): ElementIdentityContract {
  return {
    ...draft,
    primary: {
      strategy: locator.strategy as ElementIdentityContract["primary"]["strategy"],
      value: locator.value,
      name: locator.name,
      exact: locator.exact
    },
    alternatives: locator.alternatives,
    context: locator.context,
    fingerprint: draft.fingerprint ? hashFingerprint(draft.fingerprint) : undefined
  };
}

function hashWaitLocator(locator: StepLocator): StepLocator {
  return locator.identity
    ? { ...locator, identity: hashIdentity(locator.identity, locator as RecordedActionLocator), guard: locator.guard ? hashGuard(locator.guard) : undefined }
    : { ...locator, guard: locator.guard ? hashGuard(locator.guard) : undefined };
}

/** Hash every Recorder-captured wait fingerprint before the evidence reaches a saved profile. */
function persistWait(wait: WaitCondition): WaitCondition {
  const copy = { ...wait } as WaitCondition;
  if (copy.evidence?.targetIdentity?.fingerprint) {
    copy.evidence = {
      ...copy.evidence,
      targetIdentity: {
        ...copy.evidence.targetIdentity,
        fingerprint: hashFingerprint(copy.evidence.targetIdentity.fingerprint)
      }
    };
  }
  switch (copy.type) {
    case "loaderHidden":
    case "elementVisible":
    case "elementHidden":
    case "elementEnabled":
      copy.locator = hashWaitLocator(copy.locator);
      break;
    case "toastVisible":
      if (copy.locator) copy.locator = hashWaitLocator(copy.locator);
      break;
    case "tableHasRows":
      copy.tableLocator = hashWaitLocator(copy.tableLocator);
      if (copy.rowLocator) copy.rowLocator = hashWaitLocator(copy.rowLocator);
      break;
    case "listHasItems":
      copy.listLocator = hashWaitLocator(copy.listLocator);
      if (copy.itemLocator) copy.itemLocator = hashWaitLocator(copy.itemLocator);
      break;
    case "anyOf":
      copy.conditions = copy.conditions.map(persistWait);
      break;
  }
  return copy;
}

/**
 * Build a saveable {@link FlowProfile} from a recorded session's actions. Pure (no I/O) so it can be
 * unit-tested and reused by the recorder IPC handler.
 *
 * Guarantees (recorder Points 1 & 2):
 *  - the flow always contains a default Start node and End node, with the recorded action nodes
 *    inserted between them (Start → action… → End; Start → End when there are no actions);
 *  - recorded think-time (`wait` actions) becomes a fixed-time wait step (`config.waitType: "time"`,
 *    duration in `timeoutMs`) so it replays during execution;
 *  - recorded tab switches (`routeChange`) replay as a Route Change targeting the newest tab.
 */
export function buildRecordedFlow(name: string, actions: RecordedAction[], blueprintsOut?: PageBlueprint[]): FlowProfile {
  // Guard against any Start/End sneaking in from the recording so we never duplicate them.
  const actionSteps = actions.filter((action) => action.type !== "start" && action.type !== "end");

  let currentY = 100;
  const startStep: FlowStep = { id: "start", type: "start", name: "Start", position: { x: 300, y: currentY } };

  const steps: FlowStep[] = actionSteps.flatMap((action, index) => {
    currentY += 120;
    const sensitiveAction = isSensitiveAction(action);
    const step: FlowStep = {
      id: `step-${index + 1}`,
      type: action.type as FlowStep["type"],
      name: action.name,
      position: { x: 300, y: currentY }
    };

    if (action.locator) {
      step.locator = {
        strategy: action.locator.strategy as NonNullable<FlowStep["locator"]>["strategy"],
        value: action.locator.value
      };
      if (action.locator.name) step.locator.name = action.locator.name;
      if (action.locator.exact) step.locator.exact = true;
      if (action.locator.quality) step.locator.quality = action.locator.quality;
      if (action.locator.alternatives && action.locator.alternatives.length > 0) {
        step.locator.alternatives = action.locator.alternatives;
      }
      if (action.locator.context) step.locator.context = action.locator.context;
      if (action.locator.interaction) step.locator.interaction = action.locator.interaction;
      if (action.locator.identity) step.locator.identity = hashIdentity(action.locator.identity, action.locator);
      if (action.locator.prerequisite) step.locator.prerequisite = action.locator.prerequisite;
      if (action.locator.executionDecision) step.locator.executionDecision = action.locator.executionDecision;
      if (action.locator.approvedFallbackReason) step.locator.approvedFallbackReason = action.locator.approvedFallbackReason;
      if (action.locator.approvedFallbackBinding) step.locator.approvedFallbackBinding = action.locator.approvedFallbackBinding;
      if (action.locator.reviewReason) step.locator.reviewReason = action.locator.reviewReason;

      // Sensitive actions never receive or persist a blueprint recovery reference. Their exact
      // recorded locator (or guarded positional identity) must remain authoritative at replay.
      if (action.locator.blueprintCapture && blueprintsOut && !sensitiveAction) {
        const capture = action.locator.blueprintCapture;
        const frameKey = computeFrameKey(action.locator.context?.frameChain);
        const pageKey = computePageKey(capture.url, capture.title, frameKey);
        if (step.locator.identity) {
          step.locator.identity.captureEvidence = {
            ...step.locator.identity.captureEvidence,
            frameKey: frameKey || undefined,
            pageKey
          };
        }
        let blueprint = blueprintsOut.find(b => b.pageKey === pageKey);
        if (!blueprint) {
          blueprint = {
            schemaVersion: 1,
            pageKey,
            canonicalUrl: (() => {
              try { return new URL(capture.url).origin + new URL(capture.url).pathname; }
              catch { return capture.url; }
            })(),
            frameKey: frameKey || undefined,
            capturedAtUtc: new Date().toISOString(),
            documentFingerprint: capture.documentStructure,
            elements: []
          };
          blueprintsOut.push(blueprint);
        }
        if (blueprint.elements.length < 2000) {
          const blueprintId = randomUUID();
          step.locator.blueprintId = blueprintId;
          const digest = hashToken(JSON.stringify({ strategy: action.locator.strategy, value: action.locator.value }));
          const fingerprint = hashFingerprint(capture.fingerprint as any);
          const element: ElementBlueprint = {
            blueprintId,
            documentOrder: capture.documentOrder,
            siblingIndex: capture.siblingIndex,
            sameTagIndex: capture.sameTagIndex,
            tag: String(capture.fingerprint.tag || ""),
            role: capture.fingerprint.role ? String(capture.fingerprint.role) : undefined,
            ancestry: fingerprint.ancestry,
            frameChainDigest: frameKey || undefined,
            fingerprint,
            primaryLocatorDigest: digest,
            alternativeCount: action.locator.alternatives?.length ?? 0,
            visible: capture.visible,
            enabled: capture.enabled,
            boundingRegion: capture.boundingRegion
          };
          blueprint.elements.push(element);
        }
      }

      // Finalize resolution + the runtime identity guard here — the single source shared by the live
      // recorder session and the test harness. The Recorder builds nested selectors until unique, so a
      // positional last-resort locator is runnable only when its captured identity guard can be
      // persisted and re-proven. Sensitive steps retain the same proof plus stricter recovery rules.
      // Explicit recorder/user decisions (shadow/frame review and user approval) are preserved as-is.
      // The one legacy exception is prerequisite-only review: an unknown actionability prerequisite
      // must not overwrite an otherwise resolved element identity.
      const positionalGuard = isPositionalLocator(step.locator) ? action.locator.guard : undefined;
      if (positionalGuard?.fingerprint && positionalGuard.candidateSelector) {
        step.locator.guard = hashGuard(positionalGuard);
      }
      const prerequisiteOnlyReview = isPrerequisiteOnlyLocatorReview({
        ...step.locator,
        resolution: action.locator.resolution
      });
      if (action.locator.resolution && !prerequisiteOnlyReview) {
        step.locator.resolution = action.locator.resolution;
        step.locator.resolvedBy = action.locator.resolvedBy ?? "recorder";
      } else if (action.locator.quality?.isUnique === false && !step.locator.guard) {
        step.locator.resolution = "needs-review";
        step.locator.resolvedBy = "recorder";
        if (!step.locator.reviewReason) step.locator.reviewReason = "the recorder could not build a unique locator";
      } else if (isPositionalLocator(step.locator) && sensitiveAction) {
        if (step.locator.guard) {
          step.locator.resolution = "resolved";
          step.locator.resolvedBy = "recorder";
        } else {
          step.locator.resolution = "needs-review";
          step.locator.resolvedBy = "recorder";
          step.locator.reviewReason = step.locator.reviewReason ?? "sensitive action needs a stable or guarded locator";
        }
      } else {
        step.locator.resolution = "resolved";
        step.locator.resolvedBy = "recorder";
      }
      if (prerequisiteOnlyReview) delete step.locator.reviewReason;

      if (step.locator.prerequisite?.status === "unknown" && !step.locator.executionDecision) {
        const decisionStep = { type: step.type, name: step.name, safety: step.safety, locator: step.locator };
        step.locator.executionDecision =
          step.locator.resolution === "resolved" && supportsAutomaticPrerequisiteTrial(decisionStep)
            ? automaticInteractionDecision("Playwright actionability trial required before the real action")
            : {
                schemaVersion: 1,
                status: "blocked",
                reason: sensitiveAction
                  ? "sensitive actions require a resolved prerequisite"
                  : "re-record or resolve the interaction prerequisite before execution"
              };
      }
    }

    // Drag steps carry a second locator — the drop target — built alongside the source (which the
    // block above handled as `step.locator`). Mirrors the source construction; resolved as recorded.
    if (action.type === "drag" && action.targetLocator) {
      const t = action.targetLocator;
      step.targetLocator = {
        strategy: t.strategy as NonNullable<FlowStep["targetLocator"]>["strategy"],
        value: t.value
      };
      if (t.name) step.targetLocator.name = t.name;
      if (t.exact) step.targetLocator.exact = true;
      if (t.quality) step.targetLocator.quality = t.quality;
      if (t.alternatives && t.alternatives.length > 0) step.targetLocator.alternatives = t.alternatives;
      if (t.context) step.targetLocator.context = t.context;
      if (t.interaction) step.targetLocator.interaction = t.interaction;
      if (t.identity) step.targetLocator.identity = hashIdentity(t.identity, t);
      if (t.prerequisite) step.targetLocator.prerequisite = t.prerequisite;
      if (isPositionalLocator(step.targetLocator) && t.guard?.fingerprint && t.guard.candidateSelector) {
        step.targetLocator.guard = hashGuard(t.guard);
      }
      // Apply the same needs-review policy the source gets: an explicit recorder decision wins, then a
      // non-unique (ambiguous) drop target is needs-review, otherwise resolved. This covers BOTH the
      // native drag path and the pointer-emulated recognizer, which each supply a `quality`.
      if (t.resolution) {
        step.targetLocator.resolution = t.resolution;
        step.targetLocator.resolvedBy = t.resolvedBy ?? "recorder";
        if (t.reviewReason) step.targetLocator.reviewReason = t.reviewReason;
      } else if ((t.quality?.isUnique === false || isPositionalLocator(step.targetLocator)) && !step.targetLocator.guard) {
        // A drop target that is ambiguous OR identified only by position is order-fragile, so it is
        // marked needs-review rather than silently committing to one of the look-alikes by index.
        step.targetLocator.resolution = "needs-review";
        step.targetLocator.resolvedBy = "recorder";
        step.targetLocator.reviewReason =
          t.reviewReason ?? (isPositionalLocator(step.targetLocator) ? "the drop target is identified only by position — review before running" : "the recorder could not build a unique drop-target locator");
      } else {
        step.targetLocator.resolution = "resolved";
        step.targetLocator.resolvedBy = t.resolvedBy ?? "recorder";
      }
    }

    if (action.valueSource) {
      step.valueSource = {
        type: action.valueSource.type as NonNullable<FlowStep["valueSource"]>["type"],
        value: action.valueSource.value
      };
    }

    // Smart Wait conditions observed during recording (Phase 2).
    if (action.beforeWaits && action.beforeWaits.length > 0) step.beforeWaits = action.beforeWaits.map(persistWait);
    if (action.afterWaits && action.afterWaits.length > 0) step.afterWaits = action.afterWaits.map(persistWait);

    // Recorded think-time replays as a fixed-time wait step (Point 1).
    if (action.type === "wait") {
      step.timeoutMs = Math.max(0, Math.round(action.waitMs ?? 0));
      step.config = { waitType: "time" };
    }

    // Recorded tab switches replay as a Route Change that targets the newest tab.
    if (action.type === "routeChange") {
      step.value = action.valueSource?.value;
      step.config = { routeMode: "switchToLatestTab", urlMatch: "contains", routeWaitUntil: "load" };
    }

    // ── Secure login / session reuse (protected-login manual handoff) ────────────
    // Auto Secure Login reads its target URL from `step.value`.
    if (action.type === "autoSecureLogin") {
      step.value = action.valueSource?.value;
    }
    // Reuse Session links the captured session profile id (selected mode).
    if (action.type === "reuseSession") {
      step.config = {
        reuseSessionMode: action.config?.reuseSessionMode ?? "selected",
        reuseSessionId: action.config?.reuseSessionId
      };
    }

    // ── Multi-Window / Popup ────────────────────────────────────────────────
    // Map page alias so the runner knows which page object to use for this step.
    if (action.pageAlias && action.pageAlias !== "main") step.pageAlias = action.pageAlias;
    // Mark the opener action so the runner arms popup capture before the click.
    if (action.opensPopup) step.opensPopup = true;
    if (action.popupExpectation) step.popupExpectation = action.popupExpectation;

    // switchToPopup: the runner will arm waitForEvent('popup') before whatever opens it.
    // No extra config needed; popupExpectation carries the alias + hints.

    // closePopup: carry the alias so the runner waits for the right page to close.
    if (action.type === "closePopup") {
      const alias = (action as RecordedAction & { config?: { popupAlias?: string } }).config?.popupAlias ?? action.pageAlias;
      step.config = { popupAlias: alias };
    }

    if (action.locator?.interaction?.requiresHover && step.type === "click") {
      const hc = action.locator.interaction.hoverContainer;
      if (hc && typeof hc.strategy === "string" && typeof hc.value === "string") {
        // A causal hover trigger was attributed at record time. Inject an explicit, pre-resolved
        // hover step (carrying the trigger's full locator, alternatives and context) immediately
        // before the click so replay hovers the trigger, then clicks the now-visible target.
        const hoverStep: FlowStep = {
          id: `step-${index + 1}-hover`,
          type: "hover",
          name: `Hover ${(hc.name as string) || "Trigger"}`,
          position: { x: 300, y: currentY - 60 },
          locator: {
            ...(hc as Record<string, unknown>),
            resolution: "resolved",
            resolvedBy: "recorder"
          } as unknown as NonNullable<FlowStep["locator"]>
        };
        return [hoverStep, step];
      }
      // Hover-gated but no stable trigger could be attributed (`hoverUnresolved`). Never fabricate a
      // hover step from the hidden target. Identity and locator resolution remain independent; the
      // execution decision above owns the runtime trial/block policy for this unknown prerequisite.
      // Older/incomplete captures that carry no independently resolved identity remain review-only.
      if (
        step.locator &&
        (!step.locator.identity || step.locator.quality?.isUnique !== true || step.locator.prerequisite?.status !== "unknown")
      ) {
        step.locator.resolution = "needs-review";
        step.locator.resolvedBy = "recorder";
        step.locator.reviewReason = action.locator.interaction.hoverReviewReason ?? "interaction prerequisite could not be resolved";
      }
      return [step];
    }

    return [step];
  });

  currentY += 120;
  const endStep: FlowStep = { id: "end", type: "end", name: "End", position: { x: 300, y: currentY } };

  const nodes: FlowStep[] = [startStep, ...steps, endStep];

  const flowProfile: FlowProfile = {
    id: `flow-${randomUUID().slice(0, 8)}`,
    name: name || "Recorded Flow",
    description: "Auto-generated from recorder",
    version: 1,
    nodes,
    edges: []
  };

  // Connect Start → action(s) → End sequentially. With no actions the flow is still Start → End.
  const sequence = nodes.map((node) => node.id);
  for (let i = 0; i < sequence.length - 1; i++) {
    flowProfile.edges.push({
      id: `conn-${i + 1}`,
      source: sequence[i],
      target: sequence[i + 1],
      // The edge out of Start is unconditional; action edges carry the step's success outcome.
      type: sequence[i] === "start" ? "always" : "success"
    });
  }

  return flowProfile;
}
