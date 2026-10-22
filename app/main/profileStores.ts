import { join } from "node:path";

import { getRuntimePaths } from "./appPaths";
import { getConfiguredPaths } from "./storagePaths";
import type { JsonArrayDataSourceProfile } from "@src/data/DataSourceProfile";
import type { FlowFragment } from "@src/fragments/FlowFragment";
import type { RuntimeInputDefinition } from "@src/data/RuntimeInputDefinition";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import type { WorkflowProfile } from "@src/profiles/WorkflowProfile";
import type { ConcurrentRunReport } from "@src/reports/ExecutionReport";
import { createFlowBaselineHooks } from "@src/runner/visualAssertion/flowBaselineLifecycle";
import { JsonProfileStore } from "@src/storage/ProfileStore";

export interface RuntimeInputProfile {
  id: string;
  name: string;
  definitions: RuntimeInputDefinition[];
}

export interface InstanceProfile {
  id: string;
  name: string;
  maxConcurrentInstances: number;
  headless: boolean;
}

/**
 * Every flow writer goes through this factory, so every flow write (Recorder save, validation repair
 * and restore, AI revert, locator upgrade, fragment instantiation, the flows IPC) carries the N6.3
 * visual-baseline lifecycle hooks and the flows folder's cross-process lock.
 */
export function createFlowProfileStore(): JsonProfileStore<FlowProfile> {
  const folder = getConfiguredPaths().flows;
  return new JsonProfileStore<FlowProfile>({
    folder,
    createClone: (profile, nextId) => ({
      ...profile,
      id: nextId,
      name: `${profile.name} Copy`
    }),
    hooks: createFlowBaselineHooks({ flowsFolder: folder, runtimeRoot: getRuntimePaths().root })
  });
}

/**
 * Reusable fragments and action templates (L6).
 *
 * Under the runtime root rather than `getConfiguredPaths()` because fragments have no Settings
 * path of their own; `JsonProfileStore` creates the folder on demand, so nothing has to be
 * registered at start-up for this to work on a machine that has never had one.
 */
export function createFlowFragmentStore(): JsonProfileStore<FlowFragment> {
  return new JsonProfileStore<FlowFragment>({ folder: join(getRuntimePaths().root, "fragments") });
}

export function createWorkflowProfileStore(): JsonProfileStore<WorkflowProfile> {
  return new JsonProfileStore<WorkflowProfile>({
    folder: getConfiguredPaths().workflows,
    createClone: (profile, nextId) => ({
      ...profile,
      id: nextId,
      name: `${profile.name} Copy`,
      nodes: profile.nodes.map((node) => ({ ...node })),
      edges: profile.edges.map((edge) => ({ ...edge }))
    })
  });
}

export function createDataSourceProfileStore(): JsonProfileStore<JsonArrayDataSourceProfile> {
  return new JsonProfileStore<JsonArrayDataSourceProfile>({
    folder: getConfiguredPaths().dataSources,
    createClone: (profile, nextId) => ({
      ...profile,
      id: nextId,
      name: `${profile.name} Copy`
    })
  });
}

export function createRuntimeInputProfileStore(): JsonProfileStore<RuntimeInputProfile> {
  const paths = getRuntimePaths();
  return new JsonProfileStore<RuntimeInputProfile>({
    folder: paths.folders["runtime-inputs"],
    createClone: (profile, nextId) => ({
      ...profile,
      id: nextId,
      name: `${profile.name} Copy`
    })
  });
}

export function createInstanceProfileStore(): JsonProfileStore<InstanceProfile> {
  const paths = getRuntimePaths();
  return new JsonProfileStore<InstanceProfile>({
    folder: paths.folders.instances,
    createClone: (profile, nextId) => ({
      ...profile,
      id: nextId,
      name: `${profile.name} Copy`
    })
  });
}

export function createReportStore(): JsonProfileStore<ConcurrentRunReport & { id: string }> {
  return new JsonProfileStore<ConcurrentRunReport & { id: string }>({
    folder: getConfiguredPaths().reports
  });
}
