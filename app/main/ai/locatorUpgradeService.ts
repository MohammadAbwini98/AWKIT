/**
 * Main-process owner of locator-upgrade promotion (Phase L, L3 §6).
 *
 * It is the trusted boundary between a renderer that has *asked* for a promotion and the saved flow.
 * The renderer names a flow, a step and the candidate's `createdAt`; everything that decides whether
 * the replacement happens is read here — the saved flow through the single-writer lane, the replay
 * tallies from the runner's own locator memory, the autonomy policy from AI settings and the audit
 * store. A renderer cannot supply evidence, an eligibility flag or a tier.
 *
 * Order of writes is deliberate: the locator change commits first and the `AiActionRecord` is
 * appended after. A crash between the two leaves a promotion with no audit entry — visible, and
 * still revertible by hand, because `locatorProvenance.previous` is on the step. The other order
 * would leave an audit entry claiming a change that never happened.
 *
 * Open-editor coordination: a renderer reports which flow it has open and whether that editor has
 * unsaved changes. Promotion is refused while the target flow is dirty, because the editor's next
 * save writes its whole document — including the locator it loaded — and would silently undo the
 * promotion. This is data integrity, not authorization: only the renderer can know its own dirty
 * state. The authorization guarantees are the IPC permission check, T3, the trusted evidence and the
 * compare-and-swap on the step binding, none of which trust the renderer at all.
 */

import { join } from "node:path";

import type { AiAdminResponse, FlowLocatorUpgradesView, LocatorPromotionRequest } from "@src/ai/contracts/AiApi";
import { describeFlowLocatorUpgrades, promoteLocatorUpgrade, type LocatorPromotionRefusal } from "@src/ai/locatorPromotion";
import type { LocatorReplayProofRecord } from "@src/ai/pendingUpgrade";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import { FileLocatorRecoveryStore } from "@src/runner/LocatorRecoveryStore";

import { getRuntimePaths } from "../appPaths";
import { createFlowProfileStore } from "../profileStores";
import { aiPolicyConfig, appendAiActionRecord } from "./aiRuntime";

/**
 * Which flow each renderer has open, and whether it is dirty. Keyed by `WebContents` id so a closed
 * window or a navigation away releases its claim; a renderer that never reports is simply not
 * holding one, which is the same as having nothing open.
 */
const openEditors = new Map<number, { flowId: string; dirty: boolean }>();

export function setFlowEditorState(webContentsId: number, state: { flowId: string; dirty: boolean } | null): void {
  if (state) openEditors.set(webContentsId, state);
  else openEditors.delete(webContentsId);
}

export function clearFlowEditorState(webContentsId: number): void {
  openEditors.delete(webContentsId);
}

export function isFlowEditorDirty(flowId: string): boolean {
  for (const editor of openEditors.values()) if (editor.flowId === flowId && editor.dirty) return true;
  return false;
}

/**
 * Must match `ExecutionEngine`'s own `join(dirs.root, "locator-recovery")` (see `execution.ipc`
 * `resolveStorageDirs`), or promotion would read an empty folder and refuse every candidate for
 * want of evidence that is sitting right there.
 */
const recoveryStore = (): FileLocatorRecoveryStore => new FileLocatorRecoveryStore(join(getRuntimePaths().root, "locator-recovery"));

const replayProofs = (): Promise<LocatorReplayProofRecord[]> => recoveryStore().listReplayProofs().catch(() => []);

/** What the Flow Designer may show for one flow. Read-only: it writes nothing and proves nothing new. */
export async function flowLocatorUpgrades(flowId: string): Promise<FlowLocatorUpgradesView> {
  const empty: FlowLocatorUpgradesView = { flowId, pending: [], applied: [], editorDirty: isFlowEditorDirty(flowId) };
  const profile = await createFlowProfileStore().get(flowId).catch(() => null);
  if (!profile) return empty;
  return describeFlowLocatorUpgrades({
    profile,
    replayProofs: await replayProofs(),
    policy: await aiPolicyConfig(),
    editorDirty: isFlowEditorDirty(flowId)
  });
}

