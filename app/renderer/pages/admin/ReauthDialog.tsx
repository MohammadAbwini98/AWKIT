import { useState } from "react";
import { Lock } from "lucide-react";
import { PasswordField } from "../../security/components/PasswordField";
import { SysButton, SysFormError, SysModal, SysModalFields } from "../../components/system/SystemUI";
import { adminReasonMessage } from "./adminMessages";

interface ReauthDialogProps {
  sessionRef: string;
  /** Called after a successful re-authentication (the caller then retries the pending action). */
  onConfirmed: () => void;
  onCancel: () => void;
}

/**
 * Modal that re-confirms the current user's password to unlock sensitive Super-User actions for the
 * reauth window. The password is verified by the trusted main process (`security.reauth`); this dialog
 * never stores it. Shown when a sensitive admin call returns REAUTH_REQUIRED. The modal focus contract
 * (focus in, Tab trap, Escape, focus return — AWKIT-A11Y-001) comes from SysModal.
 */
export function ReauthDialog({ sessionRef, onConfirmed, onCancel }: ReauthDialogProps) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
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
    <SysModal
      tone="warning"
      icon={Lock}
      width={400}
      title="Confirm your identity"
      message="Privileged Administration actions require your password again before they run."
      className="awkit-reauth-modal"
      onClose={onCancel}
      closeDisabled={busy}
      onSubmit={() => void submit()}
      actions={
        <>
          <SysButton kind="secondary" onClick={onCancel} disabled={busy}>Cancel</SysButton>
          <SysButton kind="primary" type="submit" disabled={busy || password.length === 0}>
            {busy ? "Confirming…" : "Confirm"}
          </SysButton>
        </>
      }
    >
      <SysModalFields>
        <div className="sys-field is-wide">
          <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" disabled={busy} autoFocus />
        </div>
        {error ? (
          <div className="sys-field is-wide">
            <SysFormError>{error}</SysFormError>
          </div>
        ) : null}
      </SysModalFields>
    </SysModal>
  );
}
