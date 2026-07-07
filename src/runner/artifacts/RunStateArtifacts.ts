/**
 * End-of-run state artifacts. Written next to the instance's other run data so a failed run
 * is debuggable from disk: final flow state (with every recorded transition), per-node
 * attempts, the capacity snapshot at completion, and the lock table at completion.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CapacitySnapshot } from "../concurrency/CapacitySnapshot";
import type { LockSnapshotEntry } from "../concurrency/ResourceLockManager";
import type { NodeAttempt } from "../runtime/NodeAttempt";
import type { FlowRunStatus, FlowRunTransition } from "../runtime/RuntimeStateMachine";

export interface RunStateArtifactInput {
  runId: string;
  instanceId: string;
  scenarioId?: string;
  flowRunStatus: FlowRunStatus;
  transitions: FlowRunTransition[];
  nodeAttempts: NodeAttempt[];
  capacity?: CapacitySnapshot;
  locks?: LockSnapshotEntry[];
  error?: string;
}

/** Writes state artifacts under `<stateDir>`; failures are returned, never thrown. */
export async function writeRunStateArtifacts(stateDir: string, input: RunStateArtifactInput): Promise<string | undefined> {
  try {
    await mkdir(stateDir, { recursive: true });
    const write = (name: string, value: unknown) =>
      writeFile(join(stateDir, name), JSON.stringify(value, null, 2), "utf8");

    await Promise.all([
      write("flow-state.json", {
        runId: input.runId,
        instanceId: input.instanceId,
        scenarioId: input.scenarioId,
        status: input.flowRunStatus,
        error: input.error,
        transitions: input.transitions,
        writtenAt: new Date().toISOString()
      }),
      write("node-attempts.json", input.nodeAttempts),
      input.capacity ? write("capacity.json", input.capacity) : Promise.resolve(),
      input.locks ? write("locks.json", input.locks) : Promise.resolve()
    ]);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
