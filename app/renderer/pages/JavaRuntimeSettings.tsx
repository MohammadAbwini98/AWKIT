import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Coffee, FileCode2, FolderOpen, Loader2, PlugZap, ShieldCheck, Star, Trash2, XCircle } from "lucide-react";
import type { JavaRuntimeProfileView, JavaRuntimeStatus } from "@src/oracle/JavaRuntimeProfile";
import type { DriverProbeResult } from "@src/oracle/OracleDriverBundleStore";

type Banner = { type: "success" | "error"; text: string } | null;

const SECURITY_WARNING =
  "External Java runtimes execute code with your user permissions. Only select a JRE/JDK you installed from a trusted source (e.g. Oracle, Eclipse Adoptium, Microsoft).";

const STATUS_META: Record<JavaRuntimeStatus, { label: string; tone: "ok" | "warn" | "bad" }> = {
  valid: { label: "Valid", tone: "ok" },
  unverified: { label: "Unverified", tone: "warn" },
  missing: { label: "Missing", tone: "bad" },
  incompatible: { label: "Incompatible", tone: "bad" },
  "validation-failed": { label: "Validation failed", tone: "bad" }
};

/**
 * Settings › Java Runtime for Database Drivers (WS-B). Add (via java.exe or a JRE/JDK directory),
 * validate, set-default, bridge-test, and remove user-selected Java runtimes. Specter no longer bundles
 * a JRE — Oracle live queries launch the isolated bridge with the selected java. The renderer never
 * loads Java classes; the main process spawns `java -version` and the bridge in a child process.
 * Token-only styling (reuses the driver-settings classes for visual consistency).
 */
