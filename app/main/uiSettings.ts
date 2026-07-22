import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getRuntimePaths } from "./appPaths";
import { createSerialQueue } from "./writeQueue";

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export interface TableState {
  page: number;
  pageSize: number;
  searchText: string;
  sortBy: string | null;
  sortDirection: "asc" | "desc";
  filters: Record<string, unknown>;
}

/** UI theme preference. "system" follows the OS prefers-color-scheme. */
export type AppearanceMode = "light" | "dark" | "system";

export interface UiSettings {
  // ── Core layout (existing flat fields, kept for backward compatibility) ──────
  sidebarCollapsed: boolean;
  lastRouteId: string;
  /** Theme appearance; defaults to "light" for backward compatibility. */
  appearance: AppearanceMode;
  flowDesignerPaletteWidth: number;
  flowDesignerPropertiesCollapsed: boolean;
  /** Persisted key: ui.flowDesigner.nodePaletteCollapsed */
  flowDesignerPaletteCollapsed: boolean;
  /** Current canvas zoom (percent) per designer, restored on revisit. */
  flowDesignerZoomPercent: number;
  workflowBuilderZoomPercent: number;
  selectedBuilderWorkflowId: string;
  workflowBuilder: {
    selectedConnectorCollapsed: boolean;
    workflowDataSourceCollapsed: boolean;
    leftPanelCollapsed: boolean;
    leftPanelWidth: number;
  };
  /** Recorder preferences that persist across sessions. */
  recorder: {
    /** Capture the user's think-time between actions as fixed-time wait steps. */
    captureWaitTime: boolean;
    /** Observe page/network signals and attach condition-based Smart Waits to recorded actions. */
    captureSmartWaits: boolean;
    /**
     * When true, the Recorder does not automatically pause on a detected protected login / SSO page /
     * protected popup. This ONLY changes AWKIT's pause/observation behavior — it never bypasses
     * authentication, CAPTCHA, MFA, SSO, or browser security. The user still completes any real login
     * manually. Default false. Use only for authorized apps where detection is a false positive.
     */
    ignoreProtectedLoginDetection: boolean;
    /**
     * Async Activity Awareness tuning. Controls how the Recorder proposes condition-based waits
     * (Smart Waits) for the asynchronous work an action triggers. Additive + backward-compatible.
     */
    asyncAwareness: {
      /** Master switch for async-awareness enhancements (adaptive timeouts today). */
      enabled: boolean;
      /** Derive a bounded per-wait timeout from the observed duration instead of the flat runner default. */
      adaptiveTimeouts: boolean;
      /** Lower bound (ms) for an adaptive timeout. */
      minimumTimeoutMs: number;
      /** Hard upper bound (ms) for an adaptive timeout — never exceeded. */
      maximumTimeoutMs: number;
      /** Grace (ms) for a recorded loader to (re)appear on replay before it is treated as absent. */
      loaderAppearanceGraceMs: number;
    };
  };
  /** Last run settings (what the user last launched). */
  instanceRunSettings: {
    workflowId: string;
    totalRuns: number;
    maxConcurrentInstances: number;
    browserMode: "headless" | "headed";
    delayBetweenStartsMs: number;
  };

