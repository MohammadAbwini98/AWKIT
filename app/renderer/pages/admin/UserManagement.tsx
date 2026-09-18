import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  Ban,
  CheckCircle2,
  Clock,
  KeyRound,
  Lock,
  LogOut,
  MoreHorizontal,
  Plus,
  ShieldCheck,
  UserCheck,
  Users as UsersIcon,
  type LucideIcon
} from "lucide-react";
import type { AdminUserView } from "@src/security/admin/UserAdminService";
import { ALL_PERMISSIONS, ISSUER_ROLE } from "@src/security/authz/Permissions";
import { useSession } from "../../security/SessionContext";
import { PasswordField } from "../../security/components/PasswordField";
import { routes } from "../../routes";
import { NodeOptionsMenu } from "../../components/shared/NodeOptionsMenu";
import {
  SysAdminHead,
  SysBadge,
  SysBanner,
  SysButton,
  SysCellActions,
  SysCellText,
  SysCheckPill,
  SysChips,
  SysField,
  SysFilters,
  SysFormError,
  SysIconButton,
  SysMainCell,
  SysMetric,
  SysMetrics,
  SysModal,
  SysModalBody,
  SysModalFields,
  SysPage,
  SysPagination,
  SysSelect,
  SysTable,
  SysTableCard,
  SysTableEmpty,
  SysTdCheck,
  SysTh,
  SysThCheck,
  sortRows,
  useSysFilters,
  useSysPaging,
  useSysSelection,
  useSysSort,
  type SysFilterField,
  type SysTone
} from "../../components/system/SystemUI";
import { ReauthDialog } from "./ReauthDialog";
import { adminReasonMessage } from "./adminMessages";

type AdminResponse<T> = { ok: boolean; value?: T; reason?: string; errors?: string[] };
interface RoleView { id: string; name: string; description: string; builtIn: boolean; permissions: string[] }

const security = () => window.playwrightFlowStudio.security;

function isLocked(user: AdminUserView, now: number): boolean {
  return Boolean(user.lockedUntil && Date.parse(user.lockedUntil) > now);
}

/** Display state shown in the Status column; drives tone, glyph, and the identity tile. */
function userState(user: AdminUserView, now: number): { key: string; label: string; tone: SysTone; icon: LucideIcon } {
  if (user.status === "archived") return { key: "archived", label: "Archived", tone: "neutral", icon: Archive };
  if (user.status === "disabled") return { key: "disabled", label: "Disabled", tone: "warning", icon: Ban };
  if (isLocked(user, now)) return { key: "locked", label: "Locked", tone: "warning", icon: Lock };
  if (user.mustChangePassword) return { key: "reset", label: "Reset pending", tone: "info", icon: Clock };
  return { key: "active", label: "Active", tone: "success", icon: CheckCircle2 };
}

