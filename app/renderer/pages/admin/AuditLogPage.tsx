import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { AuditRecord } from "@src/security/store/SecurityStoreSchema";
import { useSession } from "../../security/SessionContext";
import { adminReasonMessage } from "./adminMessages";

/** Read-only security audit trail (most recent first). Non-secret projection from the trusted store. */
export function AuditLogPage() {
  const sessionRef = useSession()?.principal.sessionRef ?? "";
  const [rows, setRows] = useState<AuditRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    void window.playwrightFlowStudio.security.admin.listAudit({ sessionRef, limit: 300 }).then((r) => {
      if (r.ok && r.value) setRows(r.value); else setError(adminReasonMessage(r.reason));
      setLoading(false);
    });
  };
  useEffect(load, [sessionRef]);

  return (
    <div className="awkit-admin-page">
      {error ? <p className="form-message error" role="alert">{error}</p> : null}
      <section className="settings-card">
        <div className="awkit-admin-card-head">
          <h2>Audit log</h2>
          <button className="toolbar-button" onClick={load} disabled={loading}><RefreshCw size={14} /> Refresh</button>
        </div>
        {loading ? (
          <div className="awkit-login-loading"><Loader2 size={20} className="awkit-login-spin" /> Loading…</div>
        ) : (
          <div className="awkit-admin-table-scroll">
            <table className="awkit-admin-table">
              <thead><tr><th>When</th><th>Event</th><th>Actor</th><th>Target</th><th>Result</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.seq}>
                    <td>{new Date(r.at).toLocaleString()}</td>
                    <td><code>{r.eventType}</code>{r.reasonCode ? <span className="awkit-admin-muted"> · {r.reasonCode}</span> : null}</td>
                    <td>{r.actorName ?? "—"}</td>
                    <td>{r.targetType ? `${r.targetType}${r.targetId ? ` (${r.targetId.slice(0, 8)}…)` : ""}` : "—"}</td>
                    <td><span className={`awkit-admin-status ${r.result === "failure" ? "disabled" : "active"}`}>{r.result}</span></td>
                  </tr>
                ))}
                {rows.length === 0 ? <tr><td colSpan={5} className="awkit-admin-muted">No audit events yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