  // ── Phase 2 additions ────────────────────────────────────────────────────────
  app: { lastLaunchedAt: string | null };
  selections: {
    lastSelectedFlowId: string | null;
    lastSelectedWorkflowId: string | null;
    lastSelectedNodeId: string | null;
    lastSelectedConnectorId: string | null;
    lastSelectedDataSourceId: string | null;
  };
  designerDefaults: {
    defaultZoomPercent: number;
    defaultNodeWidth: number;
    defaultNodeHeight: number;
    nodePaletteCollapsed: boolean;
    nodePropertiesCollapsed: boolean;
    workflowDefinitionWidth: number;
    workflowDataSourceCollapsed: boolean;
    selectedConnectorCollapsed: boolean;
  };
  /** Default run settings (seed values for new runs). */
  execution: {
    maxRuns: number;
    maxConcurrentRuns: number;
    defaultRuns: number;
    defaultConcurrentRuns: number;
    defaultRunMode: "headed" | "headless";
    screenshotOnFailure: boolean;
    stopOnError: boolean;
  };
  /** Host concurrency caps for the browser runtime (mirror ConcurrencyConfig; applied to the engine
   *  at startup, whenever settings are saved, and at each run start). Replace the env-only defaults.
   *  Machine-agnostic: `auto` derives caps from the detected host; `manual` uses the explicit numbers;
   *  `sequential` pins to one active instance. See CONCURRENCY_CAPACITY_AND_REPORTS_PLAN.md §A4. */
  runtime: {
    /** Capacity mode. `manual` is the back-compat default (uses maxBrowsers/maxActiveFlows verbatim). */
    capacityMode: "sequential" | "auto" | "manual";
    /** Manual mode: max simultaneously-open browsers (ConcurrencyLimits.maxBrowsersPerHost). */
    maxBrowsers: number;
    /** Manual mode: max concurrently-running flows admitted (ConcurrencyLimits.maxActiveFlows). */
    maxActiveFlows: number;
    /** Auto mode: workflow class used to estimate per-instance cost. */
    workloadClass: "light" | "medium" | "heavy" | "custom";
    /** Hard administrator cap enforced in every mode (null = unset). */
    administratorMaximumConcurrency: number | null;
    /** Absolute safety ceiling — never exceeded by any mode, including Manual. */
    absoluteSafetyMaximum: number;
    /** Auto: fraction applied when turning the detected estimate into a conservative recommendation. */
    capacitySafetyFactor: number;
    /** Auto: logical cores reserved for the OS/AWKIT before estimating CPU capacity. */
    reservedLogicalCpuCount: number;
  };
  /** Per-workflow run-card parameters (Concurrent Instance Monitor). Keyed by workflow id. */
  workflowRunCards: Record<
    string,
    {
      totalRuns: number;
      concurrentInstances: number;
      runMode: "headed" | "headless";
      isolationMode: "browserContext" | "persistentContext";
      screenshotOnFailure: boolean;
      stopOnError: boolean;
    }
  >;
  paths: {
    screenshotsPath: string;
    flowsPath: string;
    workflowsPath: string;
    dataSourcesPath: string;
    reportsPath: string;
    logsPath: string;
    downloadsPath: string;
  };
  tables: { flows: TableState; workflows: TableState };
}

const defaultTableState: TableState = {
  page: 1,
  pageSize: 10,
  searchText: "",
  sortBy: null,
  sortDirection: "asc",
  filters: {}
};

const defaultSettings: UiSettings = {
  sidebarCollapsed: false,
  lastRouteId: "dashboard",
  appearance: "light",
  flowDesignerPaletteWidth: 224,
  flowDesignerPropertiesCollapsed: false,
  flowDesignerPaletteCollapsed: false,
  // 0 means "unset" → fall back to designerDefaults.defaultZoomPercent for new sessions.
  flowDesignerZoomPercent: 0,
  workflowBuilderZoomPercent: 0,
  selectedBuilderWorkflowId: "",
  recorder: {
    captureWaitTime: false,
    captureSmartWaits: true,
    ignoreProtectedLoginDetection: false,
    asyncAwareness: {
      enabled: true,
      adaptiveTimeouts: true,
      minimumTimeoutMs: 10_000,
      maximumTimeoutMs: 300_000,
      loaderAppearanceGraceMs: 1_500
    }
  },
  workflowBuilder: {
    selectedConnectorCollapsed: false,
    workflowDataSourceCollapsed: false,
    leftPanelCollapsed: false,
    leftPanelWidth: 360
  },
  instanceRunSettings: {
    workflowId: "",
    totalRuns: 5,
    maxConcurrentInstances: 3,
    browserMode: "headless",
    delayBetweenStartsMs: 250
  },
  app: { lastLaunchedAt: null },
  selections: {
    lastSelectedFlowId: null,
    lastSelectedWorkflowId: null,
    lastSelectedNodeId: null,
    lastSelectedConnectorId: null,
    lastSelectedDataSourceId: null
  },
  designerDefaults: {
    defaultZoomPercent: 100,
    defaultNodeWidth: 220,
    defaultNodeHeight: 96,
    nodePaletteCollapsed: false,
    nodePropertiesCollapsed: false,
    workflowDefinitionWidth: 360,
    workflowDataSourceCollapsed: false,
    selectedConnectorCollapsed: false
  },
  execution: {
    maxRuns: 100,
    maxConcurrentRuns: 10,
    defaultRuns: 5,
    defaultConcurrentRuns: 3,
    defaultRunMode: "headless",
    screenshotOnFailure: true,
    stopOnError: false
  },
  runtime: {
    capacityMode: "manual",
    maxBrowsers: 2,
    maxActiveFlows: 4,
    workloadClass: "medium",
    administratorMaximumConcurrency: null,
    absoluteSafetyMaximum: 64,
    capacitySafetyFactor: 0.75,
    reservedLogicalCpuCount: 1
  },
  workflowRunCards: {},
  paths: {
    screenshotsPath: "",
    flowsPath: "",
    workflowsPath: "",
    dataSourcesPath: "",
    reportsPath: "",
    logsPath: "",
    downloadsPath: ""
  },
  tables: { flows: { ...defaultTableState }, workflows: { ...defaultTableState } }
};

