import { useState, type FormEvent } from "react";
import { ShieldCheck, Loader2 } from "lucide-react";
import { PasswordField } from "../components/PasswordField";
import { messageForReason } from "../reasonMessages";

export interface BootstrapResult {
  ok: boolean;
  reason?: string;
  errors?: string[];
}

interface FirstRunSetupProps {
  onSubmit: (input: { username: string; password: string; displayName?: string }) => Promise<BootstrapResult>;
}

const PASSWORD_HINT = "At least 12 characters, using 3 of: lowercase, uppercase, digit, symbol.";

/**
 * One-time first-run provisioning of the protected Super User. The trusted layer enforces the
 * one-time invariant (refused once any user exists), the username rules, and the password policy; this
 * screen mirrors the confirm-match check for UX and surfaces server-returned policy errors.
 */
export function FirstRunSetup({ onSubmit }: FirstRunSetupProps) {
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);

  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit = username.trim().length > 0 && password.length > 0 && confirm === password && !submitting;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setFieldErrors([]);
    try {
      const result = await onSubmit({ username: username.trim(), password, displayName: displayName.trim() || undefined });
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
    <form className="awkit-login-form" onSubmit={handleSubmit} aria-labelledby="awkit-setup-title">
      <header className="awkit-login-brand">
        <span className="awkit-login-mark" aria-hidden="true">
          <ShieldCheck size={22} strokeWidth={2.2} />
        </span>
        <h1 id="awkit-setup-title">Set up SpecterStudio</h1>
        <p className="awkit-login-subtitle">Create the administrator (Super User) account for this machine.</p>
      </header>

      <label className="awkit-login-field" htmlFor="awkit-setup-display">
        <span className="awkit-login-field-label">Display name (optional)</span>
        <input
          id="awkit-setup-display"
          type="text"
          value={displayName}
          autoComplete="name"
          disabled={submitting}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </label>

      <label className="awkit-login-field" htmlFor="awkit-setup-username">
        <span className="awkit-login-field-label">Username</span>
        <input
          id="awkit-setup-username"
          type="text"
          value={username}
          autoComplete="username"
          autoFocus
          spellCheck={false}
          disabled={submitting}
          onChange={(event) => setUsername(event.target.value)}
        />
      </label>

      <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="new-password" disabled={submitting} hint={PASSWORD_HINT} />
      <PasswordField label="Confirm password" value={confirm} onChange={setConfirm} autoComplete="new-password" disabled={submitting} />

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

      <button className="toolbar-button primary awkit-login-submit" type="submit" disabled={!canSubmit}>
        {submitting ? (
          <>
            <Loader2 size={16} className="awkit-login-spin" aria-hidden="true" />
            Creating account…
          </>
        ) : (
          "Create account"
        )}
      </button>
    </form>
  );
}
