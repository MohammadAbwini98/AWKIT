import { ipcMain } from "electron";

import type { FlowFragment, FlowFragmentKind, FragmentAuditFinding } from "@src/fragments/FlowFragment";
import { auditFragment, blockingFindings, isFragmentBlocked } from "@src/fragments/FlowFragment";
import { applyFragment, captureFragment } from "@src/fragments/fragmentOperations";
import { Permission } from "@src/security/authz/Permissions";
import { createFlowFragmentStore, createFlowProfileStore } from "../profileStores";
import { assertSenderPermission } from "../security/sessionContext";

/**
 * L6 — the trusted boundary for reusable fragments.
 *
 * The audit runs HERE, on every capture and every apply, and a blocking finding refuses the
 * operation before anything is written. A renderer that skips its own preview, or calls these
 * channels directly with whatever it likes, gets the same refusal: the renderer's audit is a
 * courtesy to the user, and this one is the rule.
 *
 * Apply re-audits the fragment it loads FROM DISK rather than trusting that it was valid when it
 * was captured. The fragment folder is ordinary user-writable JSON, so "it passed the audit once"
 * says nothing about the bytes being read now.
 */

export interface FragmentOperationResult<T> {
  ok: boolean;
  value?: T;
  findings: FragmentAuditFinding[];
}

export interface CaptureFragmentInput {
  flowId: string;
  nodeIds: string[];
  id: string;
  name: string;
  description?: string;
  kind?: FlowFragmentKind;
}

const notFound = (message: string): FragmentAuditFinding[] => [
  { code: "fragmentShapeInvalid", severity: "blocking", message }
];

export function registerFragmentIpc(): void {
  const fragments = createFlowFragmentStore();
  const flows = createFlowProfileStore();

  ipcMain.handle("fragments:list", async (event) => {
    await assertSenderPermission(event, Permission.PAGE_FLOWS);
    return fragments.list();
  });

  ipcMain.handle("fragments:get", async (event, id: string) => {
    await assertSenderPermission(event, Permission.PAGE_FLOWS);
    return fragments.get(id);
  });

  /**
   * Audit a stored fragment against a destination without changing anything, so the editor can
   * show what would happen before the user commits to it. Read-only by construction: it writes
   * nothing and returns the same findings `fragments:apply` would act on.
   */
  ipcMain.handle("fragments:audit", async (event, fragmentId: string, flowId?: string) => {
    await assertSenderPermission(event, Permission.PAGE_FLOWS);
    const fragment = await fragments.get(fragmentId);
    if (!fragment) return notFound(`Fragment "${fragmentId}" was not found.`);
    if (flowId === undefined) return auditFragment(fragment);
    const library = await flows.list();
    return auditFragment(fragment, {
      destinationFlowId: flowId,
      referenceableFlowIds: new Set(library.map((flow) => flow.id))
    });
  });

  ipcMain.handle("fragments:capture", async (event, input: CaptureFragmentInput): Promise<FragmentOperationResult<FlowFragment>> => {
    await assertSenderPermission(event, Permission.WORKFLOW_CREATE);
    const flow = await flows.get(input.flowId);
    if (!flow) return { ok: false, findings: notFound(`Flow "${input.flowId}" was not found.`) };

    const result = captureFragment({
      flow,
      nodeIds: Array.isArray(input.nodeIds) ? input.nodeIds : [],
      id: input.id,
      name: input.name,
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.kind === undefined ? {} : { kind: input.kind })
    });
    if (!result.ok) return { ok: false, findings: result.findings };

    // `create` refuses an id that already exists, so saving a fragment can never overwrite one.
    // Import-style blind writes are deliberately not offered here.
    try {
      const saved = await fragments.create(result.value);
      return { ok: true, value: saved, findings: result.findings };
    } catch (error) {
      return {
        ok: false,
        findings: notFound(error instanceof Error ? error.message : `Could not save fragment "${input.id}".`)
      };
    }
  });

  ipcMain.handle(
    "fragments:apply",
    async (event, flowId: string, fragmentId: string): Promise<FragmentOperationResult<{ insertedNodeIds: string[] }>> => {
      await assertSenderPermission(event, Permission.WORKFLOW_EDIT);

      const fragment = await fragments.get(fragmentId);
      if (!fragment) return { ok: false, findings: notFound(`Fragment "${fragmentId}" was not found.`) };
      const referenceableFlowIds = new Set((await flows.list()).map((flow) => flow.id));

      // One compare-and-swap in the flow folder's lane: the flow is read, the whole next profile is
      // built and audited, and only a fully valid result is written. Returning `undefined` writes
      // nothing at all, so a refusal cannot leave a partially inserted flow behind.
      let outcome: FragmentOperationResult<{ insertedNodeIds: string[] }> = {
        ok: false,
        findings: notFound(`Flow "${flowId}" was not found.`)
      };
      await flows.updateWith(flowId, (current) => {
        if (!current) return undefined;
        const result = applyFragment({ flow: current, fragment, referenceableFlowIds });
        if (!result.ok) {
          outcome = { ok: false, findings: result.findings };
          return undefined;
        }
        outcome = { ok: true, value: { insertedNodeIds: result.value.insertedNodeIds }, findings: result.findings };
        return { ...result.value.flow, updatedAt: new Date().toISOString() };
      });
      return outcome;
    }
  );

  ipcMain.handle("fragments:delete", async (event, id: string) => {
    await assertSenderPermission(event, Permission.WORKFLOW_DELETE);
    return fragments.delete(id);
  });
}