/** Default runtime-folder paths used when a path setting is left empty. */
export function getDefaultPaths(): UiSettings["paths"] {
  const folders = getRuntimePaths().folders;
  return {
    screenshotsPath: folders.screenshots,
    flowsPath: folders.flows,
    workflowsPath: folders.workflows,
    dataSourcesPath: folders.data,
    reportsPath: folders.reports,
    logsPath: folders.logs,
    downloadsPath: folders.downloads
  };
}

/** Fill any empty path with its runtime-folder default. */
function resolvePathDefaults(settings: UiSettings): UiSettings {
  const defaults = getDefaultPaths();
  for (const key of Object.keys(defaults) as (keyof UiSettings["paths"])[]) {
    if (!settings.paths[key]) settings.paths[key] = defaults[key];
  }
  return settings;
}

/** Merge a parsed/partial object over defaults so new fields always exist. */
function hydrate(parsed: Partial<UiSettings>): UiSettings {
  const merged: UiSettings = {
    ...defaultSettings,
    ...parsed,
    recorder: {
      ...defaultSettings.recorder,
      ...parsed.recorder,
      // Deep-merge the nested async block so a partial saved value never drops sibling fields.
      asyncAwareness: { ...defaultSettings.recorder.asyncAwareness, ...parsed.recorder?.asyncAwareness }
    },
    workflowBuilder: { ...defaultSettings.workflowBuilder, ...parsed.workflowBuilder },
    instanceRunSettings: { ...defaultSettings.instanceRunSettings, ...parsed.instanceRunSettings },
    app: { ...defaultSettings.app, ...parsed.app },
    selections: { ...defaultSettings.selections, ...parsed.selections },
    designerDefaults: { ...defaultSettings.designerDefaults, ...parsed.designerDefaults },
    execution: { ...defaultSettings.execution, ...parsed.execution },
    runtime: { ...defaultSettings.runtime, ...parsed.runtime },
    workflowRunCards: { ...defaultSettings.workflowRunCards, ...parsed.workflowRunCards },
    paths: { ...defaultSettings.paths, ...parsed.paths },
    tables: {
      flows: { ...defaultTableState, ...parsed.tables?.flows },
      workflows: { ...defaultTableState, ...parsed.tables?.workflows }
    }
  };
  return resolvePathDefaults(merged);
}

/** Apply a partial patch over the current settings, deep-merging known groups. */
function mergePatch(current: UiSettings, patch: DeepPartial<UiSettings>): UiSettings {
  return {
    ...current,
    ...patch,
    recorder: {
      ...current.recorder,
      ...patch.recorder,
      asyncAwareness: { ...current.recorder.asyncAwareness, ...patch.recorder?.asyncAwareness }
    },
    workflowBuilder: { ...current.workflowBuilder, ...patch.workflowBuilder },
    instanceRunSettings: { ...current.instanceRunSettings, ...patch.instanceRunSettings },
    app: { ...current.app, ...patch.app },
    selections: { ...current.selections, ...patch.selections },
    designerDefaults: { ...current.designerDefaults, ...patch.designerDefaults },
    execution: { ...current.execution, ...patch.execution },
    runtime: { ...current.runtime, ...patch.runtime },
    workflowRunCards: { ...current.workflowRunCards, ...patch.workflowRunCards } as UiSettings["workflowRunCards"],
    paths: { ...current.paths, ...patch.paths },
    tables: {
      flows: { ...current.tables.flows, ...patch.tables?.flows },
      workflows: { ...current.tables.workflows, ...patch.tables?.workflows }
    }
  };
}

export async function getUiSettings(): Promise<UiSettings> {
  try {
    return hydrate(JSON.parse(await readFile(getSettingsPath(), "utf8")));
  } catch {
    return hydrate({});
  }
}

