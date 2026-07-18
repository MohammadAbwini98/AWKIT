import { useId, useState, type KeyboardEvent } from "react";
import { Eye, EyeOff } from "lucide-react";

interface PasswordFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: "current-password" | "new-password";
  autoFocus?: boolean;
  disabled?: boolean;
  /** Optional hint text shown under the field (e.g., password policy). */
  hint?: string;
}

/**
 * Password input with a safe show/hide toggle and a Caps-Lock indicator. The value lives only in React
 * state and is sent to the trusted layer via IPC — it is never logged and never placed in the DOM as a
 * data attribute. Keyboard accessible: the toggle is a real button with an aria-label and the field
 * exposes a visible focus ring (global input:focus-visible).
 */
export function PasswordField({ label, value, onChange, autoComplete = "current-password", autoFocus, disabled, hint }: PasswordFieldProps) {
  const id = useId();
  const hintId = useId();
  const [revealed, setRevealed] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  const trackCapsLock = (event: KeyboardEvent<HTMLInputElement>) => {
    setCapsLock(event.getModifierState?.("CapsLock") ?? false);
  };

  return (
    <label className="awkit-login-field" htmlFor={id}>
      <span className="awkit-login-field-label">{label}</span>
      <div className="awkit-login-password">
        <input
          id={id}
          type={revealed ? "text" : "password"}
          value={value}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          disabled={disabled}
          aria-describedby={hint ? hintId : undefined}
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
