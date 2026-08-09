import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardList, Search } from "lucide-react";
import type { AuditRecord } from "@src/security/store/SecurityStoreSchema";
import { useSession } from "../../security/SessionContext";
import { usePageChrome } from "../../state/pageChrome";
import { adminReasonMessage } from "./adminMessages";
import { AdminBanner, AdminEmpty, AdminLoading, AdminPage, AdminStatusBadge, AdminSummaryItem } from "./components/AdminUi";

/** Read-only security audit trail (most recent first). Non-secret projection from the trusted store. */
export function AuditLogPage() {
  const sessionRef = useSession()?.principal.sessionRef ?? "";
  const [rows, setRows] = useState<AuditRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [resultFilter, setResultFilter] = useState("all");

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

  const results = useMemo(() => [...new Set(rows.map((row) => row.result))].sort(), [rows]);
  const filteredRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return rows.filter((row) => {
      if (resultFilter !== "all" && row.result !== resultFilter) return false;
      if (!query) return true;
      return [row.eventType, row.actorName, row.targetType, row.targetId, row.reasonCode, row.result]
        .some((value) => value?.toLocaleLowerCase().includes(query));
    });
  }, [resultFilter, rows, search]);

  return (
    <AdminPage
      title="Audit log"
      description="Inspect the local, read-only trail of privileged actions and security decisions."
      summary={
        <>
          <AdminSummaryItem label="Loaded events" value={rows.length} />
          <AdminSummaryItem label="Visible" value={filteredRows.length} />
          <AdminSummaryItem label="Failed" value={rows.filter((row) => row.result.toLocaleLowerCase() === "failure").length} />
        </>
      }
      banner={error ? <AdminBanner tone="error">{error}</AdminBanner> : undefined}
    >
      <section className="settings-card awkit-admin-primary-surface">
        <div className="awkit-admin-card-head">
          <h2><ClipboardList size={16} /> Security events</h2>
          <span className="awkit-admin-muted">{filteredRows.length} of {rows.length}</span>
        </div>
        <div className="awkit-admin-filter-bar" role="search" aria-label="Audit filters">
          <label className="awkit-admin-search-field">
            <span className="sr-only">Search audit events</span>
            <Search size={15} aria-hidden="true" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} type="search" placeholder="Search event, actor, target, or reason…" />
          </label>
          <label className="awkit-admin-filter-field">
            <span>Result</span>
            <select value={resultFilter} onChange={(event) => setResultFilter(event.target.value)}>
              <option value="all">All results</option>
              {results.map((result) => <option value={result} key={result}>{result}</option>)}
            </select>
          </label>
        </div>
        {loading ? (
          <AdminLoading label="Loading audit events…" />
        ) : rows.length === 0 ? (
          <AdminEmpty icon={ClipboardList} title="No audit events yet" hint="Privileged actions will appear here as they happen." />
        ) : filteredRows.length === 0 ? (
          <AdminEmpty icon={Search} title="No matching audit events" hint="Clear or change the current filters." />
        ) : (
          <div className="awkit-admin-table-scroll">
            <table className="awkit-admin-table">
              <thead>
                <tr><th>When</th><th>Event</th><th scope="col">Actor</th><th>Target</th><th>Result</th></tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => (
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