/**
 * Serializes all settings mutations. The renderer fires many fire-and-forget
 * `settings.update` calls in quick succession (one per node/edge selection, zoom
 * step, panel toggle, …). Each mutation is a read-modify-write of the whole
 * `ui-settings.json`; running them concurrently races (last-write-wins) and can
 * silently drop patches, as well as overlap file writes. The serial queue makes every
 * read-modify-write atomic and every write sequential; a failed task never breaks the
 * chain for the next one. `flushSettingsWrites()` lets the app wait for pending writes on
 * shutdown so a last-moment edit is not lost.
 */
const settingsQueue = createSerialQueue();
function enqueueSettingsWrite<T>(task: () => Promise<T>): Promise<T> {
  return settingsQueue.run(task);
}

/**
 * Await all settings writes queued so far. Called on Electron `before-quit` so the last
 * fire-and-forget `settings.update` is flushed to disk before the process exits. Never
 * rejects (individual failures are already isolated) so it can't deadlock shutdown.
 */
export function flushSettingsWrites(): Promise<void> {
  return settingsQueue.flush();
}

/** Pending settings-write count (diagnostics). */
export function pendingSettingsWrites(): number {
  return settingsQueue.size;
}

export async function updateUiSettings(patch: DeepPartial<UiSettings>): Promise<UiSettings> {
  return enqueueSettingsWrite(async () => {
    const next = mergePatch(await getUiSettings(), patch);
    await writeSettings(next);
    return next;
  });
}

/** Restore all settings to defaults (keeps the just-set launch time). */
export async function resetUiSettings(): Promise<UiSettings> {
  return enqueueSettingsWrite(async () => {
    const next = hydrate({ app: { lastLaunchedAt: new Date().toISOString() } });
    await writeSettings(next);
    return next;
  });
}

/** Reset only layout/UI state. Does NOT touch flows, workflows, reports, paths, or execution defaults. */
export async function clearUiState(): Promise<UiSettings> {
  return enqueueSettingsWrite(async () => {
  const current = await getUiSettings();
  const next: UiSettings = {
    ...current,
    sidebarCollapsed: defaultSettings.sidebarCollapsed,
    lastRouteId: defaultSettings.lastRouteId,
    selectedBuilderWorkflowId: "",
    flowDesignerPaletteWidth: defaultSettings.flowDesignerPaletteWidth,
    flowDesignerPropertiesCollapsed: defaultSettings.flowDesignerPropertiesCollapsed,
    flowDesignerPaletteCollapsed: defaultSettings.flowDesignerPaletteCollapsed,
    workflowBuilder: { ...defaultSettings.workflowBuilder },
    selections: { ...defaultSettings.selections },
    tables: { flows: { ...defaultTableState }, workflows: { ...defaultTableState } }
  };
    await writeSettings(next);
    return next;
  });
}

/** Validate and replace the entire settings document (used by Import). */
export async function replaceUiSettings(incoming: unknown): Promise<UiSettings> {
  if (!incoming || typeof incoming !== "object") {
    throw new Error("Invalid settings file: expected a JSON object.");
  }
  return enqueueSettingsWrite(async () => {
    const next = hydrate(incoming as Partial<UiSettings>);
    const errors = validateSettings(next);
    if (errors.length) throw new Error(`Settings failed validation: ${errors.join(" ")}`);
    await writeSettings(next);
    return next;
  });
}

