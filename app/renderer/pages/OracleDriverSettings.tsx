import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Cpu, Database, Loader2, PlugZap, ShieldCheck, Star, Trash2, XCircle } from "lucide-react";
import type { OracleDriverBundleView, OracleDriverValidationStatus } from "@src/oracle/OracleDriverBundle";
import type { DriverProbeResult } from "@src/oracle/OracleDriverBundleStore";

type Banner = { type: "success" | "error"; text: string } | null;

const SECURITY_WARNING =
  "Oracle JDBC JAR files contain executable code. Only import drivers obtained directly from Oracle or an approved company artifact repository.";

const STATUS_META: Record<OracleDriverValidationStatus, { label: string; tone: "ok" | "warn" | "bad" }> = {
  valid: { label: "Valid", tone: "ok" },
  unverified: { label: "Unverified", tone: "warn" },
  invalid: { label: "Invalid", tone: "bad" },
  missing: { label: "Missing files", tone: "bad" },
  "checksum-failed": { label: "Checksum failed", tone: "bad" }
};

/**
 * Settings › Oracle JDBC Drivers (Phase 05). Import, validate, set-default, load-test, and remove
 * managed Oracle driver bundles. The renderer never touches JAR bytes — the main process copies,
 * hashes, and load-tests each bundle in an isolated Java bridge. Token-only styling.
 */
