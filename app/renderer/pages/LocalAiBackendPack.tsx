import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, FolderOpen, HardDrive, ShieldCheck, Trash2, X, XCircle } from "lucide-react";

import type { AiBackendPackView, AiBackendPreflightView } from "@src/ai/contracts/AiApi";

import { ConfirmDialog } from "../components/shared/ConfirmDialog";
import { ReauthDialog } from "./admin/ReauthDialog";
import { useSensitiveSemanticAction, type SensitiveAdminResponse } from "../semantic/useSensitiveSemanticAction";

const api = () => window.playwrightFlowStudio.ai;

const STATUS_LABELS: Record<AiBackendPackView["status"], string> = {
  unavailable: "Not available in this version",
  "not-installed": "Not installed",
  installed: "Installed and verified",
  invalid: "Invalid — not used"
};

const CHECK_TITLES: Record<string, string> = {
  folder: "Folder",
  links: "Links and reparse points",
  identity: "Backend and build",
  files: "File set",
  sizes: "File sizes",
  hashes: "SHA-256",
  signed: "Signed manifest",
  runtime: "Visual C++ runtime",
  space: "Disk space"
};

const STATE_WORDS = { pass: "passed", fail: "failed", skipped: "not checked" } as const;
const PHASE_LABELS = { copying: "Copying and hashing", verifying: "Re-verifying the copy", promoting: "Activating" } as const;

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "unknown";
  const mb = bytes / 1024 ** 2;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

function describe(response: SensitiveAdminResponse): string {
  if (response.message) return response.message;
  return response.code === "NOT_AUTHORIZED" ? "You don't have permission to do that." : "That action could not be completed.";
}

/**
 * Settings → Local AI → GPU backend pack (Phase L, L8a.2).
 *
 * Select a folder (main opens the dialog), review a checklist that main computed without loading
 * anything from the folder, confirm, watch the staged copy, and later verify or remove the pack. Every
 * step needs `ai.manage`; picking, importing and removing re-authenticate. Installing the pack never
 * means a GPU is in use: only a GPU execution mode loads it, and `gpuUse` reports what actually runs.
 */
