import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { AtSign, Building2, Loader2, UserRound } from "lucide-react";
import type { LoginOption, ProviderId } from "@src/security/auth/AuthTypes";
import { AwkitWordmarkGlyph } from "../../assets/brand/AwkitBrandMarks";
import { PasswordField } from "../components/PasswordField";
import { messageForReason } from "../reasonMessages";

export interface LoginSubmitResult {
  ok: boolean;
  reason?: string;
}

interface LoginScreenProps {
  options: LoginOption[];
  onSubmit: (providerId: ProviderId, username: string, password: string) => Promise<LoginSubmitResult>;
  onRecovery: () => void;
  /** Optional status note shown above the form, e.g. after a proactive inactivity lock. */
  notice?: string | null;
}

/**
 * Provider-aware sign-in. Disabled providers cannot be selected or submitted, and the trusted layer
 * independently rejects them. Errors remain non-enumerating; the submit button is disabled while a
 * request is in flight to prevent duplicate submissions.
 */
export function LoginScreen({ options, onSubmit, onRecovery, notice }: LoginScreenProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>("local");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customLogo, setCustomLogo] = useState<string | null>(null);
  const tabRefs = useRef<Partial<Record<ProviderId, HTMLButtonElement>>>({});

  useEffect(() => {
    let cancelled = false;
    window.playwrightFlowStudio.branding
      .getState()
      .then((state) => {
        if (!cancelled) setCustomLogo(state.active && state.dataUrl ? state.dataUrl : null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!options.some((option) => option.id === selectedProvider && option.enabled)) {
      setSelectedProvider(options.find((option) => option.enabled)?.id ?? "local");
    }
  }, [options, selectedProvider]);

  const canSubmit = username.trim().length > 0 && password.length > 0 && !submitting;

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const enabled = options.filter((option) => option.enabled);
    if (!enabled.length) return;
    event.preventDefault();
    const current = Math.max(0, enabled.findIndex((option) => option.id === selectedProvider));
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? enabled.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + enabled.length) % enabled.length;
    const next = enabled[nextIndex];
    setSelectedProvider(next.id);
    setError(null);
    setPassword("");
    tabRefs.current[next.id]?.focus();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await onSubmit(selectedProvider, username.trim(), password);
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
          <img className="awkit-login-logo-custom" src={customLogo} alt="" aria-hidden="true" draggable={false} />
        ) : null}
        <h1 className="awkit-login-wordmark" id="awkit-login-title">
          <span className="sr-only">S</span>
          <AwkitWordmarkGlyph className="awkit-login-wordmark-glyph" />
          <span>pecterStudio</span>
        </h1>
        <p className="awkit-login-subtitle">Sign in to continue</p>
      </header>

      {notice ? (
        <p className="awkit-login-notice" role="status">
          {notice}
        </p>
      ) : null}

      <div className="awkit-login-tabs" role="radiogroup" aria-label="Sign-in method">
        {options.map((option) => {
          const isSelected = option.id === selectedProvider;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              ref={(element) => {
                tabRefs.current[option.id] = element ?? undefined;
              }}
              aria-checked={isSelected}
              aria-disabled={!option.enabled}
              disabled={!option.enabled}
              tabIndex={isSelected && option.enabled ? 0 : -1}
              className={`awkit-login-tab${isSelected ? " is-active" : ""}`}
              title={option.enabled ? option.displayName : `${option.displayName} — Not configured`}
              onClick={() => {
                if (option.enabled) {
                  setSelectedProvider(option.id);
                  setError(null);
                  setPassword("");
                }
              }}
              onKeyDown={handleTabKeyDown}
            >
              {option.id === "activeDirectory" ? <Building2 size={15} aria-hidden="true" /> : <UserRound size={15} aria-hidden="true" />}
              <span>{option.displayName}</span>
              {!option.enabled ? <em className="awkit-login-soon">Not configured</em> : null}
            </button>
          );
        })}
      </div>

      <label className="awkit-login-field" htmlFor="awkit-login-username">
        <span className="awkit-login-field-label">Username</span>
        <div className="awkit-login-input has-leading-icon">
          <AtSign className="awkit-login-leading-icon" size={16} aria-hidden="true" />
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
        </div>
      </label>

      <PasswordField
        label="Password"
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
        disabled={submitting}
        leadingIcon
      />

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
      <button className="awkit-login-link" type="button" disabled={submitting} onClick={onRecovery}>
        Recover Super User
      </button>
    </form>
  );
}