/** Returns a list of human-readable validation errors (empty when valid). */
export function validateSettings(settings: UiSettings): string[] {
  const errors: string[] = [];
  const d = settings.designerDefaults;
  const e = settings.execution;

  if (!(d.defaultZoomPercent >= 25 && d.defaultZoomPercent <= 200)) {
    errors.push("Default zoom must be between 25 and 200.");
  }
  if (!(d.defaultNodeWidth > 0)) errors.push("Default node width must be a positive value.");
  if (!(d.defaultNodeHeight > 0)) errors.push("Default node height must be a positive value.");

  const positives: [number, string][] = [
    [e.maxRuns, "Maximum runs"],
    [e.maxConcurrentRuns, "Maximum concurrent runs"],
    [e.defaultRuns, "Default runs"],
    [e.defaultConcurrentRuns, "Default concurrent runs"]
  ];
  for (const [value, label] of positives) {
    if (!Number.isInteger(value) || value < 1) errors.push(`${label} must be a positive integer.`);
  }
  if (e.defaultRuns > e.maxRuns) errors.push("Default runs cannot exceed maximum runs.");
  if (e.defaultConcurrentRuns > e.maxConcurrentRuns) errors.push("Default concurrent runs cannot exceed maximum concurrent runs.");
  if (e.defaultConcurrentRuns > e.defaultRuns) errors.push("Default concurrent runs cannot exceed default runs.");
  if (e.maxConcurrentRuns > e.maxRuns) errors.push("Maximum concurrent runs cannot exceed maximum runs.");

  const r = settings.runtime;
  if (!["sequential", "auto", "manual"].includes(r.capacityMode)) {
    errors.push("Capacity mode must be sequential, auto, or manual.");
  }
  if (!["light", "medium", "heavy", "custom"].includes(r.workloadClass)) {
    errors.push("Workload class must be light, medium, heavy, or custom.");
  }
  if (!Number.isInteger(r.maxBrowsers) || r.maxBrowsers < 1 || r.maxBrowsers > 16) {
    errors.push("Max browsers must be an integer between 1 and 16.");
  }
  if (!Number.isInteger(r.maxActiveFlows) || r.maxActiveFlows < 1 || r.maxActiveFlows > 64) {
    errors.push("Max active flows must be an integer between 1 and 64.");
  }
  if (!Number.isInteger(r.absoluteSafetyMaximum) || r.absoluteSafetyMaximum < 1 || r.absoluteSafetyMaximum > 256) {
    errors.push("Absolute safety maximum must be an integer between 1 and 256.");
  }
  if (!(typeof r.capacitySafetyFactor === "number" && r.capacitySafetyFactor >= 0.1 && r.capacitySafetyFactor <= 1)) {
    errors.push("Capacity safety factor must be between 0.1 and 1.");
  }
  if (!Number.isInteger(r.reservedLogicalCpuCount) || r.reservedLogicalCpuCount < 0 || r.reservedLogicalCpuCount > 64) {
    errors.push("Reserved logical CPU count must be an integer between 0 and 64.");
  }
  if (r.administratorMaximumConcurrency !== null && (!Number.isInteger(r.administratorMaximumConcurrency) || r.administratorMaximumConcurrency < 1)) {
    errors.push("Administrator maximum concurrency must be a positive integer or unset.");
  }

  const aa = settings.recorder.asyncAwareness;
  if (!Number.isInteger(aa.minimumTimeoutMs) || aa.minimumTimeoutMs < 1000 || aa.minimumTimeoutMs > 600_000) {
    errors.push("Recorder async minimum timeout must be an integer between 1000 and 600000 ms.");
  }
  if (!Number.isInteger(aa.maximumTimeoutMs) || aa.maximumTimeoutMs < 1000 || aa.maximumTimeoutMs > 600_000) {
    errors.push("Recorder async maximum timeout must be an integer between 1000 and 600000 ms (no unlimited timeout).");
  }
  if (aa.minimumTimeoutMs > aa.maximumTimeoutMs) {
    errors.push("Recorder async minimum timeout cannot exceed the maximum timeout.");
  }
  if (!Number.isInteger(aa.loaderAppearanceGraceMs) || aa.loaderAppearanceGraceMs < 0 || aa.loaderAppearanceGraceMs > 60_000) {
    errors.push("Recorder loader appearance grace must be an integer between 0 and 60000 ms.");
  }

  for (const [key, value] of Object.entries(settings.paths)) {
    if (!value || !String(value).trim()) errors.push(`Path "${key}" must not be empty.`);
  }
  return errors;
}

async function writeSettings(settings: UiSettings): Promise<void> {
  const path = getSettingsPath();
  await mkdir(dirname(path), { recursive: true });
  // Atomic write: serialize to a temp file in the same directory, then rename over the target.
  // libuv's rename replaces the destination atomically on Windows (MOVEFILE_REPLACE_EXISTING),
  // so a crash or power loss mid-write can never leave a half-written / truncated ui-settings.json.
  // Writes are already serialized through `settingsQueue`, so the temp name only needs to be
  // unique per process. On rename failure the temp file is cleaned up so it can't accumulate.
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  try {
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

function getSettingsPath(): string {
  return join(getRuntimePaths().folders.storage, "ui-settings.json");
}
