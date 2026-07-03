import { join } from "node:path";
import { getResourcesRoot, getRuntimePaths } from "./appPaths";
import { getConfiguredPaths } from "./storagePaths";
import type { JsonArrayDataSourceProfile } from "@src/data/DataSourceProfile";
import type { RuntimeInputDefinition } from "@src/data/RuntimeInputDefinition";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import type { WorkflowProfile } from "@src/profiles/WorkflowProfile";
import type { ConcurrentRunReport } from "@src/reports/ExecutionReport";
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

export function createFlowProfileStore(): JsonProfileStore<FlowProfile> {
  return new JsonProfileStore<FlowProfile>({
    folder: getConfiguredPaths().flows,
    seedFolder: join(getResourcesRoot(), "sample-flows"),
    createClone: (profile, nextId) => ({
      ...profile,
      id: nextId,
      name: `${profile.name} Copy`
    })
  });
}

export function createWorkflowProfileStore(): JsonProfileStore<WorkflowProfile> {
  return new JsonProfileStore<WorkflowProfile>({
    folder: getConfiguredPaths().workflows,
    seedFolder: join(getResourcesRoot(), "sample-workflows"),
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
