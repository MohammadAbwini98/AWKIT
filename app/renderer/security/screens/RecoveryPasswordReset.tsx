import { useState, type FormEvent } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { PasswordField } from "../components/PasswordField";
import { messageForReason } from "../reasonMessages";

export interface RecoverySubmitResult {
  ok: boolean;
  reason?: string;
  errors?: string[];
}

interface RecoveryPasswordResetProps {
  onSubmit: (recoveryCode: string, newPassword: string) => Promise<RecoverySubmitResult>;
  onCancel: () => void;
}

const PASSWORD_HINT = "At least 12 characters, using 3 of: lowercase, uppercase, digit, symbol.";

export function RecoveryPasswordReset({ onSubmit, onCancel }: RecoveryPasswordResetProps) {
  const [recoveryCode, setRecoveryCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);

  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit = recoveryCode.trim().length > 0 && password.length > 0 && confirm === password && !submitting;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setFieldErrors([]);
    try {
      const result = await onSubmit(recoveryCode, password);
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
    <form className="awkit-login-form" onSubmit={handleSubmit} aria-labelledby="awkit-recovery-reset-title">
      <header className="awkit-login-brand">
        <span className="awkit-login-mark" aria-hidden="true">
          <KeyRound size={22} strokeWidth={2.2} />
        </span>
        <h1 id="awkit-recovery-reset-title">Recover Super User</h1>
        <p className="awkit-login-subtitle">
          Enter the one-time recovery code saved during setup and choose a new password.
        </p>
      </header>

      <label className="awkit-login-field" htmlFor="awkit-recovery-code">
        <span className="awkit-login-field-label">Recovery code</span>
        <input
          id="awkit-recovery-code"
          type="text"
          value={recoveryCode}
          autoComplete="off"
          autoCapitalize="characters"
          autoFocus
          spellCheck={false}
          disabled={submitting}
          onChange={(event) => setRecoveryCode(event.target.value)}
        />
      </label>

      <PasswordField label="New password" value={password} onChange={setPassword} autoComplete="new-password" disabled={submitting} hint={PASSWORD_HINT} />
      <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" disabled={submitting} />

      {mismatch ? <p className="form-message error" role="alert">Passwords do not match.</p> : null}
      {error ? <p className="form-message error" role="alert">{error}</p> : null}
      {fieldErrors.length > 0 ? (
        <ul className="awkit-login-errors">
          {fieldErrors.map((message) => <li key={message}>{message}</li>)}
        </ul>
      ) : null}

      <div className="awkit-login-actions">
        <button className="toolbar-button" type="button" disabled={submitting} onClick={onCancel}>Back</button>
        <button className="toolbar-button primary awkit-login-submit" type="submit" disabled={!canSubmit}>
          {submitting ? (
            <>
              <Loader2 size={16} className="awkit-login-spin" aria-hidden="true" />
              Resetting password…
            </>
          ) : "Reset password"}
        </button>
      </div>
    </form>
  );
}