function relativeTime(iso: string | null, now: number): string {
  if (!iso) return "Never";
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "—";
  const minutes = Math.round((now - at) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  if (hours < 48) return "Yesterday";
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const STATUS_FILTER: SysFilterField = {
  key: "status",
  label: "Status",
  type: "select",
  options: [
    { value: "all", label: "Any" },
    { value: "active", label: "Active" },
    { value: "reset", label: "Reset pending" },
    { value: "locked", label: "Locked" },
    { value: "disabled", label: "Disabled" },
    { value: "archived", label: "Archived" }
  ]
};

/** Super-User → Users: create, assign roles, enable/disable, archive, reset password, revoke sessions. */
export function UserManagement() {
  const session = useSession();
  const sessionRef = session?.principal.sessionRef ?? "";
  const [users, setUsers] = useState<AdminUserView[]>([]);
  const [roles, setRoles] = useState<RoleView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingFn, setPendingFn] = useState<(() => Promise<AdminResponse<unknown>>) | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [accessFor, setAccessFor] = useState<AdminUserView | null>(null);
  const [resetFor, setResetFor] = useState<AdminUserView | null>(null);
  const [menu, setMenu] = useState<{ user: AdminUserView; anchor: HTMLElement } | null>(null);
  const filters = useSysFilters();
  const { sort, toggle: toggleSort } = useSysSort("name");
  const now = Date.now();

  const reload = useCallback(async () => {
    const [u, r] = await Promise.all([security().admin.listUsers(sessionRef), security().admin.listRoles(sessionRef)]);
    if (u.ok && u.value) setUsers(u.value);
    else setError(adminReasonMessage(u.reason));
    if (r.ok && r.value) setRoles(r.value);
    setLoading(false);
  }, [sessionRef]);

  useEffect(() => { void reload(); }, [reload]);

  /** Run a sensitive admin call; if it needs a fresh reauth, prompt then retry once. */
  const sensitive = useCallback(async (fn: () => Promise<AdminResponse<unknown>>, success = "Change applied.") => {
    setError(null);
    setNotice(null);
    const res = await fn();
    if (!res.ok && res.reason === "REAUTH_REQUIRED") { setPendingFn(() => fn); return false; }
    if (!res.ok) { setError(adminReasonMessage(res.reason, res.errors)); return false; }
    setNotice(success);
    await reload();
    return true;
  }, [reload]);

  const roleName = useCallback((roleId: string) => roles.find((role) => role.id === roleId)?.name ?? roleId, [roles]);

  const filtered = useMemo(() => {
    const query = filters.search.trim().toLocaleLowerCase();
    const status = filters.applied.status;
    const role = filters.applied.role;
    return users.filter((user) => {
      if (status && userState(user, now).key !== status) return false;
      if (role && !user.roles.includes(role)) return false;
      if (!query) return true;
      return [user.displayName, user.username, ...user.roles.map(roleName)].some((value) => value.toLocaleLowerCase().includes(query));
    });
  }, [filters.applied, filters.search, now, roleName, users]);

  const sorted = useMemo(
    () =>
      sortRows(filtered, sort, {
        name: (user) => (user.displayName || user.username).toLocaleLowerCase(),
        status: (user) => userState(user, now).label,
        lastLogin: (user) => (user.lastLoginAt ? Date.parse(user.lastLoginAt) : 0),
        failed: (user) => user.failedLoginCount
      }),
    [filtered, now, sort]
  );
  const paging = useSysPaging(sorted.length);
  const pageRows = paging.slice(sorted);
  const selection = useSysSelection(pageRows.map((user) => user.id));
  const selectedUsers = users.filter((user) => selection.selected.includes(user.id));
  const disableTargets = selectedUsers.filter((user) => user.status === "active" && !user.isProtectedSuperUser);

  const filterFields = useMemo<SysFilterField[]>(
    () => [
      STATUS_FILTER,
      { key: "role", label: "Role", type: "select", options: [{ value: "all", label: "Any" }, ...roles.map((role) => ({ value: role.id, label: role.name }))] }
    ],
    [roles]
  );

  const disableSelected = async () => {
    for (const user of disableTargets) {
      const ok = await sensitive(
        () => security().admin.setStatus({ sessionRef, userId: user.id, status: "disabled" }),
        `${disableTargets.length} account${disableTargets.length === 1 ? "" : "s"} disabled.`
      );
      if (!ok) break;
    }
    selection.clear();
  };

  const activeCount = users.filter((user) => userState(user, now).key === "active").length;
  const disabledCount = users.filter((user) => user.status === "disabled").length;
  const lockedCount = users.filter((user) => user.status === "active" && isLocked(user, now)).length;
  const resetCount = users.filter((user) => user.mustChangePassword).length;

  return (
    <SysPage className="users-page">
      <SysAdminHead
        title="Users"
        description={routes.find((route) => route.id === "userManagement")?.description}
        actions={
          <SysButton kind="primary" icon={Plus} disabled={loading} onClick={() => { setError(null); setCreateOpen(true); }}>
            Create user
          </SysButton>
        }
      />
      {error ? <SysBanner tone="danger">{error}</SysBanner> : null}
      {notice ? <SysBanner tone="success">{notice}</SysBanner> : null}

      <SysMetrics min={210} label="User summary">
        <SysMetric loading={loading} tone="info" icon={UsersIcon} label="Users" value={users.length} detail={`${disabledCount} disabled, ${lockedCount} locked`} />
        <SysMetric loading={loading} tone="success" icon={UserCheck} label="Active accounts" value={activeCount} detail="Signed in with no pending reset or lockout" />
        <SysMetric loading={loading} tone="warning" icon={KeyRound} label="Password resets" value={resetCount} detail="Pending forced change on next sign-in" />
        <SysMetric loading={loading} tone="danger" icon={Lock} label="Locked accounts" value={lockedCount} detail={lockedCount ? "Repeated failed sign-in attempts" : "No sign-in lockouts"} />
      </SysMetrics>

      <SysFilters label="User filters" searchPlaceholder="Search users by name, username or role…" fields={filterFields} state={filters} />

      <SysTableCard
        title="Users"
        selectionCount={selection.selected.length}
        actions={
          <>
            <SysButton
              kind="small"
              icon={KeyRound}
              disabled={selectedUsers.length !== 1}
              title={selectedUsers.length === 1 ? "Reset the selected user's password" : "Select exactly one user"}
              onClick={() => setResetFor(selectedUsers[0] ?? null)}
            >
              Reset password
            </SysButton>
            <SysButton
              kind="smallDanger"
              icon={Ban}
              disabled={disableTargets.length === 0}
              title={disableTargets.length ? "Disable the selected active accounts" : "Select an active, non-protected account"}
              onClick={() => void disableSelected()}
            >
              Disable
            </SysButton>
          </>
        }
      >
        {loading ? (
          <SysTableEmpty icon={UsersIcon} title="Loading users…" />
        ) : users.length === 0 ? (
          <SysTableEmpty icon={UsersIcon} title="No users yet" hint="Create the first account with Create user." />
        ) : sorted.length === 0 ? (
          <SysTableEmpty
            icon={UsersIcon}
            title="No rows match your filters"
            hint="Clear the applied filters to see all rows again."
            actionLabel="Clear filters"
            onAction={filters.clear}
          />
        ) : (
          <SysTable minWidth={940} caption="User directory">
            <thead>
              <tr>
                <SysThCheck checked={selection.allSelected} onChange={selection.toggleAll} />
                <SysTh label="User" sortKey="name" sort={sort} onSort={toggleSort} />
                <SysTh label="Roles" width={230} />
                <SysTh label="Status" sortKey="status" sort={sort} onSort={toggleSort} width={160} />
                <SysTh label="Last sign-in" sortKey="lastLogin" sort={sort} onSort={toggleSort} width={160} />
                <SysTh label="Failed sign-ins" sortKey="failed" sort={sort} onSort={toggleSort} align="right" width={130} />
                <SysTh label="" width={140} />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((user) => {
                const state = userState(user, now);
                const selected = selection.isSelected(user.id);
                const subParts = [
                  user.username,
                  user.isProtectedSuperUser ? "protected super user" : "",
                  user.mustChangePassword ? "forced password change pending" : ""
                ].filter(Boolean);
                return (
                  <tr key={user.id} className={selected ? "is-selected" : undefined}>
                    <SysTdCheck checked={selected} onChange={() => selection.toggle(user.id)} label={`Select ${user.displayName || user.username}`} />
                    <td>
                      <SysMainCell
                        tone={state.key === "active" ? "running" : state.key === "archived" || state.key === "disabled" ? "neutral" : "warning"}
                        icon={state.key === "active" ? UsersIcon : state.key === "reset" ? KeyRound : state.icon}
                        text={user.displayName || user.username}
                        sub={subParts.join(" · ")}
                      />
                    </td>
                    <td>{user.roles.length ? <SysChips items={user.roles.map(roleName)} /> : <SysCellText muted>None</SysCellText>}</td>
                    <td>
                      <SysBadge tone={state.tone} icon={state.icon}>
                        {state.label}
                      </SysBadge>
                    </td>
                    <td>
                      <SysCellText num muted={!user.lastLoginAt || user.status !== "active"} title={user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : undefined}>
                        {relativeTime(user.lastLoginAt, now)}
                      </SysCellText>
                    </td>
                    <td className="sys-td-actions">
                      <SysCellText num muted={user.failedLoginCount === 0}>
                        {user.failedLoginCount}
                      </SysCellText>
                    </td>
                    <td className="sys-td-actions">
                      <SysCellActions>
                        <SysIconButton icon={ShieldCheck} label="Edit access" onClick={() => setAccessFor(user)} />
                        <SysIconButton icon={KeyRound} label="Reset password" onClick={() => setResetFor(user)} />
                        {user.status === "active" ? (
                          <SysIconButton
                            icon={Ban}
                            label="Disable"
                            tone="danger"
                            title={user.isProtectedSuperUser ? "The primary Super User cannot be disabled" : "Disable account"}
                            disabled={user.isProtectedSuperUser}
                            onClick={() => void sensitive(() => security().admin.setStatus({ sessionRef, userId: user.id, status: "disabled" }))}
                          />
                        ) : user.status === "disabled" ? (
                          <SysIconButton
                            icon={UserCheck}
                            label="Enable"
                            title="Enable account"
                            onClick={() => void sensitive(() => security().admin.setStatus({ sessionRef, userId: user.id, status: "active" }))}
                          />
                        ) : null}
                        <button
                          type="button"
                          className="sys-icon-btn"
                          aria-label={`${user.displayName || user.username} actions`}
                          aria-haspopup="menu"
                          title="More actions"
                          onClick={(event) => setMenu({ user, anchor: event.currentTarget })}
                        >
                          <MoreHorizontal size={16} aria-hidden="true" />
                        </button>
                      </SysCellActions>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </SysTable>
        )}
        <SysPagination
          total={sorted.length}
          noun="users"
          page={paging.page}
          pageSize={paging.pageSize}
          totalPages={paging.totalPages}
          onPage={paging.setPage}
          onPageSize={paging.setPageSize}
        />
      </SysTableCard>

      <NodeOptionsMenu
        open={Boolean(menu)}
        anchor={menu?.anchor ?? null}
        onClose={() => setMenu(null)}
        items={
          menu
            ? [
                {
                  id: "archive",
                  label: "Archive account",
                  icon: Archive,
                  tone: "danger",
                  disabled: menu.user.isProtectedSuperUser || menu.user.status === "archived",
                  title: menu.user.isProtectedSuperUser ? "The primary Super User cannot be archived" : undefined,
                  onSelect: () => void sensitive(() => security().admin.setStatus({ sessionRef, userId: menu.user.id, status: "archived" }))
                },
                {
                  id: "sign-out",
                  label: "End active sessions",
                  icon: LogOut,
                  onSelect: () => void sensitive(() => security().admin.revokeSessions({ sessionRef, userId: menu.user.id }), "Active sessions ended.")
                }
              ]
            : []
        }
      />

      {createOpen ? (
        <CreateUserModal
          roles={roles}
          error={error}
          onCancel={() => setCreateOpen(false)}
          onCreate={async (input) => {
            const ok = await sensitive(() => security().admin.createUser({ sessionRef, ...input }), "User created.");
            if (ok) setCreateOpen(false);
          }}
        />
      ) : null}

      {accessFor ? (
        <AccessModal
          user={accessFor}
          roles={roles}
          onCancel={() => setAccessFor(null)}
          onSave={(next) => {
            const user = accessFor;
            setAccessFor(null);
            void sensitive(() => security().admin.updateUser({
              sessionRef,
              userId: user.id,
              roles: next.roles,
              permissionGrants: next.permissionGrants,
              permissionDenies: next.permissionDenies
            }));
          }}
        />
      ) : null}

      {resetFor ? (
        <ResetPasswordModal
          user={resetFor}
          onCancel={() => setResetFor(null)}
          onSubmit={(newPassword) => {
            const user = resetFor;
            setResetFor(null);
            void sensitive(() => security().admin.resetPassword({ sessionRef, userId: user.id, newPassword }), "Password reset. Active sessions ended.");
          }}
        />
      ) : null}

      {pendingFn ? (
        <ReauthDialog
          sessionRef={sessionRef}
          onCancel={() => setPendingFn(null)}
          onConfirmed={() => {
            const fn = pendingFn;
            setPendingFn(null);
            // A held create that now succeeds closes its dialog, exactly like the no-reauth path.
            if (fn) void sensitive(fn).then((ok) => { if (ok) setCreateOpen(false); });
          }}
        />
      ) : null}
    </SysPage>
  );
}

/** Role check pills. Issuer is a singleton security boundary and must be the account's only role. */
function RolePills({ roles, selected, onChange }: { roles: RoleView[]; selected: string[]; onChange: (next: string[]) => void }) {
  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((roleId) => roleId !== id));
      return;
    }
    onChange(id === ISSUER_ROLE ? [ISSUER_ROLE] : [...selected.filter((roleId) => roleId !== ISSUER_ROLE), id]);
  };
  return (
    <span className="sys-check-pills" role="group" aria-label="Roles">
      {roles.map((role) => (
        <SysCheckPill key={role.id} checked={selected.includes(role.id)} onChange={() => toggle(role.id)} title={role.description}>
          {role.name}
        </SysCheckPill>
      ))}
    </span>
  );
}

function CreateUserModal({
  roles,
  error,
  onCancel,
  onCreate
}: {
  roles: RoleView[];
  /** The last rejection (weak password, duplicate username…), repeated inside the dialog. */
  error: string | null;
  onCancel: () => void;
  onCreate: (input: { username: string; displayName?: string; password: string; roles: string[] }) => Promise<void>;
}) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [selected, setSelected] = useState<string[]>(["Viewer"]);
  const [busy, setBusy] = useState(false);
  const canSubmit = username.trim().length > 0 && password.length > 0 && selected.length > 0 && !busy;
  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await onCreate({ username: username.trim(), displayName: displayName.trim() || undefined, password, roles: selected });
    } finally {
      setBusy(false);
    }
  };
  return (
    <SysModal
      icon={UsersIcon}
      title="Create user"
      message="The new account signs in with a temporary password and is forced to change it immediately."
      onClose={onCancel}
      className="users-create-modal"
      onSubmit={() => void submit()}
      actions={
        <>
          <SysButton kind="secondary" onClick={onCancel}>Cancel</SysButton>
          <SysButton kind="primary" type="submit" disabled={!canSubmit}>Create user</SysButton>
        </>
      }
    >
      <SysModalFields>
        <SysField label="Display name">
          <input className="sys-control" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Optional" />
        </SysField>
        <SysField label="Username">
          <input className="sys-control is-mono" value={username} onChange={(event) => setUsername(event.target.value)} spellCheck={false} autoComplete="off" autoFocus />
        </SysField>
        <SysField label="Roles" group wide hint="Deny by default — a role that holds no permission in a group hides that group entirely">
          <RolePills roles={roles} selected={selected} onChange={setSelected} />
        </SysField>
        <div className="sys-field is-wide">
          <PasswordField label="Temporary password" value={password} onChange={setPassword} autoComplete="new-password" hint="Strength is checked on submit" />
        </div>
        {error ? (
          <div className="sys-field is-wide">
            <SysFormError>{error}</SysFormError>
          </div>
        ) : null}
      </SysModalFields>
    </SysModal>
  );
}

