/**
 * Flow-store hooks for the visual-baseline lifecycle (Phase N, N6.3 / awkit-vra.15.3). Plan: "Baseline
 * lifecycle" and "Cross-process safety". Set only by `createFlowProfileStore`.
 *
 * Every flow write (create, clone, import, Recorder save, update, updateWith, delete, rename) runs in
 * the in-process lane and then under the flows folder's cross-process lock (`exclusive`), so packaged
 * and development builds sharing one flows folder never interleave. Inside it, BEFORE the write:
 *
 *  - create, clone, import (even an identical re-import), the new id of a rename, and an update over a
 *    missing or unreadable file invalidate the whole flow and issue it a fresh epoch token;
 *  - update and updateWith delete the approvals of every step removed or whose content digest changed;
 *  - delete and the old id of a rename invalidate the flow;
 *  - a quarantined corrupt file invalidates the flow, coordinated even when the read that found it was not.
 *
 * A write refused before this point (a duplicate create, an authorization denial) changes nothing. None
 * of this needs a key, so it works with the keystore down. Each hook ends with the fencing check, so a
 * holder that lost the lock never writes.
 */

import type { FlowProfile } from "../../profiles/FlowProfile";
import type { ProfileStoreHooks, ProfileWriteContext } from "../../storage/ProfileStore";
import { visualStepContentDigest } from "./stepContentDigest";
import { VisualBaselineLayout, type VisualBaselineLayoutOptions } from "./visualBaselineLayout";

/** Step ids of `previous` that were removed in `next` or whose content digest changed. */
export function changedStepIds(previous: FlowProfile, next: FlowProfile): string[] {
  const nextById = new Map<string, string>();
  for (const step of Array.isArray(next.nodes) ? next.nodes : []) {
    if (step && typeof step.id === "string") nextById.set(step.id, visualStepContentDigest(step as unknown as { id: string } & Record<string, unknown>));
  }
  const changed: string[] = [];
  for (const step of Array.isArray(previous.nodes) ? previous.nodes : []) {
    if (!step || typeof step.id !== "string") continue;
    const after = nextById.get(step.id);
    if (after === undefined || after !== visualStepContentDigest(step as unknown as { id: string } & Record<string, unknown>)) changed.push(step.id);
  }
  return changed;
}

export class FlowBaselineLifecycle {
  readonly layout: VisualBaselineLayout;

  constructor(options: VisualBaselineLayoutOptions | VisualBaselineLayout) {
    this.layout = options instanceof VisualBaselineLayout ? options : new VisualBaselineLayout(options);
  }

  /** What a flow write does to the flow's approvals. Overridable so verifiers can plant faults. */
  protected async onWrite(context: ProfileWriteContext<FlowProfile>): Promise<void> {
    const sameIdUpdate = context.operation === "update" || context.operation === "updateWith";
    if (sameIdUpdate && context.previousState === "present" && context.previous) {
      await this.layout.purgeStepsUnlocked(context.id, changedStepIds(context.previous, context.next));
    } else {
      // The flow is present after this write, so it gets a fresh token even if it had none (VA-5, I1).
      await this.layout.invalidateFlowUnlocked(context.id, { issueToken: true });
    }
  }

  protected async onDelete(flowId: string): Promise<void> {
    await this.layout.invalidateFlowUnlocked(flowId);
  }

  protected async onQuarantine(flowId: string): Promise<void> {
    if (this.layout.isCoordinated() || this.layout.isUncoordinatedFallback()) {
      await this.layout.invalidateFlowUnlocked(flowId);
      return;
    }
    // Reached from a read outside the lane: take the lane and the lock first, like every other write.
    await this.layout.write(() => this.layout.invalidateFlowUnlocked(flowId));
  }

  hooks(): ProfileStoreHooks<FlowProfile> {
    return {
      exclusive: <R>(task: () => Promise<R>) => this.layout.exclusive(task),
      beforeWrite: async (context) => {
        await this.onWrite(context);
        await this.layout.assertHeld();
      },
      beforeDelete: async (context) => {
        await this.onDelete(context.id);
        await this.layout.assertHeld();
      },
      onQuarantine: (flowId) => this.onQuarantine(flowId)
    };
  }
}

export function createFlowBaselineHooks(options: VisualBaselineLayoutOptions): ProfileStoreHooks<FlowProfile> {
  return new FlowBaselineLifecycle(options).hooks();
}
