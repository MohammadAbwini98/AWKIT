import { useCallback, useEffect, useState } from "react";
import { ClipboardList } from "lucide-react";
import type { AuditRecord } from "@src/security/store/SecurityStoreSchema";
import { useSession } from "../../security/SessionContext";
import { usePageChrome } from "../../state/pageChrome";
import { adminReasonMessage } from "./adminMessages";
import { AdminBanner, AdminEmpty, AdminLoading, AdminPage, AdminStatusBadge } from "./components/AdminUi";

/** Read-only security audit trail (most recent first). Non-secret projection from the trusted store. */
export function AuditLogPage() {
  const sessionRef = useSession()?.principal.sessionRef ?? "";
  const [rows, setRows] = useState<AuditRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    void window.playwrightFlowStudio.security.admin.listAudit({ sessionRef, limit: 300 }).then((r) => {
      if (r.ok && r.value) setRows(r.value);
      else setError(adminReasonMessage(r.reason));
      setLoading(false);
    });
  }, [sessionRef]);
  useEffect(load, [load]);

  // Primary page action lives in the shared TopHeader, not a card, so every Administration page reads alike.
  usePageChrome(
    { actions: [{ id: "audit-refresh", label: "Refresh", onClick: load, disabled: loading }], dirty: false },
    [load, loading]
  );

  return (
    <AdminPage banner={error ? <AdminBanner tone="error">{error}</AdminBanner> : undefined}>
      <section className="settings-card">
        <h2><ClipboardList size={16} /> Audit log</h2>
        {loading ? (
          <AdminLoading label="Loading audit events…" />
        ) : rows.length === 0 ? (
          <AdminEmpty icon={ClipboardList} title="No audit events yet" hint="Privileged actions will appear here as they happen." />
        ) : (
          <div className="awkit-admin-table-scroll">
            <table className="awkit-admin-table">
              <thead>
                <tr><th>When</th><th>Event</th><th scope="col">Actor</th><th>Target</th><th>Result</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.seq}>
                    <td>{new Date(r.at).toLocaleString()}</td>
                    <td><code>{r.eventType}</code>{r.reasonCode ? <span className="awkit-admin-muted"> · {r.reasonCode}</span> : null}</td>
                    <td>{r.actorName ?? "—"}</td>
                    <td>{r.targetType ? `${r.targetType}${r.targetId ? ` (${r.targetId.slice(0, 8)}…)` : ""}` : "—"}</td>
                    <td><AdminStatusBadge status={r.result} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AdminPage>
  );
}
