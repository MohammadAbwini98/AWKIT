import { randomUUID } from "node:crypto";
import type { FlowProfile, FlowStep, LocatorGuard } from "../profiles/FlowProfile";
import { isPositionalLocator } from "../profiles/locatorApproval";
import { resolveStepSafety } from "../runner/runtime/StepSafetyPolicy";
import { hashFingerprint, hashToken } from "../runner/locatorFingerprint";
import type { PageBlueprint, ElementBlueprint } from "../runner/LocatorBlueprintStore";
import { computePageKey } from "../runner/LocatorBlueprintStore";
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
      if (action.locator.approvedFallbackReason) step.locator.approvedFallbackReason = action.locator.approvedFallbackReason;
      if (action.locator.approvedFallbackBinding) step.locator.approvedFallbackBinding = action.locator.approvedFallbackBinding;
      if (action.locator.reviewReason) step.locator.reviewReason = action.locator.reviewReason;

      // Page-level blueprint capture for fallback recovery
      if (action.locator.blueprintCapture && blueprintsOut) {
        const capture = action.locator.blueprintCapture;
        const pageKey = computePageKey(capture.url, capture.title, action.locator.context?.frameChain?.length ? "frame" : "");
        let blueprint = blueprintsOut.find(b => b.pageKey === pageKey);
        if (!blueprint) {
          blueprint = {
            schemaVersion: 1,
            pageKey,
            canonicalUrl: (() => {
              try { return new URL(capture.url).origin + new URL(capture.url).pathname; }
              catch { return capture.url; }
            })(),
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
          const element: ElementBlueprint = {
            blueprintId,
            documentOrder: capture.documentOrder,
            siblingIndex: capture.siblingIndex,
            sameTagIndex: capture.sameTagIndex,
            tag: String(capture.fingerprint.tag || ""),
            role: capture.fingerprint.role ? String(capture.fingerprint.role) : undefined,
            ancestry: Array.isArray(capture.fingerprint.ancestry) ? capture.fingerprint.ancestry.map(String) : [],
            fingerprint: hashFingerprint(capture.fingerprint as any),
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
      // positional last-resort locator is RESOLVED for ordinary steps. A SENSITIVE step
      // (dangerousMutation/externalCommit) whose only unique locator is positional instead carries a
      // guarded-positional locator whose identity is re-proven at replay; with no usable guard it stays
      // needs-review. Explicit recorder/user decisions (shadow/frame review, open-shadow resolve, user
      // approval) are preserved as-is.
      if (action.locator.resolution) {
        step.locator.resolution = action.locator.resolution;
        step.locator.resolvedBy = action.locator.resolvedBy ?? "recorder";
      } else if (action.locator.quality?.isUnique === false) {
        step.locator.resolution = "needs-review";
        step.locator.resolvedBy = "recorder";
        if (!step.locator.reviewReason) step.locator.reviewReason = "the recorder could not build a unique locator";
      } else if (isPositionalLocator(step.locator) && isSensitiveAction(action)) {
        const draft = action.locator.guard;
        if (draft?.fingerprint && draft.candidateSelector) {
          step.locator.guard = hashGuard(draft);
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
      // Apply the same needs-review policy the source gets: an explicit recorder decision wins, then a
      // non-unique (ambiguous) drop target is needs-review, otherwise resolved. This covers BOTH the
      // native drag path and the pointer-emulated recognizer, which each supply a `quality`.
      if (t.resolution) {
        step.targetLocator.resolution = t.resolution;
        step.targetLocator.resolvedBy = t.resolvedBy ?? "recorder";
        if (t.reviewReason) step.targetLocator.reviewReason = t.reviewReason;
      } else if (t.quality?.isUnique === false || isPositionalLocator(step.targetLocator)) {
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
    if (action.beforeWaits && action.beforeWaits.length > 0) step.beforeWaits = action.beforeWaits;
    if (action.afterWaits && action.afterWaits.length > 0) step.afterWaits = action.afterWaits;

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
      // hover step from the hidden target; leave the click needs-review so preflight blocks it.
      if (step.locator) {
        step.locator.resolution = "needs-review";
        step.locator.resolvedBy = "recorder";
        // Carry the recorder's diagnosis so the review says why, not just that.
        const why = action.locator.interaction.hoverReviewReason;
        if (typeof why === "string" && why) step.locator.reviewReason = why;
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
