import { useState, type FormEvent } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { PasswordField } from "../components/PasswordField";
import { messageForReason } from "../reasonMessages";

export interface ChangePasswordResult {
  ok: boolean;
  reason?: string;
  errors?: string[];
}

interface ForcedPasswordChangeProps {
  displayName: string;
  onSubmit: (currentPassword: string, newPassword: string) => Promise<ChangePasswordResult>;
  onCancel: () => void;
}

const PASSWORD_HINT = "At least 12 characters, using 3 of: lowercase, uppercase, digit, symbol.";

/**
 * Forced password change shown after login when the account has `mustChangePassword`. The user cannot
 * reach the app until the change succeeds; Cancel logs out instead of bypassing the requirement.
 */
export function ForcedPasswordChange({ displayName, onSubmit, onCancel }: ForcedPasswordChangeProps) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);

  const mismatch = confirm.length > 0 && confirm !== next;
  const canSubmit = current.length > 0 && next.length > 0 && confirm === next && !submitting;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setFieldErrors([]);
    try {
      const result = await onSubmit(current, next);
      if (!result.ok) {
        setError(messageForReason(result.reason));
        setFieldErrors(result.errors ?? []);
      }
    } catch {
      setError(messageForReason(undefined));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="awkit-login-form" onSubmit={handleSubmit} aria-labelledby="awkit-change-title">
      <header className="awkit-login-brand">
        <span className="awkit-login-mark" aria-hidden="true">
          <KeyRound size={22} strokeWidth={2.2} />
        </span>
        <h1 id="awkit-change-title">Update your password</h1>
        <p className="awkit-login-subtitle">{displayName}, you must set a new password before continuing.</p>
      </header>

      <PasswordField label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" autoFocus disabled={submitting} />
      <PasswordField label="New password" value={next} onChange={setNext} autoComplete="new-password" disabled={submitting} hint={PASSWORD_HINT} />
      <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" disabled={submitting} />

      {mismatch ? (
        <p className="form-message error" role="alert">
          Passwords do not match.
        </p>
      ) : null}
      {error ? (
        <p className="form-message error" role="alert">
          {error}
        </p>
      ) : null}
      {fieldErrors.length > 0 ? (
        <ul className="awkit-login-errors">
          {fieldErrors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}

      <div className="awkit-login-actions">
        <button className="toolbar-button" type="button" onClick={onCancel} disabled={submitting}>
          Sign out
        </button>
        <button className="toolbar-button primary awkit-login-submit" type="submit" disabled={!canSubmit}>
          {submitting ? (
            <>
              <Loader2 size={16} className="awkit-login-spin" aria-hidden="true" />
              Updating…
            </>
          ) : (
            "Update password"
          )}
        </button>
      </div>
    </form>
  );
}