export function JavaRuntimeSettings() {
  const java = window.playwrightFlowStudio.oracle.java;
  const [runtimes, setRuntimes] = useState<JavaRuntimeProfileView[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setRuntimes(await java.list());
    } catch {
      setRuntimes([]);
    } finally {
      setLoading(false);
    }
  }, [java]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const add = useCallback(
    async (kind: "executable" | "directory") => {
      const trimmed = name.trim();
      if (!trimmed) {
        setBanner({ type: "error", text: "Enter a name for the Java runtime first." });
        return;
      }
      if (!window.confirm(`${SECURITY_WARNING}\n\nAdd a Java runtime named "${trimmed}"?`)) return;
      setBusy(true);
      setBanner(null);
      try {
        const result = kind === "executable" ? await java.addExecutable({ name: trimmed }) : await java.addDirectory({ name: trimmed });
        if (!result) return; // dialog cancelled
        setName("");
        setBanner({
          type: result.status === "valid" ? "success" : "error",
          text:
            result.status === "valid"
              ? `Added "${result.name}" — Java ${result.javaVersion}${result.vendor ? ` (${result.vendor})` : ""}, ${result.architecture}.`
              : `Added "${result.name}" (${STATUS_META[result.status].label}).`
        });
        await reload();
      } catch (err) {
        setBanner({ type: "error", text: err instanceof Error ? err.message : "Could not add the Java runtime." });
      } finally {
        setBusy(false);
      }
    },
    [java, name, reload]
  );

  const withBusy = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }, []);

  const setDefault = useCallback(
    (id: string) => withBusy(async () => {
      await java.setDefault(id);
      await reload();
    }),
    [java, reload, withBusy]
  );

  const validate = useCallback(
    (id: string) => withBusy(async () => {
      const r = await java.validate(id);
      setBanner({ type: r.status === "valid" ? "success" : "error", text: `Validation: ${STATUS_META[r.status].label}.` });
      await reload();
    }),
    [java, reload, withBusy]
  );

  const testBridge = useCallback(
    (id: string) => withBusy(async () => {
      const probe: DriverProbeResult = await java.testBridge(id);
      setBanner(
        probe.probed
          ? {
              type: "success",
              text: probe.driverAvailable
                ? `Bridge launched — Java ${probe.javaVersion ?? "?"}, Oracle JDBC ${probe.driverVersion ?? "?"} loaded.`
                : `Bridge launched with Java ${probe.javaVersion ?? "?"} (no driver selected — import an ojdbc*.jar to load a real driver).`
            }
          : { type: "error", text: probe.reason ?? "The selected Java could not launch the bridge." }
      );
    }),
    [java, withBusy]
  );

  const remove = useCallback(
    (r: JavaRuntimeProfileView) => withBusy(async () => {
      if (r.usageCount > 0) {
        setBanner({ type: "error", text: `"${r.name}" is used by ${r.usageCount} profile(s). Remap them first.` });
        return;
      }
      if (!window.confirm(`Remove Java runtime "${r.name}"? This only removes it from Specter — the Java install is not deleted.`)) return;
      await java.remove(r.id);
      setBanner({ type: "success", text: `Removed "${r.name}".` });
      await reload();
    }),
    [java, reload, withBusy]
  );

  return (
    <section className="work-panel settings-card">
      <div className="settings-card-head">
        <Coffee size={16} />
        <h2>Java Runtime for Database Drivers</h2>
      </div>
      <p className="settings-card-hint">
        Oracle live queries run through an isolated Java bridge. Specter does not bundle Java — select an installed
        JRE or JDK (Java 8+). The runtime stays where you installed it; Specter records only its path and version and
        launches it in a separate process. Non-Oracle workflows and Oracle Snapshot Data Sources do not require Java.
      </p>

      <div className="oracle-driver-warning" role="note">
        <AlertTriangle size={15} />
        <span>{SECURITY_WARNING}</span>
      </div>

      <div className="settings-secret-form">
        <label>
          Runtime name
          <input
            type="text"
            value={name}
            placeholder="Temurin 17 (x64)"
            spellCheck={false}
            autoComplete="off"
            onChange={(ev) => {
              setName(ev.target.value);
              setBanner(null);
            }}
          />
        </label>
        <button className="toolbar-button primary" type="button" disabled={busy} onClick={() => void add("executable")}>
          {busy ? <Loader2 size={15} className="spin" /> : <FileCode2 size={15} />}
          Select java.exe…
        </button>
        <button className="toolbar-button" type="button" disabled={busy} onClick={() => void add("directory")}>
          <FolderOpen size={15} />
          Select JRE/JDK folder…
        </button>
      </div>
      {banner ? <p className={`form-message ${banner.type === "error" ? "error-text" : "ok-text"}`}>{banner.text}</p> : null}

      {loading ? (
        <p className="form-message">Loading Java runtimes…</p>
      ) : runtimes.length === 0 ? (
        <p className="form-message">
          No Java runtime configured yet. Select an installed <code>java.exe</code> or a JRE/JDK folder to enable live Oracle queries.
        </p>
      ) : (
        <div className="oracle-driver-list">
          {runtimes.map((r) => {
            const meta = STATUS_META[r.status];
            return (
              <div className="oracle-driver-row" key={r.id}>
                <div className="oracle-driver-main">
                  <div className="oracle-driver-title">
                    {r.isDefault ? <Star size={14} className="oracle-driver-default" aria-label="Default runtime" /> : <Coffee size={14} />}
                    <strong>{r.name}</strong>
                    <span className={`oracle-driver-badge ${meta.tone}`}>{meta.label}</span>
                    {r.isDefault ? <span className="oracle-driver-badge default">Default</span> : null}
                    <span className="oracle-driver-badge muted">{r.architecture}</span>
                  </div>
                  <div className="oracle-driver-meta">
                    <span>Java <strong>{r.javaVersion}</strong></span>
                    {r.vendor ? <span>{r.vendor}</span> : null}
                    <span className="oracle-driver-path" title={r.javaExecutablePath}>{r.javaExecutablePath}</span>
                    {r.usageCount > 0 ? <span>Used by <strong>{r.usageCount}</strong></span> : null}
                  </div>
                </div>
                <div className="oracle-driver-actions">
                  <button className="icon-button" type="button" title="Test bridge launch" disabled={busy} onClick={() => void testBridge(r.id)}>
                    <PlugZap size={14} />
                  </button>
                  <button className="icon-button" type="button" title="Validate runtime" disabled={busy} onClick={() => void validate(r.id)}>
                    {r.status === "valid" ? <CheckCircle2 size={14} /> : <ShieldCheck size={14} />}
                  </button>
                  <button className="icon-button" type="button" title={r.isDefault ? "Default runtime" : "Set as default"} disabled={busy || r.isDefault} onClick={() => void setDefault(r.id)}>
                    <Star size={14} />
                  </button>
                  <button
                    className="icon-button danger"
                    type="button"
                    title={r.usageCount > 0 ? `In use by ${r.usageCount} profile(s)` : "Remove runtime"}
                    disabled={busy || r.usageCount > 0}
                    onClick={() => void remove(r)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
