import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ShieldAlert, UserPlus, Users as UsersIcon } from "lucide-react";
import type { AdminUserView } from "@src/security/admin/UserAdminService";
import { ALL_PERMISSIONS, ISSUER_ROLE } from "@src/security/authz/Permissions";
import { useSession } from "../../security/SessionContext";
import { PasswordField } from "../../security/components/PasswordField";
import { ReauthDialog } from "./ReauthDialog";
import { adminReasonMessage } from "./adminMessages";
import { AdminBanner, AdminEmpty, AdminLoading, AdminPage, AdminStatusBadge, AdminSummaryItem } from "./components/AdminUi";

type AdminResponse<T> = { ok: boolean; value?: T; reason?: string; errors?: string[] };
interface RoleView { id: string; name: string; description: string; builtIn: boolean; permissions: string[] }

const security = () => window.playwrightFlowStudio.security;

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
  const [roleEditFor, setRoleEditFor] = useState<AdminUserView | null>(null);
  const [resetFor, setResetFor] = useState<AdminUserView | null>(null);

  const reload = useCallback(async () => {
    const [u, r] = await Promise.all([security().admin.listUsers(sessionRef), security().admin.listRoles(sessionRef)]);
    if (u.ok && u.value) setUsers(u.value);
    else setError(adminReasonMessage(u.reason));
    if (r.ok && r.value) setRoles(r.value);
    setLoading(false);
  }, [sessionRef]);

  useEffect(() => { void reload(); }, [reload]);

  /** Run a sensitive admin call; if it needs a fresh reauth, prompt then retry once. */
  const sensitive = useCallback(async (fn: () => Promise<AdminResponse<unknown>>) => {
    setError(null);
    setNotice(null);
    const res = await fn();
    if (!res.ok && res.reason === "REAUTH_REQUIRED") { setPendingFn(() => fn); return; }
    if (!res.ok) { setError(adminReasonMessage(res.reason, res.errors)); return; }
    setNotice("Change applied.");
    await reload();
  }, [reload]);

  if (loading) {
    return <AdminPage><AdminLoading label="Loading users…" /></AdminPage>;
  }

  return (
    <AdminPage
      title="Users"
      description="Manage local accounts, access roles, credentials, and active sessions."
      summary={
        <>
          <AdminSummaryItem label="Total accounts" value={users.length} />
          <AdminSummaryItem label="Active" value={users.filter((user) => user.status === "active").length} />
          <AdminSummaryItem label="Needs password reset" value={users.filter((user) => user.mustChangePassword).length} />
        </>
      }
      banner={
        <>
          {error ? <AdminBanner tone="error">{error}</AdminBanner> : null}
          {notice ? <AdminBanner tone="success">{notice}</AdminBanner> : null}
        </>
      }
    >
      <div className="awkit-admin-split awkit-admin-users-layout">
      <section className="settings-card awkit-admin-primary-surface">
        <div className="awkit-admin-card-head">
          <h2><UsersIcon size={16} /> Account directory</h2>
          <span className="awkit-admin-muted">{users.length} user{users.length === 1 ? "" : "s"}</span>
        </div>
        {users.length === 0 ? (
          <AdminEmpty icon={UsersIcon} title="No users yet" hint="Create the first user with the form beside this directory." />
        ) : (
        <div className="awkit-admin-table-scroll">
          <table className="awkit-admin-table">
            <thead>
              <tr><th>User</th><th>Status</th><th>Roles</th><th>Last login</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="awkit-admin-user-cell">
                      <strong>{u.displayName}</strong>
                      <span>@{u.username}{u.isProtectedSuperUser ? <em className="awkit-admin-tag"><ShieldAlert size={12} /> Primary SU</em> : null}</span>
                    </div>
                  </td>
                  <td>
                    <div className="awkit-admin-status-cell">
                      <AdminStatusBadge status={u.status} />
                      {u.mustChangePassword ? <span className="awkit-admin-muted">must reset</span> : null}
                    </div>
                  </td>
                  <td>{u.roles.length ? u.roles.map((roleId) => (
                    <span key={roleId} className="awkit-admin-role-chip">
                      {roles.find((role) => role.id === roleId)?.name ?? roleId}
                    </span>
                  )) : <span className="awkit-admin-muted">none</span>}</td>
                  <td>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "—"}</td>
                  <td>
                    <div className="awkit-admin-row-actions">
                      <button className="toolbar-button" onClick={() => setRoleEditFor(u)}>Roles</button>
                      {u.status === "active" ? (
                        <button className="toolbar-button" disabled={u.isProtectedSuperUser} onClick={() => sensitive(() => security().admin.setStatus({ sessionRef, userId: u.id, status: "disabled" }))}>Disable</button>
                      ) : u.status === "disabled" ? (
                        <button className="toolbar-button" onClick={() => sensitive(() => security().admin.setStatus({ sessionRef, userId: u.id, status: "active" }))}>Enable</button>
                      ) : null}
                      <button className="toolbar-button" disabled={u.isProtectedSuperUser || u.status === "archived"} onClick={() => sensitive(() => security().admin.setStatus({ sessionRef, userId: u.id, status: "archived" }))}>Archive</button>
                      <button className="toolbar-button" onClick={() => setResetFor(u)}>Reset password</button>
                      <button className="toolbar-button" onClick={() => sensitive(() => security().admin.revokeSessions({ sessionRef, userId: u.id }))}>Sign out</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </section>
      <CreateUserCard roles={roles} onCreate={(input) => sensitive(() => security().admin.createUser({ sessionRef, ...input }))} />
      </div>

      {roleEditFor ? (
        <RoleEditModal
          user={roleEditFor}
          roles={roles}
          onCancel={() => setRoleEditFor(null)}
          onSave={(next) => {
            const u = roleEditFor;
            setRoleEditFor(null);
            void sensitive(() => security().admin.updateUser({
              sessionRef,
              userId: u.id,
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
          onSubmit={(newPassword) => { const u = resetFor; setResetFor(null); void sensitive(() => security().admin.resetPassword({ sessionRef, userId: u.id, newPassword })); }}
        />
      ) : null}

      {pendingFn ? (
        <ReauthDialog
          sessionRef={sessionRef}
          onCancel={() => setPendingFn(null)}
          onConfirmed={() => { const fn = pendingFn; setPendingFn(null); if (fn) void sensitive(fn); }}
        />
      ) : null}
    </AdminPage>
  );
}

function CreateUserCard({ roles, onCreate }: { roles: RoleView[]; onCreate: (input: { username: string; displayName?: string; password: string; roles: string[] }) => void }) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [selected, setSelected] = useState<string[]>(["Viewer"]);
  const canSubmit = username.trim().length > 0 && password.length > 0 && selected.length > 0;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onCreate({ username: username.trim(), displayName: displayName.trim() || undefined, password, roles: selected });
    setUsername(""); setDisplayName(""); setPassword(""); setSelected(["Viewer"]);
  };
  return (
    <section className="settings-card awkit-admin-create-card">
      <h2><UserPlus size={16} /> Add a user</h2>
      <form className="awkit-admin-create-form" onSubmit={submit}>
        <label className="awkit-login-field"><span className="awkit-login-field-label">Username</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} spellCheck={false} autoComplete="off" /></label>
        <label className="awkit-login-field"><span className="awkit-login-field-label">Display name (optional)</span>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
        <PasswordField label="Temporary password" value={password} onChange={setPassword} autoComplete="new-password" />
        <RolePicker roles={roles} selected={selected} onChange={setSelected} />
        <button type="submit" className="toolbar-button primary" disabled={!canSubmit}>Create user</button>
      </form>
    </section>
  );
}

function RolePicker({ roles, selected, onChange }: { roles: RoleView[]; selected: string[]; onChange: (next: string[]) => void }) {
  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((roleId) => roleId !== id));
      return;
    }
    // Issuer is a singleton security boundary and must be the account's only role.
    onChange(id === ISSUER_ROLE ? [ISSUER_ROLE] : [...selected.filter((roleId) => roleId !== ISSUER_ROLE), id]);
  };
  return (
    <fieldset className="awkit-admin-roles">
      <legend>Roles</legend>
      {roles.map((r) => (
        <label key={r.id} className="awkit-admin-role-option" title={r.description}>
          <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} /> {r.name}
        </label>
      ))}
    </fieldset>
  );
}