const REFUSAL_MESSAGES: Readonly<Record<string, string>> = {
  EDITOR_DIRTY: "Save this flow first: an upgrade cannot be applied while the editor has unsaved changes.",
  STEP_NOT_FOUND: "That step no longer exists in the saved flow.",
  NO_LOCATOR: "That step no longer has a locator.",
  NO_PENDING: "There is no suggested locator for that step any more.",
  SUPERSEDED: "A newer suggestion replaced the one you reviewed. Review it again.",
  STALE: "The step changed after this suggestion was verified, so it was not applied.",
  BASELINE_NOT_PROMOTABLE: "This locator still needs review, so an AI upgrade cannot replace it.",
  PROOF_NOT_SATISFIED: "This suggestion has not been proven on enough runs yet.",
  REPLAY_REJECTED: "A run refused this suggestion, so it can never be applied.",
  THRESHOLDS_PROVISIONAL: "Automatic promotion is off until the proof thresholds are confirmed.",
  POLICY_REFUSED: "Local AI is not permitted to change locators with the current settings.",
  T3_PROTECTED_LOGIN: "AI never changes anything on a protected sign-in surface.",
  T3_SENSITIVE_STEP: "AI never changes the locator of a sensitive action.",
  T3_STEP_UNKNOWN: "AI never changes a locator on a step it cannot inspect.",
  FLOW_NOT_FOUND: "That flow no longer exists.",
  WRITE_FAILED: "The flow could not be saved, so nothing was changed."
};

const refused = (code: string): AiAdminResponse => ({
  code: "PROMOTION_REFUSED",
  ok: false,
  detail: code,
  message: REFUSAL_MESSAGES[code] ?? "The suggested locator could not be applied."
});

/**
 * Apply one user-approved promotion.
 *
 * Automatic (T2) promotion goes through the same `promoteLocatorUpgrade`, which refuses mode `auto`
 * while the replay thresholds are seeded rather than committed; there is deliberately no IPC that
 * requests it, because nothing queues locator-upgrade jobs until the L1 go/no-go passes.
 */
export async function promoteFlowLocatorUpgrade(request: LocatorPromotionRequest): Promise<AiAdminResponse> {
  const [proofs, policy] = await Promise.all([replayProofs(), aiPolicyConfig()]);
  const nowIso = new Date().toISOString();
  // `${flow}:${step}:${timestamp}` would collide on a repeat; a random suffix keeps ids unique
  // without a counter that a restart would reset.
  const actionId = `ai-upgrade-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;

  let outcome: { code: "OK" | LocatorPromotionRefusal | "FLOW_NOT_FOUND" | "WRITE_FAILED"; replays?: number; dataRows?: number } = {
    code: "FLOW_NOT_FOUND"
  };
  let pendingRecord: Parameters<typeof appendAiActionRecord>[0] | null = null;
  try {
    await createFlowProfileStore().updateWith(request.flowId, (current: FlowProfile | null) => {
      if (!current) return undefined;
      const result = promoteLocatorUpgrade(current, request.stepId, {
        createdAt: request.createdAt,
        mode: "user-approved",
        actionId,
        nowIso,
        replayProofs: proofs,
        policy,
        // Read inside the lane, so an editor that reported unsaved changes while this call was in
        // flight is still seen before the write rather than after it.
        editorDirty: isFlowEditorDirty(request.flowId)
      });
      if (!result.ok) {
        outcome = { code: result.code };
        return undefined;
      }
      outcome = { code: "OK", replays: result.evaluation.replays, dataRows: result.evaluation.dataRows };
      pendingRecord = result.record;
      return result.profile;
    });
  } catch {
    return refused("WRITE_FAILED");
  }
  if (outcome.code !== "OK" || !pendingRecord) return refused(outcome.code);

  const appended = await appendAiActionRecord(pendingRecord).catch(() => ({ ok: false as const, errors: ["append failed"] }));
  return appended.ok
    ? { code: "OK", ok: true, detail: actionId }
    : { code: "OK", ok: true, detail: actionId, message: "Applied. The AI audit log could not be updated, so this change is not listed there." };
}
