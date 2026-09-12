import { useId, useState, type KeyboardEvent } from "react";
import { Eye, EyeOff, LockKeyhole } from "lucide-react";

interface PasswordFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: "current-password" | "new-password";
  autoFocus?: boolean;
  disabled?: boolean;
  /** Optional hint text shown under the field (e.g., password policy). */
  hint?: string;
  /** Adds the auth-screen leading icon without changing existing shared consumers by default. */
  leadingIcon?: boolean;
  /** Marks the input invalid for immediate local form feedback; trusted validation remains authoritative. */
  invalid?: boolean;
  /** Local-only password-strength preview. Off by default and never persisted or submitted. */
  showStrength?: boolean;
}

type PasswordStrengthLevel = 0 | 1 | 2 | 3 | 4;

const STRENGTH_LABELS = ["Too short", "Weak", "Fair", "Strong", "Excellent"] as const;

function previewStrength(value: string): PasswordStrengthLevel {
  return [
    value.length >= 12,
    /[a-z]/.test(value) && /[A-Z]/.test(value),
    /[0-9]/.test(value),
    /[^A-Za-z0-9]/.test(value)
  ].filter(Boolean).length as PasswordStrengthLevel;
}

/**
 * Password input with a safe show/hide toggle and a Caps-Lock indicator. The value lives only in React
 * state and is sent to the trusted layer via IPC — it is never logged and never placed in the DOM as a
 * data attribute. Keyboard accessible: the toggle is a real button with an aria-label and the field
 * exposes a visible focus ring (global input:focus-visible).
 */
export function PasswordField({
  label,
  value,
  onChange,
  autoComplete = "current-password",
  autoFocus,
  disabled,
  hint,
  leadingIcon = false,
  invalid,
  showStrength = false
}: PasswordFieldProps) {
  const id = useId();
  const hintId = useId();
  const [revealed, setRevealed] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const strength = previewStrength(value);

  const trackCapsLock = (event: KeyboardEvent<HTMLInputElement>) => {
    setCapsLock(event.getModifierState?.("CapsLock") ?? false);
  };

  return (
    <label className="awkit-login-field" htmlFor={id}>
      <span className="awkit-login-field-label">{label}</span>
      <div className={`awkit-login-password${leadingIcon ? " has-leading-icon" : ""}`}>
        {leadingIcon ? <LockKeyhole className="awkit-login-leading-icon" size={16} aria-hidden="true" /> : null}
        <input
          id={id}
          type={revealed ? "text" : "password"}
          value={value}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          disabled={disabled}
          aria-describedby={hint ? hintId : undefined}
          aria-invalid={invalid || undefined}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
          onKeyUp={trackCapsLock}
          onKeyDown={trackCapsLock}
        />
        <button
          type="button"
          className="awkit-login-reveal"
          onClick={() => setRevealed((prev) => !prev)}
          aria-label={revealed ? "Hide password" : "Show password"}
          aria-pressed={revealed}
          tabIndex={-1}
          disabled={disabled}
        >
          {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {showStrength && value.length > 0 ? (
        <div className={`awkit-password-strength is-level-${strength}`} role="status" aria-live="polite">
          <span className="sr-only">Password strength: </span>
          <span className="awkit-password-strength-bars" aria-hidden="true">
            {[0, 1, 2, 3].map((bar) => (
              <span className={bar < strength ? "is-filled" : undefined} key={bar} />
            ))}
          </span>
          <span className="awkit-password-strength-label">{STRENGTH_LABELS[strength]}</span>
        </div>
      ) : null}
      {capsLock ? (
        <span className="awkit-login-caps" role="status">
          Caps Lock is on
        </span>
      ) : null}
      {hint ? (
        <span id={hintId} className="awkit-login-hint">
          {hint}
        </span>
      ) : null}
    </label>
  );
}
