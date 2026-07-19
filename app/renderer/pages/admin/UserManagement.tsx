import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Loader2, ShieldAlert, UserPlus } from "lucide-react";
import type { AdminUserView } from "@src/security/admin/UserAdminService";
import { useSession } from "../../security/SessionContext";
import { PasswordField } from "../../security/components/PasswordField";
import { ReauthDialog } from "./ReauthDialog";
import { adminReasonMessage } from "./adminMessages";

type AdminResponse<T> = { ok: boolean; value?: T; reason?: string; errors?: string[] };
interface RoleView { id: string; name: string; description: string; permissions: string[] }

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
    return <div className="awkit-admin-page"><div className="awkit-login-loading"><Loader2 size={20} className="awkit-login-spin" /> Loading users…</div></div>;
  }

  return (
    <div className="awkit-admin-page">
      {error ? <p className="form-message error" role="alert">{error}</p> : null}
      {notice ? <p className="form-message success" role="status">{notice}</p> : null}

      <CreateUserCard roles={roles} onCreate={(input) => sensitive(() => security().admin.createUser({ sessionRef, ...input }))} />

      <section className="settings-card">
        <h2>Users ({users.length})</h2>
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
                  <td><span className={`awkit-admin-status ${u.status}`}>{u.status}{u.mustChangePassword ? " · must reset" : ""}</span></td>
                  <td>{u.roles.length ? u.roles.map((r) => <span key={r} className="awkit-admin-role-chip">{r}</span>) : <span className="awkit-admin-muted">none</span>}</td>
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
      </section>

      {roleEditFor ? (
        <RoleEditModal
          user={roleEditFor}
          roles={roles}
          onCancel={() => setRoleEditFor(null)}
          onSave={(next) => { const u = roleEditFor; setRoleEditFor(null); void sensitive(() => security().admin.updateUser({ sessionRef, userId: u.id, roles: next })); }}
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
    </div>
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
    <section className="settings-card">
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
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((r) => r !== id) : [...selected, id]);
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

function RoleEditModal({ user, roles, onCancel, onSave }: { user: AdminUserView; roles: RoleView[]; onCancel: () => void; onSave: (roles: string[]) => void }) {
  const [selected, setSelected] = useState<string[]>(user.roles);
  return (
    <div className="awkit-admin-modal-backdrop" role="presentation" onClick={onCancel}>
      <div className="awkit-admin-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header className="awkit-admin-modal-head"><h2>Roles for {user.displayName}</h2></header>
        {user.isProtectedSuperUser ? <p className="awkit-admin-muted">The primary Super User always keeps the Super User role.</p> : null}
        <RolePicker roles={roles} selected={selected} onChange={setSelected} />
        <div className="awkit-admin-modal-actions">
          <button className="toolbar-button" onClick={onCancel}>Cancel</button>
          <button className="toolbar-button primary" onClick={() => onSave(selected)}>Save roles</button>
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
