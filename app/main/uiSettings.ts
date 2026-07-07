import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getRuntimePaths } from "./appPaths";

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
    captureSmartWaits: true
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
    recorder: { ...defaultSettings.recorder, ...parsed.recorder },
    workflowBuilder: { ...defaultSettings.workflowBuilder, ...parsed.workflowBuilder },
    instanceRunSettings: { ...defaultSettings.instanceRunSettings, ...parsed.instanceRunSettings },
    app: { ...defaultSettings.app, ...parsed.app },
    selections: { ...defaultSettings.selections, ...parsed.selections },
    designerDefaults: { ...defaultSettings.designerDefaults, ...parsed.designerDefaults },
    execution: { ...defaultSettings.execution, ...parsed.execution },
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
    recorder: { ...current.recorder, ...patch.recorder },
    workflowBuilder: { ...current.workflowBuilder, ...patch.workflowBuilder },
    instanceRunSettings: { ...current.instanceRunSettings, ...patch.instanceRunSettings },
    app: { ...current.app, ...patch.app },
    selections: { ...current.selections, ...patch.selections },
    designerDefaults: { ...current.designerDefaults, ...patch.designerDefaults },
    execution: { ...current.execution, ...patch.execution },
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

export async function updateUiSettings(patch: DeepPartial<UiSettings>): Promise<UiSettings> {
  const next = mergePatch(await getUiSettings(), patch);
  await writeSettings(next);
  return next;
}

/** Restore all settings to defaults (keeps the just-set launch time). */
export async function resetUiSettings(): Promise<UiSettings> {
  const next = hydrate({ app: { lastLaunchedAt: new Date().toISOString() } });
  await writeSettings(next);
  return next;
}

/** Reset only layout/UI state. Does NOT touch flows, workflows, reports, paths, or execution defaults. */
export async function clearUiState(): Promise<UiSettings> {
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
}

/** Validate and replace the entire settings document (used by Import). */
export async function replaceUiSettings(incoming: unknown): Promise<UiSettings> {
  if (!incoming || typeof incoming !== "object") {
    throw new Error("Invalid settings file: expected a JSON object.");
  }
  const next = hydrate(incoming as Partial<UiSettings>);
  const errors = validateSettings(next);
  if (errors.length) throw new Error(`Settings failed validation: ${errors.join(" ")}`);
  await writeSettings(next);
  return next;
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

  for (const [key, value] of Object.entries(settings.paths)) {
    if (!value || !String(value).trim()) errors.push(`Path "${key}" must not be empty.`);
  }
  return errors;
}

async function writeSettings(settings: UiSettings): Promise<void> {
  const path = getSettingsPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function getSettingsPath(): string {
  return join(getRuntimePaths().folders.storage, "ui-settings.json");
}
