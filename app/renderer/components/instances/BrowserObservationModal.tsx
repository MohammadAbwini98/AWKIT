import { Camera, Eye, Loader2, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CdpObservationSnapshot } from "@src/runner/observation/PassiveCdpTrace";

interface BrowserObservationModalProps {
  instanceId: string;
  instanceName: string;
  onClose: () => void;
}

export function BrowserObservationModal({
  instanceId,
  instanceName,
  onClose
}: BrowserObservationModalProps) {
  const [snapshot, setSnapshot] = useState<CdpObservationSnapshot>();
  const [loadError, setLoadError] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      window.playwrightFlowStudio.executions
        .observationSnapshot(instanceId)
        .then((value) => {
          if (!active) return;
          setSnapshot(value);
          setLoadError("");
        })
        .catch((error) => {
          if (active) setLoadError(error instanceof Error ? error.message : "Live view is unavailable.");
        });
    };
    refresh();
    const interval = window.setInterval(refresh, 2_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [instanceId]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
        ) ?? [])
      ];
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  const active = snapshot?.status === "live" || snapshot?.status === "waiting";
  const statusLabel = snapshot?.status ?? "waiting";

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        aria-labelledby="browser-observation-title"
        aria-modal="true"
        className="modal-dialog report-modal browser-observation-modal"
        onMouseDown={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="modal-header report-modal-header">
          <h2 id="browser-observation-title">
            <Eye size={18} /> Browser observation
          </h2>
          <button
            aria-label="Close browser observation"
            className="icon-button"
            onClick={onClose}
            ref={closeRef}
            title="Close"
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        <section className="report-banner">
          <div className="report-banner-main">
            <div className="report-banner-title">
              <strong>{instanceName}</strong>
              <span>{snapshot?.url ?? "Waiting for the first browser sample"}</span>
            </div>
            <span className={`report-status-pill pill-${statusLabel}`}>
              {active ? <Loader2 className="spin" size={13} /> : null}
              {statusLabel}
            </span>
          </div>
          <div className="browser-observation-safety">
            <ShieldCheck size={14} aria-hidden />
            <span>Read-only CDP client · local trace · no action commands</span>
          </div>
          <div className="report-banner-meta">
            <span>{snapshot?.eventCount ?? 0} browser events</span>
            <span>{snapshot?.sampleCount ?? 0} visual samples</span>
            {snapshot?.updatedAt ? <span>Updated {new Date(snapshot.updatedAt).toLocaleTimeString()}</span> : null}
            {snapshot?.truncated ? <span>Raw trace size limit reached</span> : null}
          </div>
        </section>

        <div className="report-body browser-observation-body">
          {snapshot?.screenshotDataUrl ? (
            <figure className="browser-observation-frame">
              <img
                alt={`Latest read-only browser view for ${instanceName}`}
                src={snapshot.screenshotDataUrl}
              />
              <figcaption>Sampled locally every two seconds; interaction stays in the runner.</figcaption>
            </figure>
          ) : (
            <div className="browser-observation-empty" role="status">
              <Camera size={28} aria-hidden />
              <strong>{loadError || snapshot?.message || "Waiting for a browser page…"}</strong>
              <span>The workflow continues even if observation is unavailable.</span>
            </div>
          )}
          {snapshot?.traceRoot ? (
            <p className="browser-observation-path">
              <strong>Trace folder</strong>
              <span>{snapshot.traceRoot}</span>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
