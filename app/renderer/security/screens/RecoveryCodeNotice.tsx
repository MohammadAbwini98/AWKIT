import { useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";

interface RecoveryCodeNoticeProps {
  recoveryCode: string;
  onContinue: () => void;
}

/**
 * One-time first-run recovery-code handoff. The code exists only in renderer state and is removed
 * when the user acknowledges it; the trusted layer stores only its protected password hash.
 */
export function RecoveryCodeNotice({ recoveryCode, onContinue }: RecoveryCodeNoticeProps) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(recoveryCode);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="awkit-login-form" aria-labelledby="awkit-recovery-code-title">
      <header className="awkit-login-brand">
        <span className="awkit-login-mark" aria-hidden="true">
          <KeyRound size={22} strokeWidth={2.2} />
        </span>
        <h1 id="awkit-recovery-code-title">Save your recovery code</h1>
        <p className="awkit-login-subtitle">
          This is the only way to reset the Super User password. It will not be shown again.
        </p>
      </header>

      <div className="awkit-recovery-code" aria-label="Super User recovery code">
        <code>{recoveryCode}</code>
        <button className="toolbar-button" type="button" onClick={() => void copyCode()} aria-label="Copy recovery code">
          {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <label className="awkit-recovery-confirm">
        <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
        <span>I saved this recovery code in a secure place.</span>
      </label>

      <button className="toolbar-button primary awkit-login-submit" type="button" disabled={!saved} onClick={onContinue}>
        Continue to SpecterStudio
      </button>
    </section>
  );
}
