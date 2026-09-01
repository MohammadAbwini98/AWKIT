import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getRuntimePaths } from "./appPaths";
import { replaceFileAtomically } from "./atomicReplace";
import { createSerialQueue } from "./writeQueue";
import {
  DEFAULT_ACCENT_SETTINGS,
  normalizeAccentColor,
  normalizeAccentSettings,
  type AccentSettings
} from "@src/theme/accentColor";
import {
  DEFAULT_RECORDER_SECURITY_SETTINGS,
  normalizeRecorderSecuritySettings,
  type RecorderSecuritySettings
} from "@src/security/browser/CertificateTrust";
import { SEMANTIC_DEFAULT_TOP_K, SEMANTIC_MAX_TOP_K } from "@src/semantic/contracts/SemanticDocument";
import {
  DEFAULT_SESSION_INACTIVITY_MINUTES,
  MAX_SESSION_INACTIVITY_MINUTES,
  MIN_SESSION_INACTIVITY_MINUTES,
  isValidSessionInactivityMinutes
} from "@src/security/session/SessionPolicy";

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

/** Locator generator used for element actions captured after the preference is applied. */
export type LocatorRecordingMode = "default" | "xpath";

export interface UiSettings {
  // ── Core layout (existing flat fields, kept for backward compatibility) ──────
  sidebarCollapsed: boolean;
  lastRouteId: string;
  /** Theme appearance; defaults to "light" for backward compatibility. */
  appearance: AppearanceMode;
  /**
   * Application accent (brand) color customization. Solid or two-color gradient; `primaryColor === null`
   * (solid) means the built-in default purple. All other shades/gradient stops are derived at runtime;
   * status colors are never affected. Legacy `{ color }` values migrate to `{ mode:"solid", primaryColor }`.
   */
  accent: AccentSettings;
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
    /** Existing resilient generation remains the default; XPath affects only later captures. */
    locatorRecordingMode: LocatorRecordingMode;
    /** Capture the user's think-time between actions as fixed-time wait steps. */
    captureWaitTime: boolean;
    /** Observe page/network signals and attach condition-based Smart Waits to recorded actions. */
    captureSmartWaits: boolean;
    /**
     * Recorder + execution security. Separate group because these are privileged toggles: unlike the
     * capture switches (written implicitly from the Recorder page by any role), a patch touching this
     * group requires SETTINGS_EDIT (see settings.ipc). Absent in settings files written before the
     * feature existed — `hydrate` fills the secure defaults.
     */
    security: RecorderSecuritySettings;
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
  /**
   * Optional semantic index (Zvec). `enabled` is the user-facing master switch that
   * `semanticHealth({ enabledBySetting })` reports against — before this group existed that argument
   * was hardcoded true, so the reported reason could never say "turned off by the user".
   *
   * Turning it off does NOT delete the index; clearing is a separate, permission-gated action.
   */
  semantic: {
    enabled: boolean;
    /** Default result count for a search that does not specify one. Bounded by SEMANTIC_MAX_TOP_K. */
    defaultTopK: number;
    /**
     * Index each run as it finishes, instead of only when a rebuild runs. Separate from `enabled` on
     * purpose: `enabled` decides whether semantic search exists at all, this decides whether the
     * index stays fresh without being asked. Off is a supported state — records are still written,
     * they are simply indexed by the next rebuild rather than immediately.
     */
    autoIndex: boolean;
  };
  /** Privileged application policy. Every mutation is enforced in main, not trusted to the renderer. */
  superUser: {
    /** Optional structured diagnostic logging; mandatory audit trails are independent. */
    debugMode: boolean;
    /** Sliding application-session inactivity timeout, in whole minutes. */
    sessionInactivityMinutes: number;
    /** Optional browser distribution for authorized Recorder and Runner launches. */
    chrome: {
      mode: "bundledChromium" | "installedChrome";
      /** Explicit Google Chrome executable override; empty means safe platform discovery. */
      executablePath: string;
    };
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
  accent: { ...DEFAULT_ACCENT_SETTINGS },
  flowDesignerPaletteWidth: 224,
  flowDesignerPropertiesCollapsed: false,
  flowDesignerPaletteCollapsed: false,
  // 0 means "unset" → fall back to designerDefaults.defaultZoomPercent for new sessions.
  flowDesignerZoomPercent: 0,
  workflowBuilderZoomPercent: 0,
  selectedBuilderWorkflowId: "",
  recorder: {
    locatorRecordingMode: "default",
    captureWaitTime: false,
    captureSmartWaits: true,
    security: { ...DEFAULT_RECORDER_SECURITY_SETTINGS },
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
  semantic: {
    // Default ON: the subsystem is already lazy (no host process until a semantic operation runs), so
    // defaulting off would hide a feature behind a switch nobody knows to look for.
    enabled: true,
    defaultTopK: SEMANTIC_DEFAULT_TOP_K,
    // Default ON, and the MIGRATION for existing installs is this default plus the merge order in
    // `hydrate` (`{ ...defaultSettings.semantic, ...parsed.semantic }` — defaults first). A settings
    // file written before this key existed therefore hydrates to `true` with no migration code.
    // `verify:semantic-store` pins that, because the guarantee otherwise rests on a merge direction
    // nobody is watching.
    autoIndex: true
  },
  superUser: {
    debugMode: false,
    sessionInactivityMinutes: DEFAULT_SESSION_INACTIVITY_MINUTES,
    chrome: {
      mode: "bundledChromium",
      executablePath: ""
    }
  },
  tables: { flows: { ...defaultTableState }, workflows: { ...defaultTableState } }
};

function retainKnownKeys(target: unknown, template: Record<string, unknown>): void {
  if (!target || typeof target !== "object" || Array.isArray(target)) return;
  const record = target as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(key in template)) delete record[key];
  }
}

