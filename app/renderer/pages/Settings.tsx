import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FolderOpen,
  Gauge,
  HardDrive,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  Download
} from "lucide-react";
import type { UiSettings } from "../../main/uiSettings";
import type { CapacityPreview } from "@src/runner/concurrency/CapacityContracts";
import type { WorkloadClass } from "@src/runner/concurrency/CapacityPlanner";
import { useTheme, type AppearanceMode } from "../state/theme";

const CAPACITY_MODES: { id: UiSettings["runtime"]["capacityMode"]; label: string; hint: string }[] = [
  { id: "sequential", label: "Sequential", hint: "One instance at a time — safest, machine-independent." },
  { id: "auto", label: "Auto", hint: "Derive a safe concurrency from this machine's CPU/RAM." },
  { id: "manual", label: "Manual", hint: "Set explicit host caps (still safety-limited)." }
];
const WORKLOAD_CLASSES: WorkloadClass[] = ["light", "medium", "heavy", "custom"];

function formatMb(mb: number | undefined): string {
  if (!mb || mb <= 0) return "—";
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

type Stats = {
  appVersion: string;
  runtimeDataRoot: string;
  productionOffline: boolean;
  flows: number;
  workflows: number;
  dataSources: number;
  reports: number;
};

type PathStatus = Record<string, { path: string; exists: boolean; writable: boolean }>;

type Banner = { type: "success" | "error"; text: string } | null;

const PATH_FIELDS: { key: keyof UiSettings["paths"]; label: string }[] = [
  { key: "screenshotsPath", label: "Screenshots" },
  { key: "flowsPath", label: "Flows" },
  { key: "workflowsPath", label: "Workflows" },
  { key: "dataSourcesPath", label: "Data sources" },
  { key: "reportsPath", label: "Reports" },
  { key: "logsPath", label: "Logs" },
  { key: "downloadsPath", label: "Downloads" }
];

/** Mirror of the main-process validation so the user gets inline errors before save. */
function validateClient(settings: UiSettings): string[] {
  const errors: string[] = [];
  const d = settings.designerDefaults;
  const e = settings.execution;
  if (!(d.defaultZoomPercent >= 25 && d.defaultZoomPercent <= 200)) errors.push("Default zoom must be between 25 and 200.");
  if (!(d.defaultNodeWidth > 0)) errors.push("Default node width must be positive.");
  if (!(d.defaultNodeHeight > 0)) errors.push("Default node height must be positive.");
  for (const [v, label] of [
    [e.maxRuns, "Maximum runs"],
    [e.maxConcurrentRuns, "Maximum concurrent runs"],
    [e.defaultRuns, "Default runs"],
    [e.defaultConcurrentRuns, "Default concurrent runs"]
  ] as [number, string][]) {
    if (!Number.isInteger(v) || v < 1) errors.push(`${label} must be a positive integer.`);
  }
  if (e.defaultRuns > e.maxRuns) errors.push("Default runs cannot exceed maximum runs.");
  if (e.defaultConcurrentRuns > e.maxConcurrentRuns) errors.push("Default concurrent runs cannot exceed maximum concurrent runs.");
  if (e.defaultConcurrentRuns > e.defaultRuns) errors.push("Default concurrent runs cannot exceed default runs.");
  if (e.maxConcurrentRuns > e.maxRuns) errors.push("Maximum concurrent runs cannot exceed maximum runs.");
  const r = settings.runtime;
  if (!["sequential", "auto", "manual"].includes(r.capacityMode)) errors.push("Capacity mode must be sequential, auto, or manual.");
  if (!["light", "medium", "heavy", "custom"].includes(r.workloadClass)) errors.push("Workload class must be light, medium, heavy, or custom.");
  if (!Number.isInteger(r.maxBrowsers) || r.maxBrowsers < 1 || r.maxBrowsers > 16) errors.push("Max browsers must be an integer between 1 and 16.");
  if (!Number.isInteger(r.maxActiveFlows) || r.maxActiveFlows < 1 || r.maxActiveFlows > 64) errors.push("Max active flows must be an integer between 1 and 64.");
  if (!Number.isInteger(r.absoluteSafetyMaximum) || r.absoluteSafetyMaximum < 1 || r.absoluteSafetyMaximum > 256) errors.push("Absolute safety maximum must be an integer between 1 and 256.");
  if (!(typeof r.capacitySafetyFactor === "number" && r.capacitySafetyFactor >= 0.1 && r.capacitySafetyFactor <= 1)) errors.push("Capacity safety factor must be between 0.1 and 1.");
  if (!Number.isInteger(r.reservedLogicalCpuCount) || r.reservedLogicalCpuCount < 0 || r.reservedLogicalCpuCount > 64) errors.push("Reserved logical CPU count must be an integer between 0 and 64.");
  if (r.administratorMaximumConcurrency !== null && (!Number.isInteger(r.administratorMaximumConcurrency) || r.administratorMaximumConcurrency < 1)) errors.push("Administrator maximum concurrency must be a positive integer or unset.");
  for (const { key, label } of PATH_FIELDS) {
    if (!settings.paths[key]?.trim()) errors.push(`${label} path must not be empty.`);
  }
  return errors;
}

export function SettingsPage() {
  const { appearance, setAppearance } = useTheme();
  const [settings, setSettings] = useState<UiSettings | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [pathStatus, setPathStatus] = useState<PathStatus>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [banner, setBanner] = useState<Banner>(null);
  const [saving, setSaving] = useState(false);
  const [defaultPaths, setDefaultPaths] = useState<Record<string, string>>({});
  const [capacity, setCapacity] = useState<CapacityPreview | null>(null);
  const [capacityLoading, setCapacityLoading] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const api = window.playwrightFlowStudio.settings;

  const loadCapacity = useCallback(async (workloadClass?: WorkloadClass) => {
    setCapacityLoading(true);
    try {
      setCapacity(await window.playwrightFlowStudio.system.capacityPreview(workloadClass));
    } catch {
      setCapacity(null);
    } finally {
      setCapacityLoading(false);
    }
  }, []);

  const loadStats = useCallback(async () => {
    const [s, p, dp] = await Promise.all([api.getStorageStats(), api.validatePaths(), api.getDefaultPaths()]);
    setStats(s);
    setPathStatus(p);
    setDefaultPaths(dp);
  }, [api]);

  const browsePath = useCallback(
    async (key: keyof UiSettings["paths"], current: string) => {
      const picked = await window.playwrightFlowStudio.system.browseFolder(current);
      if (picked) setSettings((prev) => (prev ? { ...prev, paths: { ...prev.paths, [key]: picked } } : prev));
    },
    []
  );

  const reload = useCallback(async () => {
    const s = await api.get();
    setSettings(s);
    setErrors([]);
    await loadStats();
  }, [api, loadStats]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Refresh the machine capacity readout on load and whenever the workload class changes (so Auto's
  // recommendation reflects the selected class live, before saving).
  const workloadClass = settings?.runtime.workloadClass;
  useEffect(() => {
    if (!settings) return;
    void loadCapacity(workloadClass);
  }, [settings ? true : false, workloadClass, loadCapacity]);

  const patch = useCallback(
    <S extends "designerDefaults" | "execution" | "paths" | "runtime">(section: S, key: keyof UiSettings[S], value: unknown) => {
      setSettings((prev) => (prev ? { ...prev, [section]: { ...prev[section], [key]: value } } : prev));
      setBanner(null);
    },
    []
  );

  const save = useCallback(async () => {
    if (!settings) return;
    const validation = validateClient(settings);
    setErrors(validation);
    if (validation.length) {
      setBanner({ type: "error", text: "Please fix the highlighted issues before saving." });
      return;
    }
    setSaving(true);
    try {
      await api.update({
        designerDefaults: settings.designerDefaults,
        execution: settings.execution,
        runtime: settings.runtime,
        paths: settings.paths
      });
      setBanner({ type: "success", text: "Settings saved." });
      await loadStats();
    } catch {
      setBanner({ type: "error", text: "Failed to save settings." });
    } finally {
      setSaving(false);
    }
  }, [api, settings, loadStats]);

  const resetDefaults = useCallback(async () => {
    if (!window.confirm("Reset ALL settings to defaults? This does not delete flows, workflows, or reports.")) return;
    await api.reset();
    setAppearance("light"); // keep the live theme in sync with the reset appearance default
    setBanner({ type: "success", text: "Settings reset to defaults." });
    await reload();
  }, [api, reload, setAppearance]);

  const clearUi = useCallback(async () => {
    await api.clearUiState();
    setBanner({ type: "success", text: "UI state cleared. Flows, workflows, and reports were not touched." });
    await reload();
  }, [api, reload]);

  const exportSettings = useCallback(async () => {
    const data = await api.export();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = "webflow-studio-settings.json";
    link.click();
    URL.revokeObjectURL(href);
  }, [api]);

  const importSettings = useCallback(
    async (file: File) => {
      try {
        const parsed = JSON.parse(await file.text());
        await api.import(parsed);
        setBanner({ type: "success", text: "Settings imported." });
        await reload();
      } catch (error) {
        setBanner({ type: "error", text: error instanceof Error ? error.message : "Failed to import settings." });
      }
    },
    [api, reload]
  );

  const validateOffline = useCallback(async () => {
    try {
      const status = await window.playwrightFlowStudio.offlineRuntime.getStatus();
      const failed = status.checks.filter((c) => !c.ok).length;
      setBanner(
        failed === 0
          ? { type: "success", text: "Offline runtime validation passed." }
          : { type: "error", text: `Offline runtime validation found ${failed} issue(s). See the Offline Runtime page.` }
      );
    } catch {
      setBanner({ type: "error", text: "Unable to validate offline runtime." });
    }
  }, []);

  if (!settings) {
    return (
      <section className="page">
        <section className="work-panel">
          <div className="empty-state">
            <strong>Loading settings…</strong>
          </div>
        </section>
      </section>
    );
  }

  const d = settings.designerDefaults;
  const e = settings.execution;
  const r = settings.runtime;

  return (
    <section className="page">
      <div className="settings-stack">
        <div className="settings-toolbar">
          <div className="section-heading" style={{ border: 0, margin: 0, padding: 0, flex: 1 }}>
            <h1>Settings</h1>
            <span>Application options and runtime paths</span>
          </div>
          <button className="toolbar-button" type="button" onClick={resetDefaults} title="Reset all settings to defaults">
            <RotateCcw size={15} />
            Reset to Defaults
          </button>
          <button className="toolbar-button primary" type="button" onClick={() => void save()} disabled={saving}>
            <Save size={15} />
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>

        {banner ? <div className={`settings-banner ${banner.type}`}>{banner.text}</div> : null}
        {errors.length ? (
          <div className="settings-banner error">
            <strong>Validation:</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {errors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Application */}
        <section className="work-panel settings-card">
          <div className="settings-card-head">
            <Gauge size={16} />
            <h2>Application</h2>
          </div>
          <div className="readiness-list">
            <span>Application name</span>
            <strong>WebFlow Studio</strong>
            <span>Version</span>
            <strong>{stats?.appVersion ?? "—"}</strong>
            <span>Last launched</span>
            <strong>{settings.app.lastLaunchedAt ? new Date(settings.app.lastLaunchedAt).toLocaleString() : "—"}</strong>
            <span>Offline mode</span>
            <strong>{stats ? (stats.productionOffline ? "Production offline" : "Development") : "—"}</strong>
            <span>Runtime data root</span>
            <strong>{stats?.runtimeDataRoot ?? "—"}</strong>
          </div>
          <div className="settings-appearance-row">
            <label>
              <span>Appearance</span>
              <select
                value={appearance}
                onChange={(ev) => setAppearance(ev.target.value as AppearanceMode)}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">System</option>
              </select>
            </label>
            <p className="form-message">Applied immediately and remembered. System follows the Windows theme.</p>
          </div>
        </section>

        {/* Paths & Directories */}
        <section className="work-panel settings-card">
          <div className="settings-card-head">
            <FolderOpen size={16} />
            <h2>Paths &amp; Directories</h2>
          </div>
          <div className="settings-grid">
            {PATH_FIELDS.map(({ key, label }) => {
              const status = pathStatus[key];
              return (
                <label key={key} className="settings-path-field">
                  <span className="settings-path-label">
                    {label}
                    {status ? (
                      <em className={status.writable ? "path-ok" : status.exists ? "path-warn" : "path-missing"}>
                        {status.writable ? "writable" : status.exists ? "read-only" : "missing"}
                      </em>
                    ) : null}
                  </span>
                  <div className="settings-path-row">
                    <input value={settings.paths[key]} onChange={(ev) => patch("paths", key, ev.target.value)} />
                    <button className="toolbar-button" type="button" onClick={() => void browsePath(key, settings.paths[key])}>
                      Browse
                    </button>
                    <button
                      className="toolbar-button"
                      type="button"
                      title="Reset to default location"
                      disabled={!defaultPaths[key] || settings.paths[key] === defaultPaths[key]}
                      onClick={() => patch("paths", key, defaultPaths[key])}
                    >
                      Reset
                    </button>
                  </div>
                </label>
              );
            })}
          </div>
          <p className="form-message">Paths default to folders under the runtime data root. Use Browse to choose a folder, then Save.</p>
        </section>

        {/* Designer Defaults */}
        <section className="work-panel settings-card">
          <div className="settings-card-head">
            <SlidersHorizontal size={16} />
            <h2>Designer Defaults</h2>
          </div>
          <div className="settings-grid">
            <label>
              Default zoom (%)
              <input type="number" min={25} max={200} step={10} value={d.defaultZoomPercent} onChange={(ev) => patch("designerDefaults", "defaultZoomPercent", Number(ev.target.value))} />
            </label>
            <label>
              Default node width (px)
              <input type="number" min={1} value={d.defaultNodeWidth} onChange={(ev) => patch("designerDefaults", "defaultNodeWidth", Number(ev.target.value))} />
            </label>
            <label>
              Default node height (px)
              <input type="number" min={1} value={d.defaultNodeHeight} onChange={(ev) => patch("designerDefaults", "defaultNodeHeight", Number(ev.target.value))} />
            </label>
          </div>
        </section>

        {/* Execution Defaults */}
        <section className="work-panel settings-card">
          <div className="settings-card-head">
            <ShieldCheck size={16} />
            <h2>Execution Defaults</h2>
          </div>
          <div className="settings-grid">
            <label>
              Maximum runs
              <input type="number" min={1} value={e.maxRuns} onChange={(ev) => patch("execution", "maxRuns", Number(ev.target.value))} />
            </label>
            <label>
              Maximum concurrent runs
              <input type="number" min={1} value={e.maxConcurrentRuns} onChange={(ev) => patch("execution", "maxConcurrentRuns", Number(ev.target.value))} />
            </label>
            <label>
              Default runs
              <input type="number" min={1} value={e.defaultRuns} onChange={(ev) => patch("execution", "defaultRuns", Number(ev.target.value))} />
            </label>
            <label>
              Default concurrent runs
              <input type="number" min={1} value={e.defaultConcurrentRuns} onChange={(ev) => patch("execution", "defaultConcurrentRuns", Number(ev.target.value))} />
            </label>
            <label>
              Default run mode
              <select value={e.defaultRunMode} onChange={(ev) => patch("execution", "defaultRunMode", ev.target.value as "headed" | "headless")}>
                <option value="headless">Headless</option>
                <option value="headed">Headed</option>
              </select>
            </label>
            <label className="inline-check">
              <input type="checkbox" checked={e.screenshotOnFailure} onChange={(ev) => patch("execution", "screenshotOnFailure", ev.target.checked)} />
              Screenshot on failure
            </label>
            <label className="inline-check">
              <input type="checkbox" checked={e.stopOnError} onChange={(ev) => patch("execution", "stopOnError", ev.target.checked)} />
              Stop on error
            </label>
          </div>
        </section>

        {/* Runtime Concurrency — machine-aware capacity (Sequential / Auto / Manual) */}
        <section className="work-panel settings-card">
          <div className="settings-card-head">
            <Gauge size={16} />
            <h2>Runtime Concurrency</h2>
          </div>
          <p className="settings-card-hint">
            How many workflow instances run at once. Host caps also drive the Chrome Consumption gauges.
            A browser-count change applies when no run is in progress; safety limits apply in every mode.
          </p>

          <div className="capacity-mode-row" role="group" aria-label="Capacity mode">
            {CAPACITY_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`toolbar-button ${r.capacityMode === m.id ? "primary" : "secondary"}`}
                aria-pressed={r.capacityMode === m.id}
                onClick={() => patch("runtime", "capacityMode", m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="settings-card-hint">{CAPACITY_MODES.find((m) => m.id === r.capacityMode)?.hint}</p>

          <div className="capacity-readout">
            {capacityLoading && !capacity ? (
              <span className="awkit-muted">Detecting this machine…</span>
            ) : capacity ? (
              <>
                <div className="readiness-list">
                  <span>This machine</span>
                  <strong>
                    {capacity.capabilities.logicalCpuCount} logical CPUs · {formatMb(capacity.capabilities.totalMemoryMb)} RAM (
                    {formatMb(capacity.capabilities.availableMemoryMb)} free)
                  </strong>
                  <span>Applied concurrency</span>
                  <strong>{capacity.effectiveTarget} instance{capacity.effectiveTarget === 1 ? "" : "s"}</strong>
                  <span>Auto recommendation</span>
                  <strong>
                    {capacity.autoTarget} · {capacity.recommendation.bindingConstraint}-bound · {capacity.recommendation.categoryName} ·{" "}
                    {capacity.profile.benchmarkTestedCapacity != null ? "benchmarked" : "estimate"}
                  </strong>
                </div>
                {capacity.recommendation.requiresBenchmark && capacity.profile.benchmarkTestedCapacity == null ? (
                  <p className="form-message">
                    Server-grade machine — Auto stays conservative until a benchmark runs on this host.
                  </p>
                ) : null}
                {capacity.requiresRecalibration ? (
                  <p className="form-message warn">Hardware change detected — recalibration recommended.</p>
                ) : null}
              </>
            ) : (
              <span className="awkit-muted">Machine capacity unavailable.</span>
            )}
          </div>

          {r.capacityMode === "sequential" ? (
            <p className="form-message">Runs one instance at a time in queue order — independent of machine size.</p>
          ) : null}

          {r.capacityMode === "auto" ? (
            <div className="settings-grid">
              <label>
                Workload class
                <select value={r.workloadClass} onChange={(ev) => patch("runtime", "workloadClass", ev.target.value)}>
                  {WORKLOAD_CLASSES.map((c) => (
                    <option key={c} value={c}>
                      {c[0].toUpperCase() + c.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}

          {r.capacityMode === "manual" ? (
            <>
              <div className="settings-grid">
                <label>
                  Max browsers
                  <input type="number" min={1} max={16} value={r.maxBrowsers} onChange={(ev) => patch("runtime", "maxBrowsers", Number(ev.target.value))} />
                </label>
                <label>
                  Max active flows
                  <input type="number" min={1} max={64} value={r.maxActiveFlows} onChange={(ev) => patch("runtime", "maxActiveFlows", Number(ev.target.value))} />
                </label>
              </div>
              {capacity && r.maxActiveFlows > capacity.autoTarget ? (
                <p className="form-message warn">
                  Manual concurrency ({r.maxActiveFlows}) exceeds the recommended {capacity.autoTarget} for this machine.
                </p>
              ) : null}
            </>
          ) : null}

          {r.capacityMode !== "sequential" ? (
            <details className="capacity-advanced">
              <summary>Advanced safety limits</summary>
              <div className="settings-grid">
                <label>
                  Administrator max
                  <input
                    type="number"
                    min={1}
                    placeholder="unset"
                    value={r.administratorMaximumConcurrency ?? ""}
                    onChange={(ev) => patch("runtime", "administratorMaximumConcurrency", ev.target.value === "" ? null : Number(ev.target.value))}
                  />
                </label>
                <label>
                  Absolute safety maximum
                  <input type="number" min={1} max={256} value={r.absoluteSafetyMaximum} onChange={(ev) => patch("runtime", "absoluteSafetyMaximum", Number(ev.target.value))} />
                </label>
                <label>
                  Capacity safety factor
                  <input type="number" min={0.1} max={1} step={0.05} value={r.capacitySafetyFactor} onChange={(ev) => patch("runtime", "capacitySafetyFactor", Number(ev.target.value))} />
                </label>
                <label>
                  Reserved CPU cores
                  <input type="number" min={0} max={64} value={r.reservedLogicalCpuCount} onChange={(ev) => patch("runtime", "reservedLogicalCpuCount", Number(ev.target.value))} />
                </label>
              </div>
            </details>
          ) : null}
        </section>

        {/* Data Storage */}
        <section className="work-panel settings-card">
          <div className="settings-card-head">
            <Database size={16} />
            <h2>Data Storage</h2>
          </div>
          <div className="readiness-list">
            <span>Runtime data root</span>
            <strong>{stats?.runtimeDataRoot ?? "—"}</strong>
            <span>Flows</span>
            <strong>{stats?.flows ?? 0}</strong>
            <span>Workflows</span>
            <strong>{stats?.workflows ?? 0}</strong>
            <span>Data sources</span>
            <strong>{stats?.dataSources ?? 0}</strong>
            <span>Reports</span>
            <strong>{stats?.reports ?? 0}</strong>
          </div>
          <div className="settings-actions">
            <button className="toolbar-button" type="button" onClick={() => void api.openRuntimeFolder()}>
              <HardDrive size={15} />
              Open Runtime Folder
            </button>
            <button className="toolbar-button" type="button" onClick={() => void loadStats()}>
              <RotateCcw size={15} />
              Refresh Counts
            </button>
          </div>
        </section>

        {/* Advanced */}
        <section className="work-panel settings-card">
          <div className="settings-card-head">
            <AlertTriangle size={16} />
            <h2>Advanced</h2>
          </div>
          <div className="settings-actions">
            <button className="toolbar-button" type="button" onClick={() => void clearUi()} title="Reset layout/UI state only — does not delete user data">
              Clear UI State
            </button>
            <button className="toolbar-button" type="button" onClick={() => void validateOffline()}>
              <ShieldCheck size={15} />
              Validate Offline Runtime
            </button>
            <button className="toolbar-button" type="button" onClick={() => void exportSettings()}>
              <Download size={15} />
              Export Settings
            </button>
            <button className="toolbar-button" type="button" onClick={() => importRef.current?.click()}>
              <Upload size={15} />
              Import Settings
            </button>
            <button className="toolbar-button modal-danger" type="button" onClick={() => void resetDefaults()}>
              <RotateCcw size={15} />
              Reset to Defaults
            </button>
            <input
              accept=".json,application/json"
              ref={importRef}
              style={{ display: "none" }}
              type="file"
              onChange={(ev) => {
                const file = ev.target.files?.[0];
                if (file) void importSettings(file);
                ev.target.value = "";
              }}
            />
          </div>
          <p className="form-message">
            <CheckCircle2 size={13} style={{ verticalAlign: "-2px" }} /> Clear UI State and Import never delete saved flows, workflows, data sources, or reports.
          </p>
        </section>
      </div>
    </section>
  );
}