export function OracleDriverSettings() {
  const drivers = window.playwrightFlowStudio.oracle.drivers;
  const [bundles, setBundles] = useState<OracleDriverBundleView[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setBundles(await drivers.list());
    } catch {
      setBundles([]);
    } finally {
      setLoading(false);
    }
  }, [drivers]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const importBundle = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setBanner({ type: "error", text: "Enter a name for the driver bundle first." });
      return;
    }
    if (!window.confirm(`${SECURITY_WARNING}\n\nImport a driver bundle named "${trimmed}"?`)) return;
    setBusy(true);
    setBanner(null);
    try {
      const result = await drivers.import({ name: trimmed });
      if (!result) {
        setBanner(null); // dialog cancelled
        return;
      }
      setName("");
      setBanner({
        type: result.validationStatus === "invalid" ? "error" : "success",
        text:
          result.validationStatus === "valid"
            ? `Imported "${result.name}" — Oracle JDBC ${result.jdbcVersion ?? "driver"} loaded${result.supportsPooling ? " with UCP" : " (no UCP pooling)"}.`
            : `Imported "${result.name}" (${STATUS_META[result.validationStatus].label}).`
      });
      await reload();
    } catch (err) {
      setBanner({ type: "error", text: err instanceof Error ? err.message : "Import failed." });
    } finally {
      setBusy(false);
    }
  }, [drivers, name, reload]);

  const withBusy = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      try {
        await fn();
      } finally {
        setBusy(false);
      }
    },
    []
  );

  const setDefault = useCallback(
    (id: string) => withBusy(async () => {
      await drivers.setDefault(id);
      await reload();
    }),
    [drivers, reload, withBusy]
  );

  const validate = useCallback(
    (id: string) => withBusy(async () => {
      const b = await drivers.validate(id);
      setBanner({ type: b.validationStatus === "valid" ? "success" : "error", text: `Validation: ${STATUS_META[b.validationStatus].label}.` });
      await reload();
    }),
    [drivers, reload, withBusy]
  );

  const testLoad = useCallback(
    (id: string) => withBusy(async () => {
      const probe: DriverProbeResult = await drivers.testLoad(id);
      setBanner(
        probe.driverAvailable
          ? { type: "success", text: `Bridge loaded the driver (JDBC ${probe.driverVersion ?? "?"}, Java ${probe.javaVersion ?? "?"}${probe.ucpVersion && probe.ucpVersion !== "unavailable" ? `, UCP ${probe.ucpVersion}` : ", no UCP"}).` }
          : { type: "error", text: probe.probed ? "The driver did not load in the bridge." : probe.reason ?? "Could not run the load test." }
      );
    }),
    [drivers, withBusy]
  );

  const remove = useCallback(
    (b: OracleDriverBundleView) => withBusy(async () => {
      if (b.usageCount > 0) {
        setBanner({ type: "error", text: `"${b.name}" is used by ${b.usageCount} profile(s). Remap them first.` });
        return;
      }
      if (!window.confirm(`Delete driver bundle "${b.name}"? This removes its managed JARs from disk.`)) return;
      await drivers.remove(b.id);
      setBanner({ type: "success", text: `Removed "${b.name}".` });
      await reload();
    }),
    [drivers, reload, withBusy]
  );

  return (
    <section className="work-panel settings-card">
      <div className="settings-card-head">
        <Database size={16} />
        <h2>Oracle JDBC Drivers</h2>
      </div>
      <p className="settings-card-hint">
        Import and manage the Oracle JDBC/UCP driver bundles Specter uses to reach Oracle databases. Each bundle
        is copied into managed storage, hashed, and load-tested inside an isolated Java process — driver JARs are
        never loaded in the app itself. Connection profiles reference a bundle by name, never a file path.
      </p>

      <div className="oracle-driver-warning" role="note">
        <AlertTriangle size={15} />
        <span>{SECURITY_WARNING}</span>
      </div>

      <div className="settings-secret-form">
        <label>
          Bundle name
          <input
            type="text"
            value={name}
            placeholder="Oracle 23ai (ojdbc17)"
            spellCheck={false}
            autoComplete="off"
            onChange={(ev) => {
              setName(ev.target.value);
              setBanner(null);
            }}
          />
        </label>
        <button className="toolbar-button primary" type="button" disabled={busy} onClick={() => void importBundle()}>
          {busy ? <Loader2 size={15} className="spin" /> : <PlugZap size={15} />}
          Import driver bundle…
        </button>
      </div>
      {banner ? <p className={`form-message ${banner.type === "error" ? "error-text" : "ok-text"}`}>{banner.text}</p> : null}

      {loading ? (
        <p className="form-message">Loading driver bundles…</p>
      ) : bundles.length === 0 ? (
        <p className="form-message">No driver bundles imported yet. Import an <code>ojdbc*.jar</code> (and optionally a <code>ucp*.jar</code> for pooling) to enable live Oracle queries.</p>
      ) : (
        <div className="oracle-driver-list">
          {bundles.map((b) => {
            const meta = STATUS_META[b.validationStatus];
            return (
              <div className="oracle-driver-row" key={b.id}>
                <div className="oracle-driver-main">
                  <div className="oracle-driver-title">
                    {b.isDefault ? <Star size={14} className="oracle-driver-default" aria-label="Default bundle" /> : <Cpu size={14} />}
                    <strong>{b.name}</strong>
                    <span className={`oracle-driver-badge ${meta.tone}`}>{meta.label}</span>
                    {b.isDefault ? <span className="oracle-driver-badge default">Default</span> : null}
                    <span className="oracle-driver-badge muted">{b.source}</span>
                  </div>
                  <div className="oracle-driver-meta">
                    <span>JDBC <strong>{b.jdbcVersion ?? "—"}</strong></span>
                    <span>UCP <strong>{b.ucpJar ? b.ucpVersion ?? "included" : "not included"}</strong></span>
                    {b.requiredJavaMajor ? <span>Java <strong>{b.requiredJavaMajor}+</strong></span> : null}
                    <span>{b.compatibilityLabel ?? "Unknown"}</span>
                    {b.usageCount > 0 ? <span>Used by <strong>{b.usageCount}</strong></span> : null}
                  </div>
                  {expanded === b.id ? (
                    <div className="oracle-driver-checksums">
                      {Object.entries(b.checksums).map(([file, hash]) => (
                        <div key={file}>
                          <code>{file}</code>
                          <code className="muted">{hash}</code>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="oracle-driver-actions">
                  <button className="icon-button" type="button" title="Test bridge loading" disabled={busy} onClick={() => void testLoad(b.id)}>
                    <PlugZap size={14} />
                  </button>
                  <button className="icon-button" type="button" title="Validate (checksums + load)" disabled={busy} onClick={() => void validate(b.id)}>
                    {b.validationStatus === "valid" ? <CheckCircle2 size={14} /> : <ShieldCheck size={14} />}
                  </button>
                  <button className="icon-button" type="button" title={b.isDefault ? "Default bundle" : "Set as default"} disabled={busy || b.isDefault} onClick={() => void setDefault(b.id)}>
                    <Star size={14} />
                  </button>
                  <button className="icon-button" type="button" title={expanded === b.id ? "Hide checksums" : "View checksums"} onClick={() => setExpanded((cur) => (cur === b.id ? null : b.id))}>
                    <XCircle size={14} style={{ transform: expanded === b.id ? "rotate(45deg)" : "none" }} />
                  </button>
                  <button
                    className="icon-button danger"
                    type="button"
                    title={b.usageCount > 0 ? `In use by ${b.usageCount} profile(s)` : "Remove bundle"}
                    disabled={busy || b.usageCount > 0}
                    onClick={() => void remove(b)}
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