function AccessModal({
  user,
  roles,
  onCancel,
  onSave
}: {
  user: AdminUserView;
  roles: RoleView[];
  onCancel: () => void;
  onSave: (next: { roles: string[]; permissionGrants: string[]; permissionDenies: string[] }) => void;
}) {
  const [selected, setSelected] = useState<string[]>(user.roles);
  const [grants, setGrants] = useState<string[]>(user.permissionGrants);
  const [denies, setDenies] = useState<string[]>(user.permissionDenies);
  const setOverride = (permission: string, effect: "inherit" | "grant" | "deny") => {
    setGrants((current) => (effect === "grant" ? [...current.filter((item) => item !== permission), permission] : current.filter((item) => item !== permission)));
    setDenies((current) => (effect === "deny" ? [...current.filter((item) => item !== permission), permission] : current.filter((item) => item !== permission)));
  };
  return (
    <SysModal
      icon={ShieldCheck}
      title={`Access for ${user.displayName || user.username}`}
      message={
        user.isProtectedSuperUser
          ? "The primary Super User always keeps the Super User role."
          : "Roles grant permission sets; a direct Deny takes precedence over every assigned role."
      }
      width={620}
      className="users-access-modal"
      onClose={onCancel}
      onSubmit={() => onSave({ roles: selected, permissionGrants: grants, permissionDenies: denies })}
      actions={
        <>
          <SysButton kind="secondary" onClick={onCancel}>Cancel</SysButton>
          <SysButton kind="primary" type="submit">Save access</SysButton>
        </>
      }
    >
      <SysModalBody>
        <SysField label="Roles" group>
          <RolePills roles={roles} selected={selected} onChange={setSelected} />
        </SysField>
        {!user.isProtectedSuperUser ? (
          <div className="users-override-list" role="group" aria-label="Direct permission overrides">
            <span className="sys-field-label">Direct permission overrides</span>
            {ALL_PERMISSIONS.map((permission) => {
              const effect = grants.includes(permission) ? "grant" : denies.includes(permission) ? "deny" : "inherit";
              return (
                <div className="users-override-row" key={permission}>
                  <code>{permission}</code>
                  <SysSelect
                    value={effect}
                    aria-label={`${permission} override`}
                    onChange={(event) => setOverride(permission, event.target.value as "inherit" | "grant" | "deny")}
                  >
                    <option value="inherit">Inherit</option>
                    <option value="grant">Grant</option>
                    <option value="deny">Deny</option>
                  </SysSelect>
                </div>
              );
            })}
          </div>
        ) : null}
      </SysModalBody>
    </SysModal>
  );
}

function ResetPasswordModal({ user, onCancel, onSubmit }: { user: AdminUserView; onCancel: () => void; onSubmit: (password: string) => void }) {
  const [password, setPassword] = useState("");
  return (
    <SysModal
      role="alertdialog"
      tone="warning"
      icon={KeyRound}
      width={440}
      title={`Reset password for ${user.username}?`}
      message="All active sessions for this user are revoked and a forced password change is required at next sign-in."
      className="users-reset-modal"
      onClose={onCancel}
      onSubmit={() => { if (password.length) onSubmit(password); }}
      actions={
        <>
          <SysButton kind="secondary" onClick={onCancel}>Cancel</SysButton>
          <SysButton kind="danger" type="submit" disabled={password.length === 0}>Reset and revoke</SysButton>
        </>
      }
    >
      <SysModalFields>
        <div className="sys-field is-wide">
          <PasswordField label="Temporary password" value={password} onChange={setPassword} autoComplete="new-password" autoFocus />
        </div>
      </SysModalFields>
    </SysModal>
  );
}