/**
 * Imported and persisted JSON is untrusted. Hydration fills defaults, but object spreads alone also
 * preserve typo/future keys forever. Drop unknown fixed-schema keys while retaining the two dynamic
 * maps (`workflowRunCards` and table `filters`).
 */
function pruneUnknownSettings(settings: UiSettings): UiSettings {
  retainKnownKeys(settings, defaultSettings as unknown as Record<string, unknown>);
  for (const key of [
    "workflowBuilder",
    "instanceRunSettings",
    "app",
    "selections",
    "designerDefaults",
    "execution",
    "runtime",
    "paths",
    "semantic",
    "superUser"
  ] as const) {
    retainKnownKeys(settings[key], defaultSettings[key] as unknown as Record<string, unknown>);
  }
  retainKnownKeys(settings.recorder, defaultSettings.recorder as unknown as Record<string, unknown>);
  retainKnownKeys(settings.superUser.chrome, defaultSettings.superUser.chrome as unknown as Record<string, unknown>);
  retainKnownKeys(
    settings.recorder.security,
    defaultSettings.recorder.security as unknown as Record<string, unknown>
  );
  retainKnownKeys(
    settings.recorder.asyncAwareness,
    defaultSettings.recorder.asyncAwareness as unknown as Record<string, unknown>
  );
  retainKnownKeys(settings.tables, defaultSettings.tables as unknown as Record<string, unknown>);
  retainKnownKeys(settings.tables.flows, defaultTableState as unknown as Record<string, unknown>);
  retainKnownKeys(settings.tables.workflows, defaultTableState as unknown as Record<string, unknown>);
  return settings;
}

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

/**
 * Normalize an accent group (or accent patch merged over the current value) into a valid `AccentSettings`.
 * Delegates to the pure `normalizeAccentSettings`, which also migrates the legacy `{ color }` shape and
 * falls back to the default-purple solid state on any malformed/missing value — so a corrupted persisted
 * value or a bad patch can never poison the store.
 */
function sanitizeAccent(value: unknown): AccentSettings {
  return normalizeAccentSettings(value);
}

