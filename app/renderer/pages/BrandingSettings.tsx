import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Check, Image as ImageIcon, Trash2, Upload, Workflow, X } from "lucide-react";
import { useBranding } from "../state/branding";
import { BRANDING_FILE_ACCEPT, BRANDING_GUIDANCE, normalizeLogoFile, type NormalizedLogo } from "../lib/brandingImage";

/**
 * Settings → Appearance → Workspace Logo. Super-User-only (rendered by Settings.tsx behind a
 * `SETTINGS_BRANDING_MANAGE` check; the main process independently enforces it). Lets the Super User
 * choose a local image, preview it, Apply (persist + update the sidebar immediately), Cancel a pending
 * pick, or Remove the custom logo to restore the built-in icon. Structurally mirrors
 * AccentColorSettings.tsx: a local draft, a scoped WYSIWYG preview, and explicit actions.
 */
export function BrandingSettings() {
  const branding = useBranding();
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<NormalizedLogo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Drop any pending draft once the saved logo changes elsewhere (Apply/Remove committed, or refreshed).
  useEffect(() => {
    setDraft(null);
  }, [branding.updatedAt, branding.active]);

  const pickFile = () => {
    setError(null);
    setNotice(null);
    fileRef.current?.click();
  };

  const onFileChange = useCallback(async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = ""; // let the same file be re-picked after a Cancel
    if (!file) return;
    setError(null);
    setNotice(null);
    try {
      setDraft(await normalizeLogoFile(file));
    } catch (e) {
      setDraft(null);
      setError(e instanceof Error ? e.message : "That image couldn't be used.");
    }
  }, []);

  const apply = useCallback(async () => {
    if (!draft || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await window.playwrightFlowStudio.branding.uploadLogo(draft.bytes);
      if (!res.ok) {
        setError(brandingErrorMessage(res.reason));
        return;
      }
      setDraft(null);
      setNotice("Logo applied. It appears in the sidebar now.");
      await branding.refresh();
    } catch {
      setError("Couldn't save the logo. Your previous logo is unchanged.");
    } finally {
      setBusy(false);
    }
  }, [draft, busy, branding]);

  const cancel = () => {
    setDraft(null);
    setError(null);
    setNotice(null);
  };

  const remove = useCallback(async () => {
    if (busy) return;
    if (!window.confirm("Remove the custom logo and restore the default SpecterStudio icon? Other Appearance settings are not affected.")) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await window.playwrightFlowStudio.branding.removeLogo();
      if (!res.ok) {
        setError(brandingErrorMessage(res.reason));
        return;
      }
      setDraft(null);
      setNotice("Custom logo removed — the default SpecterStudio icon is restored.");
      await branding.refresh();
    } catch {
      setError("Couldn't remove the logo.");
    } finally {
      setBusy(false);
    }
  }, [busy, branding]);

  const previewUrl = draft?.dataUrl ?? (branding.active ? branding.dataUrl : null);
  const previewKind = draft ? "Preview (unsaved)" : branding.active ? "Current logo" : "Default icon";
  const hasCustom = branding.active && !draft;

  return (
    <section className="work-panel settings-card">
      <div className="settings-card-head">
        <ImageIcon size={16} />
        <h2>Appearance — Workspace Logo</h2>
      </div>
      <p className="settings-card-hint">
        Replace the entire workspace block at the bottom of the sidebar (the icon plus “SpecterStudio ·
        Offline workspace”) with your own logo. Removing the custom logo restores the built-in SpecterStudio
        block and doesn't affect any other Appearance setting. Only a Super User can change this.
      </p>

      <div className="branding-setting-grid">
        <div className="branding-controls">
          <input
            ref={fileRef}
            type="file"
            accept={BRANDING_FILE_ACCEPT}
            style={{ display: "none" }}
            tabIndex={-1}
            aria-hidden="true"
            onChange={onFileChange}
          />
          <div className="branding-actions">
            <button type="button" className="toolbar-button" onClick={pickFile} disabled={busy}>
              <Upload size={15} />
              {hasCustom ? "Replace Logo" : "Choose Logo"}
            </button>
            {draft ? (
              <>
                <button type="button" className="toolbar-button primary" onClick={() => void apply()} disabled={busy} title="Apply this logo to the sidebar and save it">
                  <Check size={15} />
                  {busy ? "Applying…" : "Apply"}
                </button>
                <button type="button" className="toolbar-button" onClick={cancel} disabled={busy}>
                  <X size={15} />
                  Cancel
                </button>
              </>
            ) : null}
            {hasCustom ? (
              <button type="button" className="toolbar-button modal-danger" onClick={() => void remove()} disabled={busy} title="Remove the custom logo and restore the default icon">
                <Trash2 size={15} />
                Remove Custom Logo
              </button>
            ) : null}
          </div>

          <p className="form-message">{BRANDING_GUIDANCE}</p>
          {error ? <p className="form-message error-text" role="alert">{error}</p> : null}
          {notice ? <p className="form-message" role="status">{notice}</p> : null}
        </div>

        {/* Scoped WYSIWYG preview — mirrors the real sidebar workspace block. A custom logo replaces the
            whole block; the default shows the built-in icon + name + subtitle. */}
        <div className="branding-preview" aria-label={`Workspace logo preview — ${previewKind}`}>
          <span className="branding-preview-caption awkit-muted">{previewKind}</span>
          {previewUrl ? (
            <div className="branding-preview-block">
              <img src={previewUrl} alt="" className="branding-preview-logo-full" />
            </div>
          ) : (
            <div className="branding-preview-row">
              <span className="branding-preview-badge">
                <Workflow size={22} />
              </span>
              <span className="branding-preview-name">
                <span>SpecterStudio</span>
                <small>Offline workspace</small>
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** Map a main-process rejection reason to a user-presentable message. */
function brandingErrorMessage(reason: string | undefined): string {
  switch (reason) {
    case "too-large":
      return "That image is larger than 5 MB.";
    case "not-png":
    case "decode-failed":
      return "That image couldn't be processed. It may be corrupted or an unsupported format.";
    case "dimensions-out-of-range":
      return "That image's dimensions are outside the allowed 32×32 to 2048×2048 range.";
    case "empty":
    case "INVALID_PAYLOAD":
      return "That image couldn't be read. Try choosing it again.";
    case "write-failed":
      return "Couldn't save the logo to storage. Your previous logo is unchanged.";
    case "REAUTH_REQUIRED":
      return "Please re-authenticate and try again.";
    case "NOT_AUTHORIZED":
    case "SESSION_EXPIRED":
      return "You're not authorized to change the workspace logo.";
    default:
      return "Couldn't update the workspace logo.";
  }
}