export function LocalAiBackendPack({ sessionRef, gpuUse }: { sessionRef: string; gpuUse: string }) {
  const [view, setView] = useState<AiBackendPackView | null>(null);
  const [preflight, setPreflight] = useState<AiBackendPreflightView | null>(null);
  const [importing, setImporting] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const checklistHeading = useRef<HTMLHeadingElement>(null);
  const action = useSensitiveSemanticAction(describe);

  const load = useCallback(async () => {
    try {
      setView(await api().getBackendPack());
      setLoadError(null);
    } catch {
      setLoadError("The GPU backend pack status could not be read.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The import call resolves only when it finishes, so progress is read from main meanwhile.
  useEffect(() => {
    if (!importing) return undefined;
    const timer = window.setInterval(() => void load(), 400);
    return () => window.clearInterval(timer);
  }, [importing, load]);

  // A new checklist takes focus, so keyboard and screen-reader users land on what they must review.
  useEffect(() => {
    if (preflight) checklistHeading.current?.focus();
  }, [preflight]);

  const selectFolder = async (): Promise<void> => {
    setPreflight(null);
    let cancelled = false;
    await action.run(async () => {
      const response = await api().preflightBackendPack();
      if (response.code === "IMPORT_CANCELLED") {
        cancelled = true;
        return { code: "OK", ok: true };
      }
      setPreflight(response.preflight);
      return response;
    }, "The folder passed every check. Review the checklist, then confirm the import.");
    // A closed folder dialog is not a result worth announcing.
    if (cancelled) action.dismiss();
  };

  const confirmImport = async (): Promise<void> => {
    const token = preflight?.token;
    if (!token) return;
    await action.run(async () => {
      setImporting(true);
      try {
        const response = await api().importBackendPack(token);
        if (response.code !== "REAUTH_REQUIRED") setPreflight(null);
        return response;
      } finally {
        setImporting(false);
        await load();
      }
    }, "GPU backend pack installed and verified. This does not turn on GPU use.");
  };

  const cancel = async (): Promise<void> => {
    await api().cancelBackendPack();
    if (!importing) setPreflight(null);
  };

  const installed = view?.status === "installed";
  const present = installed || view?.status === "invalid";
  const progress = view?.importing ?? null;
  const percent = progress && progress.totalBytes > 0 ? Math.min(100, Math.round((progress.doneBytes / progress.totalBytes) * 100)) : 0;

  return (
    <section className="settings-subsection" aria-labelledby="ai-backend-pack-title">
      <div className="settings-card-head">
        <HardDrive size={16} aria-hidden="true" />
        <h3 id="ai-backend-pack-title">GPU backend pack (Vulkan)</h3>
      </div>
      <p className="settings-card-hint">
        Optional files that GPU-Offload and GPU-Only load to run the model on a compatible NVIDIA GPU. Installing them
        only places verified copies in this app&apos;s data folder; the execution mode above decides whether they are
        used. Nothing is downloaded, and nothing in the folder you pick is run.
      </p>

      {loadError ? (
        <p className="form-message error" role="alert">
          <AlertTriangle size={13} style={{ verticalAlign: "-2px" }} /> {loadError}
        </p>
      ) : null}
      {action.error ? (
        <p className="form-message error" role="alert">
          <AlertTriangle size={13} style={{ verticalAlign: "-2px" }} /> {action.error}
        </p>
      ) : null}
      {action.notice ? (
        <p className="form-message" role="status">
          <CheckCircle2 size={13} style={{ verticalAlign: "-2px" }} /> {action.notice}
        </p>
      ) : null}

      {view ? (
        <div className="readiness-list" aria-label="GPU backend pack status">
          <span>Backend pack</span>
          <strong>{STATUS_LABELS[view.status]}</strong>
          {view.message ? (
            <>
              <span>Reason</span>
              <strong>{view.message}</strong>
            </>
          ) : null}
          <span>Pinned build</span>
          <strong>
            {view.pinnedBuild ?? "none"}
            {view.packageVersion ? ` (Vulkan pack ${view.packageVersion})` : ""}
          </strong>
          {present ? (
            <>
              <span>Pack size</span>
              <strong>
                {formatBytes(view.sizeBytes)}
                {view.fileCount !== null ? `, ${view.fileCount} files` : ""}
              </strong>
              <span>Installed</span>
              <strong>{view.installedAt ? new Date(view.installedAt).toLocaleString() : "—"}</strong>
              <span>Last verified</span>
              <strong>{view.lastVerifiedAt ? new Date(view.lastVerifiedAt).toLocaleString() : "—"}</strong>
            </>
          ) : null}
          <span>GPU use</span>
          <strong>{gpuUse}</strong>
        </div>
      ) : null}

      {view && view.status !== "unavailable" ? (
        <div className="settings-actions">
          <button className="toolbar-button" disabled={action.busy || importing} type="button" onClick={() => void selectFolder()}>
            <FolderOpen size={15} aria-hidden="true" />
            {present ? "Replace Backend Pack…" : "Select Pack Folder…"}
          </button>
          {present ? (
            <button
              className="toolbar-button"
              disabled={action.busy || importing}
              type="button"
              onClick={() => void action.run(() => api().verifyBackendPack(), "The installed pack passed its integrity check.").then(load)}
            >
              <ShieldCheck size={15} aria-hidden="true" />
              Verify Backend Pack
            </button>
          ) : null}
          {present ? (
            <button className="toolbar-button modal-danger" disabled={action.busy || importing} type="button" onClick={() => setConfirmRemove(true)}>
              <Trash2 size={15} aria-hidden="true" />
              Remove Backend Pack
            </button>
          ) : null}
        </div>
      ) : null}

      {preflight ? (
        <section className="settings-subsection" aria-labelledby="ai-backend-preflight-title">
          <h4 id="ai-backend-preflight-title" ref={checklistHeading} tabIndex={-1}>
            {preflight.ready ? "Ready to import — review and confirm" : "This folder cannot be imported"}
          </h4>
          <div className="readiness-list">
            <span>Backend</span>
            <strong>
              {preflight.backend ?? "—"} · {preflight.pinnedBuild ?? "no pinned build"}
            </strong>
            <span>Source folder</span>
            <strong>{preflight.source}</strong>
            <span>Destination</span>
            <strong>{preflight.destination}</strong>
            <span>Pack size</span>
            <strong>{formatBytes(preflight.requiredBytes)} (including this build's Visual C++ runtime)</strong>
            <span>Free space</span>
            <strong>
              {formatBytes(preflight.availableBytes)} available; {formatBytes(preflight.headroomBytes)} kept as headroom
            </strong>
            <span>Files validated</span>
            <strong>
              {preflight.filesValidated} of {preflight.fileCount}
            </strong>
            <span>Already installed</span>
            <strong>{preflight.identicalInstalled ? "Yes — an identical pack is installed; it will be re-verified, not copied" : "No"}</strong>
          </div>
          <ul className="sys-checklist" aria-label="Backend pack checks">
            {preflight.checks.map((check) => (
              <li className="sys-check-row" key={check.id}>
                <span
                  className={`sys-check-mark ${check.state === "pass" ? "sys-tone-success" : check.state === "fail" ? "sys-tone-danger" : "sys-tone-neutral"}`}
                  aria-hidden="true"
                >
                  {check.state === "pass" ? <CheckCircle2 size={14} /> : check.state === "fail" ? <XCircle size={14} /> : <CircleDashed size={14} />}
                </span>
                <span className="sys-check-text">
                  <span className="sys-check-title">
                    {CHECK_TITLES[check.id] ?? check.id}: {STATE_WORDS[check.state]}
                  </span>
                  <span className="sys-check-sub">{check.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          {preflight.ready ? (
            <p className="form-message warn" role="note">
              <AlertTriangle size={13} style={{ verticalAlign: "-2px" }} /> Importing copies these local files into the app's
              data folder and may temporarily need about twice the pack size while a previous pack is kept until the new one
              is verified. Nothing is downloaded or run.
            </p>
          ) : null}
          <div className="settings-actions">
            {preflight.ready && !importing ? (
              <button className="toolbar-button" disabled={action.busy} type="button" onClick={() => void confirmImport()}>
                <CheckCircle2 size={15} aria-hidden="true" />
                Copy and Import
              </button>
            ) : null}
            {!importing ? (
              <button className="toolbar-button" type="button" onClick={() => void cancel()}>
                <X size={15} aria-hidden="true" />
                {preflight.ready ? "Cancel" : "Close"}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {importing ? (
        <div className="settings-subsection">
          <div
            aria-label="Backend pack import progress"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={percent}
            aria-valuetext={progress ? `${PHASE_LABELS[progress.phase]}: ${formatBytes(progress.doneBytes)} of ${formatBytes(progress.totalBytes)}` : "Starting"}
            className="report-progress-track"
            role="progressbar"
          >
            <div className="report-progress-fill" style={{ width: `${percent}%` }} />
          </div>
          <p className="form-message" role="status">
            {progress ? `${PHASE_LABELS[progress.phase]} — ${formatBytes(progress.doneBytes)} of ${formatBytes(progress.totalBytes)}` : "Starting the import…"}
          </p>
          <div className="settings-actions">
            <button className="toolbar-button" disabled={progress?.phase === "promoting"} type="button" onClick={() => void cancel()}>
              <X size={15} aria-hidden="true" />
              Cancel Import
            </button>
          </div>
        </div>
      ) : null}

      {confirmRemove ? (
        <ConfirmDialog
          danger
          cancelLabel="Cancel"
          confirmLabel="Remove backend pack"
          title="Remove the GPU backend pack?"
          message={
            "Removing the pack deletes its copied files from this machine. The model keeps running on CPU & RAM.\n\n" +
            "The folder you imported from is not touched.\n\nContinue?"
          }
          onCancel={() => setConfirmRemove(false)}
          onConfirm={() => {
            setConfirmRemove(false);
            void action.run(() => api().removeBackendPack(), "GPU backend pack removed.").then(load);
          }}
        />
      ) : null}

      {action.needsReauth ? <ReauthDialog sessionRef={sessionRef} onCancel={action.onReauthCancelled} onConfirmed={action.onReauthConfirmed} /> : null}
    </section>
  );
}