function RoleEditModal({
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(onCancel);
  const returnFocusRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null
  );
  useEffect(() => {
    cancelRef.current = onCancel;
  }, [onCancel]);
  useEffect(() => {
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    };
  }, []);
  const setOverride = (permission: string, effect: "inherit" | "grant" | "deny") => {
    setGrants((current) => effect === "grant"
      ? [...current.filter((item) => item !== permission), permission]
      : current.filter((item) => item !== permission));
    setDenies((current) => effect === "deny"
      ? [...current.filter((item) => item !== permission), permission]
      : current.filter((item) => item !== permission));
  };
  return (
    <div className="awkit-admin-modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        ref={dialogRef}
        className="awkit-admin-modal awkit-admin-role-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="awkit-user-access-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="awkit-admin-modal-head"><h2 id="awkit-user-access-title">Roles for {user.displayName}</h2></header>
        {user.isProtectedSuperUser ? <p className="awkit-admin-muted">The primary Super User always keeps the Super User role.</p> : null}
        <RolePicker roles={roles} selected={selected} onChange={setSelected} />
        {!user.isProtectedSuperUser ? (
          <fieldset className="awkit-admin-override-list">
            <legend>Direct permission overrides</legend>
            <p className="awkit-admin-muted">Deny takes precedence over every assigned role.</p>
            {ALL_PERMISSIONS.map((permission) => {
              const effect = grants.includes(permission) ? "grant" : denies.includes(permission) ? "deny" : "inherit";
              return (
                <label key={permission} className="awkit-admin-override-row">
                  <code>{permission}</code>
                  <select
                    value={effect}
                    aria-label={`${permission} override`}
                    onChange={(event) => setOverride(permission, event.target.value as "inherit" | "grant" | "deny")}
                  >
                    <option value="inherit">Inherit</option>
                    <option value="grant">Grant</option>
                    <option value="deny">Deny</option>
                  </select>
                </label>
              );
            })}
          </fieldset>
        ) : null}
        <div className="awkit-admin-modal-actions">
          <button className="toolbar-button" onClick={onCancel}>Cancel</button>
          <button
            className="toolbar-button primary"
            onClick={() => onSave({ roles: selected, permissionGrants: grants, permissionDenies: denies })}
          >
            Save access
          </button>
        </div>
      </div>
    </div>
  );
}

function ResetPasswordModal({ user, onCancel, onSubmit }: { user: AdminUserView; onCancel: () => void; onSubmit: (password: string) => void }) {
  const [password, setPassword] = useState("");
  return (
    <div className="awkit-admin-modal-backdrop" role="presentation" onClick={onCancel}>
      <form className="awkit-admin-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (password.length) onSubmit(password); }}>
        <header className="awkit-admin-modal-head"><h2>Reset password — {user.displayName}</h2></header>
        <p className="awkit-admin-modal-body">The user must change this password at their next sign-in, and all their sessions are ended.</p>
        <PasswordField label="New temporary password" value={password} onChange={setPassword} autoComplete="new-password" />
        <div className="awkit-admin-modal-actions">
          <button type="button" className="toolbar-button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="toolbar-button primary" disabled={password.length === 0}>Reset password</button>
        </div>
      </form>
    </div>
  );
}
