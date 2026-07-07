import crypto from "node:crypto";
import { join } from "node:path";
import type { ConcurrentRunProfile } from "./ConcurrentRunProfile";
import type { InstanceConfig } from "./InstanceConfig";
import type { InstanceRuntimePaths, InstanceRuntimeState } from "./InstanceRuntimeState";
import type { InstanceStatus } from "./InstanceStatus";

/** Effective storage directories for a run (honours user-configured Settings paths). */
export interface StorageDirs {
  /** Base for instance working dirs (instances/storage). */
  root: string;
  downloads: string;
  screenshots: string;
  logs: string;
  reports: string;
}

export class InstanceManager {
  createExecutionId(prefix = "exec"): string {
    return `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
  }

  createInstancesForRun(
    profile: ConcurrentRunProfile,
    rows: unknown[],
    dirs: StorageDirs,
    runtimeInputs: Record<string, unknown> = {}
  ): InstanceRuntimeState[] {
    const executionId = this.createExecutionId(profile.id);
    const total = rows.length;

    return Array.from({ length: total }, (_, index) => {
      // Instance ids must be globally unique across executions — the InstancePool keys by
      // instanceId, so two concurrent workflow runs would otherwise overwrite each other.
      const instanceId = `${executionId}-i${index + 1}`;
      const status: InstanceStatus = index < profile.maxConcurrentInstances ? "pending" : "queued";
      const paths = this.createInstancePaths(dirs, executionId, instanceId, profile.instanceTemplate.isolationMode);
      const config = this.createInstanceConfig(profile, instanceId, index, paths);

      return {
        executionId,
        instanceId,
        scenarioId: profile.scenarioId,
        instanceOrderNumber: index + 1,
        totalInstances: total,
        config,
        status,
        currentFlow: undefined,
        currentStep: status === "queued" ? undefined : "Waiting to start",
        currentDataRowIndex: profile.runMode === "dataDrivenConcurrent" ? index : undefined,
        currentDataRow: profile.runMode === "dataDrivenConcurrent" ? rows[index] : undefined,
        queuePosition: status === "queued" ? index - profile.maxConcurrentInstances + 1 : undefined,
        durationMs: 0,
        retryAttempt: 0,
        paths,
        resourcePolicy: {
          exclusiveAccountKey: config.envFile,
          storageStatePath: config.storageState,
          userDataDir: config.isolationMode === "persistentContext" ? paths.userDataDir : undefined,
          downloadsPath: paths.downloads,
          screenshotsPath: paths.screenshots,
          logsPath: paths.logs
        },
        runtimeInputs,
        instanceInputs: {
          rowIndex: index,
          browserWindowMode: profile.browserWindowMode
        },
        flowOutputs: {}
      };
    });
  }

  pauseInstance(state: InstanceRuntimeState, message?: string): InstanceRuntimeState {
    return {
      ...state,
      status: message ? "waitingForManualAction" : "paused",
      manualHandoff: message ? { message, requestedAt: new Date().toISOString() } : state.manualHandoff
    };
  }

  resumeInstance(state: InstanceRuntimeState): InstanceRuntimeState {
    return {
      ...state,
      status: "running",
      manualHandoff: undefined
    };
  }

  stopInstance(state: InstanceRuntimeState): InstanceRuntimeState {
    return {
      ...state,
      status: "cancelled",
      endedAt: new Date().toISOString()
    };
  }

  private createInstanceConfig(
    profile: ConcurrentRunProfile,
    instanceId: string,
    index: number,
    paths: InstanceRuntimePaths
  ): InstanceConfig {
    return {
      id: instanceId,
      name: `Instance ${index + 1}`,
      browser: profile.instanceTemplate.browser,
      headless: profile.browserWindowMode === "headless" ? true : profile.instanceTemplate.headless,
      isolationMode: profile.instanceTemplate.isolationMode,
      baseUrl: profile.instanceTemplate.baseUrl,
      envFile: profile.instanceTemplate.envFile,
      storageState: profile.instanceTemplate.storageState,
      userDataDir: profile.instanceTemplate.userDataDir ?? paths.userDataDir,
      downloadsPath: paths.downloads,
      screenshotsPath: paths.screenshots,
      logsPath: paths.logs,
      timeoutMs: profile.instanceTemplate.timeoutMs ?? 30000,
      viewport: profile.instanceTemplate.viewport ?? { width: 1440, height: 900 }
    };
  }

  private createInstancePaths(
    dirs: StorageDirs,
    executionId: string,
    instanceId: string,
    isolationMode: InstanceConfig["isolationMode"]
  ): InstanceRuntimePaths {
    const instanceRoot = join(dirs.root, "instances", executionId, instanceId);

    return {
      downloads: join(dirs.downloads, executionId, instanceId),
      screenshots: join(dirs.screenshots, executionId, instanceId),
      logs: join(dirs.logs, executionId, `${instanceId}.jsonl`),
      reports: join(dirs.reports, executionId, `${instanceId}.json`),
      storage: join(instanceRoot, "storage"),
      traces: join(instanceRoot, "traces"),
      userDataDir: isolationMode === "persistentContext" ? join(instanceRoot, "profile") : undefined
    };
  }
}
