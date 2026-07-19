import { useState, type FormEvent } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { PasswordField } from "../../security/components/PasswordField";
import { adminReasonMessage } from "./adminMessages";

interface ReauthDialogProps {
  sessionRef: string;
  /** Called after a successful re-authentication (the caller then retries the pending action). */
  onConfirmed: () => void;
  onCancel: () => void;
}

/**
 * Modal that re-confirms the current user's password to unlock sensitive Super-User actions for the
 * 5-minute reauth window. The password is verified by the trusted main process (`security.reauth`); this
 * dialog never stores it. Shown when a sensitive admin call returns REAUTH_REQUIRED.
 */
export function ReauthDialog({ sessionRef, onConfirmed, onCancel }: ReauthDialogProps) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || password.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.playwrightFlowStudio.security.reauth({ sessionRef, password });
      if (result.ok) {
        setPassword("");
        onConfirmed();
      } else {
        setError(adminReasonMessage(result.reason));
      }
    } catch {
      setError(adminReasonMessage(undefined));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="awkit-admin-modal-backdrop" role="presentation" onClick={onCancel}>
      <form
        className="awkit-admin-modal awkit-reauth-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="awkit-reauth-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <header className="awkit-admin-modal-head">
          <span className="awkit-admin-modal-icon" aria-hidden="true"><ShieldCheck size={18} /></span>
          <h2 id="awkit-reauth-title">Confirm your password</h2>
        </header>
        <p className="awkit-admin-modal-body">This is a sensitive action. Re-enter your password to continue.</p>
        <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" disabled={busy} />
        {error ? <p className="form-message error" role="alert">{error}</p> : null}
        <div className="awkit-admin-modal-actions">
          <button type="button" className="toolbar-button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="submit" className="toolbar-button primary" disabled={busy || password.length === 0}>
            {busy ? <><Loader2 size={16} className="awkit-login-spin" aria-hidden="true" /> Confirming…</> : "Confirm"}
          </button>
        </div>
      </form>
    </div>
  );
}
