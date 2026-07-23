import { useEffect, useState, type FormEvent } from "react";
import { Workflow, Loader2, Building2 } from "lucide-react";
import type { LoginOption, ProviderId } from "@src/security/auth/AuthTypes";
import { PasswordField } from "../components/PasswordField";
import { messageForReason } from "../reasonMessages";
import specterLogoUrl from "../../assets/brand/specter-logo.svg";

export interface LoginSubmitResult {
  ok: boolean;
  reason?: string;
}

interface LoginScreenProps {
  options: LoginOption[];
  onSubmit: (providerId: ProviderId, username: string, password: string) => Promise<LoginSubmitResult>;
  /** Optional status note shown above the form, e.g. after a proactive inactivity lock. */
  notice?: string | null;
}

/**
 * Virtual-user sign-in. Active Directory is shown as a disabled "Coming Soon" tab that cannot be
 * selected or submitted, so a DOM-enabled control can't trigger an alternate login path (the trusted
 * layer also rejects any disabled provider). Errors are generic and never reveal whether a username
 * exists; the submit button is disabled while a request is in flight to prevent duplicate submissions.
 */
export function LoginScreen({ options, onSubmit, notice }: LoginScreenProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Fall back to the built-in glyph if the packaged logo asset ever fails to load (offline-safe, no broken image).
  const [logoFailed, setLogoFailed] = useState(false);
  // The active custom workspace logo (a self-contained data: URL), resolved from the SAME open
  // `branding.getState()` read the sidebar uses — so the login screen and the app chrome always show
  // the same logo. Absent/false/error → keep the built-in default (a plain presence check, never an
  // <img onError>, so a mid-swap or corrupt asset never yields a broken image on the login screen).
  const [customLogo, setCustomLogo] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    window.playwrightFlowStudio.branding
      ?.getState()
      .then((state) => {
        if (!cancelled && state?.active && state.dataUrl) setCustomLogo(state.dataUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const canSubmit = username.trim().length > 0 && password.length > 0 && !submitting;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await onSubmit("local", username.trim(), password);
      if (!result.ok) {
        setError(messageForReason(result.reason));
        setPassword("");
      }
      // On success SecurityGate unmounts this screen; no further state update needed.
    } catch {
      setError(messageForReason(undefined));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="awkit-login-form" onSubmit={handleSubmit} aria-labelledby="awkit-login-title">
      <header className="awkit-login-brand">
        {customLogo ? (
          // Custom workspace logo overrides the default mark — aspect-preserved, overflow-bounded by CSS.
          <img className="awkit-login-logo-custom" src={customLogo} alt="" aria-hidden="true" draggable={false} />
        ) : logoFailed ? (
          <span className="awkit-login-mark" aria-hidden="true">
            <Workflow size={22} strokeWidth={2.4} />
          </span>
        ) : (
          <img
            className="awkit-login-logo"
            src={specterLogoUrl}
            alt=""
            aria-hidden="true"
            width={64}
            height={64}
            draggable={false}
            onError={() => setLogoFailed(true)}
          />
        )}
        <h1 id="awkit-login-title">SpecterStudio</h1>
        <p className="awkit-login-subtitle">Sign in to continue</p>
      </header>

      {notice ? (
        <p className="awkit-login-notice" role="status">
          {notice}
        </p>
      ) : null}

      <div className="awkit-login-tabs" role="tablist" aria-label="Sign-in method">
        {options.map((option) => {
          const isLocal = option.id === "local";
          return (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={isLocal}
              aria-disabled={!option.enabled}
              disabled={!option.enabled}
              className={`awkit-login-tab${isLocal ? " is-active" : ""}`}
              title={option.enabled ? option.displayName : `${option.displayName} — coming soon`}
            >
              {option.id === "activeDirectory" ? <Building2 size={15} /> : <Workflow size={15} />}
              <span>{option.displayName}</span>
              {!option.enabled ? <em className="awkit-login-soon">Coming soon</em> : null}
            </button>
          );
        })}
      </div>

      <label className="awkit-login-field" htmlFor="awkit-login-username">
        <span className="awkit-login-field-label">Username</span>
        <input
          id="awkit-login-username"
          type="text"
          value={username}
          autoComplete="username"
          autoFocus
          spellCheck={false}
          disabled={submitting}
          onChange={(event) => setUsername(event.target.value)}
        />
      </label>

      <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" disabled={submitting} />

      {error ? (
        <p className="form-message error" role="alert">
          {error}
        </p>
      ) : null}

      <button className="toolbar-button primary awkit-login-submit" type="submit" disabled={!canSubmit}>
        {submitting ? (
          <>
            <Loader2 size={16} className="awkit-login-spin" aria-hidden="true" />
            Signing in…
          </>
        ) : (
          "Sign in"
        )}
      </button>
    </form>
  );
}
