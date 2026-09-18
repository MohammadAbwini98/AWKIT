import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardList, Download, RotateCw, ShieldAlert, Users as UsersIcon, XCircle } from "lucide-react";
import type { AuditRecord } from "@src/security/store/SecurityStoreSchema";
import { useSession } from "../../security/SessionContext";
import { routes } from "../../routes";
import {
  SysAdminHead,
  SysBadge,
  SysBanner,
  SysButton,
  SysCellText,
  SysFilters,
  SysMainCell,
  SysPage,
  SysPagination,
  SysTable,
  SysTableCard,
  SysTableEmpty,
  SysTh,
  sortRows,
  useSysFilters,
  useSysPaging,
  useSysSort,
  type SysFilterField
} from "../../components/system/SystemUI";
import { adminReasonMessage } from "./adminMessages";

const AUDIT_LIMIT = 300;

function auditTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  return at.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Read-only security audit trail (most recent first). Non-secret projection from the trusted store. */
export function AuditLogPage() {
  const sessionRef = useSession()?.principal.sessionRef ?? "";
  const [rows, setRows] = useState<AuditRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const filters = useSysFilters();
  const { sort, toggle: toggleSort } = useSysSort("when", "desc");

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    void window.playwrightFlowStudio.security.admin.listAudit({ sessionRef, limit: AUDIT_LIMIT }).then((r) => {
      if (r.ok && r.value) setRows(r.value);
      else setError(adminReasonMessage(r.reason));
      setLoading(false);
    });
  }, [sessionRef]);
  useEffect(load, [load]);

  const fields = useMemo<SysFilterField[]>(
    () => [
      { key: "actor", label: "Actor", type: "text", placeholder: "username" },
      {
        key: "action",
        label: "Action",
        type: "select",
        options: [{ value: "all", label: "Any" }, ...[...new Set(rows.map((row) => row.eventType))].sort().map((value) => ({ value, label: value }))]
      },
      {
        key: "outcome",
        label: "Outcome",
        type: "select",
        options: [
          { value: "all", label: "Any" },
          { value: "success", label: "Success" },
          { value: "failure", label: "Failure" }
        ]
      },
      { key: "since", label: "Since", type: "date" }
    ],
    [rows]
  );

  const filtered = useMemo(() => {
    const query = filters.search.trim().toLocaleLowerCase();
    const { actor, action, outcome, since } = filters.applied;
    const sinceMs = since ? Date.parse(since) : Number.NaN;
    return rows.filter((row) => {
      if (actor && !(row.actorName ?? "").toLocaleLowerCase().includes(actor.toLocaleLowerCase())) return false;
      if (action && row.eventType !== action) return false;
      if (outcome && row.result !== outcome) return false;
      if (!Number.isNaN(sinceMs) && Date.parse(row.at) < sinceMs) return false;
      if (!query) return true;
      return [row.eventType, row.actorName, row.targetType, row.targetId, row.reasonCode, row.result].some((value) =>
        value?.toLocaleLowerCase().includes(query)
      );
    });
  }, [filters.applied, filters.search, rows]);

  const sorted = useMemo(
    () =>
      sortRows(filtered, sort, {
        when: (row) => row.seq,
        actor: (row) => (row.actorName ?? "").toLocaleLowerCase(),
        action: (row) => row.eventType,
        outcome: (row) => row.result
      }),
    [filtered, sort]
  );
  const paging = useSysPaging(sorted.length);
  const pageRows = paging.slice(sorted);

  const exportLog = () => {
    const href = URL.createObjectURL(
      new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), entries: sorted }, null, 2)], { type: "application/json" })
    );
    const link = document.createElement("a");
    link.href = href;
    link.download = "specterstudio-audit-log.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 0);
  };

  return (
    <SysPage className="audit-page">
      <SysAdminHead
        title="Audit Log"
        description={routes.find((route) => route.id === "auditLog")?.description}
        actions={
          <>
            <SysButton kind="secondary" icon={RotateCw} disabled={loading} onClick={load}>
              Refresh
            </SysButton>
            <SysButton kind="secondary" icon={Download} disabled={loading || sorted.length === 0} onClick={exportLog} title="Export the entries in view as JSON">
              Export log
            </SysButton>
          </>
        }
      />
      {error ? <SysBanner tone="danger">{error}</SysBanner> : null}

      <SysFilters label="Audit filters" searchPlaceholder="Search the audit trail by actor, action or target…" fields={fields} state={filters} />

      <SysTableCard title="Privileged actions">
        {loading ? (
          <SysTableEmpty icon={ClipboardList} title="Loading audit events…" />
        ) : rows.length === 0 ? (
          <SysTableEmpty icon={ClipboardList} title="No audit events yet" hint="Privileged actions will appear here as they happen." />
        ) : sorted.length === 0 ? (
          <SysTableEmpty
            icon={ClipboardList}
            title="No rows match your filters"
            hint="Clear the applied filters to see all rows again."
            actionLabel="Clear filters"
            onAction={filters.clear}
          />
        ) : (
          <SysTable minWidth={1000} caption="Privileged action audit trail">
            <thead>
              <tr>
                <SysTh label="When" sortKey="when" sort={sort} onSort={toggleSort} width={170} />
                <SysTh label="Actor" sortKey="actor" sort={sort} onSort={toggleSort} width={200} />
                <SysTh label="Action" sortKey="action" sort={sort} onSort={toggleSort} width={230} />
                <SysTh label="Target" />
                <SysTh label="Outcome" sortKey="outcome" sort={sort} onSort={toggleSort} width={140} />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => {
                const failed = row.result === "failure";
                return (
                  <tr key={row.seq}>
                    <td>
                      <time dateTime={row.at}>
                        <SysCellText num muted title={new Date(row.at).toLocaleString()}>
                          {auditTime(row.at)}
                        </SysCellText>
                      </time>
                    </td>
                    <td>
                      <SysMainCell
                        tone={failed ? "danger" : "running"}
                        icon={failed ? ShieldAlert : UsersIcon}
                        text={row.actorName ?? "System"}
                        sub={row.reasonCode ?? `Event #${row.seq}`}
                      />
                    </td>
                    <td>
                      <SysCellText mono strong>
                        {row.eventType}
                      </SysCellText>
                    </td>
                    <td>
                      <SysCellText muted title={row.targetId ?? undefined}>
                        {row.targetType ? `${row.targetType}${row.targetId ? ` · ${row.targetId.slice(0, 8)}…` : ""}` : "—"}
                      </SysCellText>
                    </td>
                    <td>
                      {failed ? (
                        <SysBadge tone="danger" icon={XCircle}>Failure</SysBadge>
                      ) : (
                        <SysBadge tone="success" icon={CheckCircle2}>Success</SysBadge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </SysTable>
        )}
        <SysPagination
          total={sorted.length}
          noun={rows.length >= AUDIT_LIMIT ? `entries (most recent ${AUDIT_LIMIT})` : "entries"}
          page={paging.page}
          pageSize={paging.pageSize}
          totalPages={paging.totalPages}
          onPage={paging.setPage}
          onPageSize={paging.setPageSize}
        />
      </SysTableCard>
    </SysPage>
  );
}