/** Merge a parsed/partial object over defaults so new fields always exist. */
function hydrate(parsed: Partial<UiSettings>): UiSettings {
  const merged: UiSettings = {
    ...defaultSettings,
    ...parsed,
    accent: sanitizeAccent(parsed.accent),
    recorder: {
      ...defaultSettings.recorder,
      ...parsed.recorder,
      locatorRecordingMode: parsed.recorder?.locatorRecordingMode === "xpath" ? "xpath" : "default",
      // `security` is nested one level deeper than the other recorder keys, so it needs its own
      // normalization: a settings file predating this feature has no `security` key at all, and a
      // hand-edited/corrupt one must fall back to validation-ON rather than inheriting a junk value.
      security: normalizeRecorderSecuritySettings(parsed.recorder?.security),
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
    semantic: { ...defaultSettings.semantic, ...parsed.semantic },
    superUser: {
      ...defaultSettings.superUser,
      ...parsed.superUser,
      chrome: { ...defaultSettings.superUser.chrome, ...parsed.superUser?.chrome }
    },
    tables: {
      flows: { ...defaultTableState, ...parsed.tables?.flows },
      workflows: { ...defaultTableState, ...parsed.tables?.workflows }
    }
  };
  return pruneUnknownSettings(resolvePathDefaults(merged));
}

/** Apply a partial patch over the current settings, deep-merging known groups. */
function mergePatch(current: UiSettings, patch: DeepPartial<UiSettings>): UiSettings {
  return {
    ...current,
    ...patch,
    accent: patch.accent === undefined ? current.accent : sanitizeAccent({ ...current.accent, ...patch.accent }),
    recorder: {
      ...current.recorder,
      ...patch.recorder,
      // Deep-merge + re-normalize `security` so a partial patch (`{ recorder: { security: { … } } }`)
      // can't drop sibling security keys or write a non-boolean into the store.
      security: normalizeRecorderSecuritySettings({ ...current.recorder.security, ...patch.recorder?.security }),
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
    semantic: { ...current.semantic, ...patch.semantic },
    superUser: {
      ...current.superUser,
      ...patch.superUser,
      chrome: { ...current.superUser.chrome, ...patch.superUser?.chrome }
    },
    tables: {
      flows: { ...current.tables.flows, ...patch.tables?.flows },
      workflows: { ...current.tables.workflows, ...patch.tables?.workflows }
    }
  };
}

export async function getUiSettings(): Promise<UiSettings> {
  let raw: string;
  try {
    raw = await readFile(getSettingsPath(), "utf8");
  } catch (error) {
    // AWKIT-SET-007: a MISSING file is a normal first launch. Any OTHER read failure is logged
    // loudly — it is not silently treated as factory defaults.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`[ui-settings] Could not read ${getSettingsPath()}: ${(error as Error).message}`);
    }
    return hydrate({});
  }
  try {
    return hydrate(JSON.parse(raw));
  } catch (error) {
    // AWKIT-SET-007: a corrupt settings file is NOT silently replaced by defaults. Quarantine
    // the bytes (JsonProfileStore.quarantineCorrupt pattern) so custom storage paths, capacity
    // caps, recorder security toggles and super-user policy survive for recovery; this process
    // runs on defaults and the next write creates a fresh file WITHOUT destroying the original.
    const source = getSettingsPath();
    const target = `${source}.corrupt-${Date.now()}`;
    try {
      await rename(source, target);
      console.error(
        `[ui-settings] ${source} is not valid JSON; preserved as ${target} so settings are not lost. ` +
          `Parse error: ${(error as Error).message}`
      );
    } catch (renameError) {
      console.error(
        `[ui-settings] ${source} is not valid JSON and could not be quarantined ` +
          `(${(renameError as Error).message}); left in place. Parse error: ${(error as Error).message}`
      );
    }
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
    const errors = validateSettings(next);
    if (errors.length) throw new Error(`Settings failed validation: ${errors.join(" ")}`);
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
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    throw new Error("Invalid settings file: expected a JSON object.");
  }
  return enqueueSettingsWrite(async () => {
    const next = hydrate(incoming as Partial<UiSettings>);
    // Importing a settings file must NEVER enable the certificate bypass: that path has no
    // confirmation dialog, and the file may have come from another machine or environment. Disabling
    // certificate validation stays an explicit, confirmed action in Settings → Recorder Security.
    next.recorder.security = { ...DEFAULT_RECORDER_SECURITY_SETTINGS };
    // A portable settings file must not silently opt another machine into an installed executable.
    next.superUser.chrome = { ...defaultSettings.superUser.chrome };
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

  if (!["light", "dark", "system"].includes(settings.appearance)) {
    errors.push("Appearance must be light, dark, or system.");
  }
  if (!(typeof d.defaultZoomPercent === "number" && Number.isFinite(d.defaultZoomPercent) && d.defaultZoomPercent >= 25 && d.defaultZoomPercent <= 200)) {
    errors.push("Default zoom must be between 25 and 200.");
  }
  if (!(typeof d.defaultNodeWidth === "number" && Number.isFinite(d.defaultNodeWidth) && d.defaultNodeWidth > 0)) {
    errors.push("Default node width must be a positive value.");
  }
  if (!(typeof d.defaultNodeHeight === "number" && Number.isFinite(d.defaultNodeHeight) && d.defaultNodeHeight > 0)) {
    errors.push("Default node height must be a positive value.");
  }

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
  if (!["headed", "headless"].includes(e.defaultRunMode)) {
    errors.push("Default run mode must be headed or headless.");
  }
  if (typeof e.screenshotOnFailure !== "boolean") errors.push("Screenshot on failure must be true or false.");
  if (typeof e.stopOnError !== "boolean") errors.push("Stop on error must be true or false.");

  if (typeof settings.recorder.captureWaitTime !== "boolean") {
    errors.push("Recorder capture waiting time must be true or false.");
  }
  if (typeof settings.recorder.captureSmartWaits !== "boolean") {
    errors.push("Recorder Smart Wait capture must be true or false.");
  }
  if (!["default", "xpath"].includes(settings.recorder.locatorRecordingMode)) {
    errors.push("Recorder locator recording mode must be default or xpath.");
  }
  if (typeof settings.recorder.ignoreProtectedLoginDetection !== "boolean") {
    errors.push("Protected login detection override must be true or false.");
  }

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
    if (typeof value !== "string" || !value.trim()) {
      errors.push(`Path "${key}" must be a non-empty path string.`);
    }
  }

  const sem = settings.semantic;
  if (typeof sem?.enabled !== "boolean") {
    errors.push("Semantic index enabled must be true or false.");
  }
  if (!Number.isInteger(sem?.defaultTopK) || sem.defaultTopK < 1 || sem.defaultTopK > SEMANTIC_MAX_TOP_K) {
    errors.push(`Semantic default result count must be an integer between 1 and ${SEMANTIC_MAX_TOP_K}.`);
  }

  if (typeof settings.superUser.debugMode !== "boolean") {
    errors.push("Debug mode must be true or false.");
  }
  if (!["bundledChromium", "installedChrome"].includes(settings.superUser.chrome.mode)) {
    errors.push("Chrome execution mode must be bundled Chromium or installed Chrome.");
  }
  if (typeof settings.superUser.chrome.executablePath !== "string") {
    errors.push("Configured Chrome executable path must be a string.");
  }
  if (
    !isValidSessionInactivityMinutes(settings.superUser.sessionInactivityMinutes)
  ) {
    errors.push(
      `Session inactivity timeout must be a whole number between ${MIN_SESSION_INACTIVITY_MINUTES} and ${MAX_SESSION_INACTIVITY_MINUTES} minutes.`
    );
  }

  const acc = settings.accent;
  if (acc.mode !== "solid" && acc.mode !== "gradient") errors.push("Accent mode must be solid or gradient.");
  if (acc.primaryColor !== null && normalizeAccentColor(acc.primaryColor) === null) {
    errors.push("Accent primary color must be a valid #RRGGBB hex value or unset.");
  }
  if (acc.secondaryColor !== null && normalizeAccentColor(acc.secondaryColor) === null) {
    errors.push("Accent secondary color must be a valid #RRGGBB hex value or unset.");
  }
  if (acc.mode === "gradient" && (!acc.primaryColor || !acc.secondaryColor)) {
    errors.push("Gradient accent requires both a primary and a secondary color.");
  }
  if (!["default-purple", "specter-blue", "custom"].includes(acc.preset)) {
    errors.push("Accent preset must be default-purple, specter-blue, or custom.");
  }
  if (!(Number.isFinite(acc.gradientAngle) && acc.gradientAngle >= 0 && acc.gradientAngle < 360)) {
    errors.push("Accent gradient angle must be between 0 and 360.");
  }
  if (typeof settings.recorder.security?.ignoreHttpsErrors !== "boolean") {
    errors.push("Recorder security setting \"Ignore invalid HTTPS certificates\" must be true or false.");
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
  // unique per process.
  //
  // The rename is retried for bounded transient EPERM/EBUSY only. On Windows those are routine
  // rather than exceptional — an antivirus scan, the search indexer, or a preview handle can hold
  // the target for a few milliseconds — and a single such failure used to discard the user's
  // settings change outright. Everything else still fails on the first attempt, and every failing
  // path cleans up the temp file and leaves the previous ui-settings.json untouched.
  // See app/main/atomicReplace.ts for why the retry set and the backoff are as narrow as they are.
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  await replaceFileAtomically(tmp, path);
}

function getSettingsPath(): string {
  return join(getRuntimePaths().folders.storage, "ui-settings.json");
}
