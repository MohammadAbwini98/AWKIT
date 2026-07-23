import { useEffect, useMemo, useRef, useState } from "react";
import { PlayCircle, StopCircle, XCircle, Save, Video, Link, ArrowRight, CheckCircle2, AlertCircle, Search, X, Copy, Globe, Timer, Bookmark, CornerDownLeft, Sparkles, ShieldAlert, ExternalLink, RefreshCw, ClipboardCheck } from "lucide-react";
import { usePageChrome } from "../state/pageChrome";
import { Toast, type ToastState } from "../components/shared/Toast";
import { DataTablePagination, TableEmptyState } from "../components/table/TableUI";
import type { RecordedAction, RecordedUrl, RecorderHandoffInfo } from "@src/recorder/RecorderTypes";
import { reviewStepAsync, summarizeReviews, classLabel } from "@src/profiles/asyncCompletionReview";

export function Recorder() {
  const [url, setUrl] = useState("https://example.com");
  const [isRecording, setIsRecording] = useState(false);
  const [captureWaitTime, setCaptureWaitTime] = useState(false);
  const [captureSmartWaits, setCaptureSmartWaits] = useState(true);
  /** True while the live Recorder session is running with HTTPS certificate validation disabled. */
  const [ignoreHttpsErrors, setIgnoreHttpsErrors] = useState(false);
  const [actions, setActions] = useState<RecordedAction[]>([]);
  const [flowName, setFlowName] = useState("New Recorded Flow");
  const [statusMsg, setStatusMsg] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [saveResult, setSaveResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const [handoff, setHandoff] = useState<RecorderHandoffInfo | null>(null);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [sessionNameInput, setSessionNameInput] = useState("");
  /** True while protected-login detection is being ignored (global setting or session override). */
  const [protectedDetectionIgnored, setProtectedDetectionIgnored] = useState(false);

  const [urls, setUrls] = useState<RecordedUrl[]>([]);
  const [urlSearch, setUrlSearch] = useState("");
  const [urlPage, setUrlPage] = useState(1);
  const [urlPageSize, setUrlPageSize] = useState(10);
  const actionsListRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRecording) {
      interval = setInterval(() => {
        window.playwrightFlowStudio.recorder.getActions()
          .then(setActions)
          .catch(console.error);
        window.playwrightFlowStudio.recorder.getUrls()
          .then(setUrls)
          .catch(() => undefined);
      }, 500);
    }
    return () => clearInterval(interval);
  }, [isRecording]);

  useEffect(() => {
    const list = actionsListRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }, [actions.length]);

  useEffect(() => {
    const poll = () => {
      window.playwrightFlowStudio.recorder.getHandoff()
        .then(setHandoff)
        .catch(() => undefined);
      window.playwrightFlowStudio.recorder.getStatus()
        .then((status) => {
          setIsRecording(status.isRecording);
          setProtectedDetectionIgnored(status.protectedDetectionIgnored ?? false);
          // Reflects the LIVE session's effective value (read from Settings at launch), not the
          // current Settings value — a mid-session Settings change must not change the indicator.
          setIgnoreHttpsErrors(status.ignoreHttpsErrors ?? false);
        })
        .catch(() => undefined);
    };
    poll();
    const interval = setInterval(poll, 800);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    window.playwrightFlowStudio.recorder.getStatus()
      .then((status) => setIsRecording(status.isRecording))
      .catch(() => setIsRecording(false));
    window.playwrightFlowStudio.recorder.getUrls()
      .then(setUrls)
      .catch(() => undefined);
    window.playwrightFlowStudio.settings.get()
      .then((settings) => {
        setCaptureWaitTime(settings.recorder?.captureWaitTime ?? false);
        setCaptureSmartWaits(settings.recorder?.captureSmartWaits ?? true);
      })
      .catch(() => undefined);
  }, []);

  const toggleCaptureWaitTime = () => {
    setCaptureWaitTime((current) => {
      const next = !current;
      window.playwrightFlowStudio.settings.update({ recorder: { captureWaitTime: next } }).catch(() => undefined);
      return next;
    });
  };

  const toggleCaptureSmartWaits = () => {
    setCaptureSmartWaits((current) => {
      const next = !current;
      window.playwrightFlowStudio.settings.update({ recorder: { captureSmartWaits: next } }).catch(() => undefined);
      return next;
    });
  };

  const useSavedUrl = (value: string) => {
    if (isRecording) return;
    setUrl(value);
    setStatusMsg("URL loaded from saved list.");
  };

  const saveCurrentUrl = async () => {
    const value = url.trim();
    if (!value) return;
    try {
      const updated = await window.playwrightFlowStudio.recorder.saveUrl(value);
      setUrls(updated);
      setStatusMsg("URL saved.");
    } catch {
      setStatusMsg("Could not save URL.");
    }
  };

  const filteredUrls = useMemo(() => {
    const query = urlSearch.trim().toLowerCase();
    const sorted = [...urls].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    if (!query) return sorted;
    return sorted.filter((record) =>
      `${record.url} ${record.title ?? ""} ${record.source} ${record.sessionId ?? ""}`.toLowerCase().includes(query)
    );
  }, [urls, urlSearch]);

  const urlTotalPages = Math.max(1, Math.ceil(filteredUrls.length / urlPageSize));
  const urlPageClamped = Math.min(urlPage, urlTotalPages);
  const pagedUrls = filteredUrls.slice((urlPageClamped - 1) * urlPageSize, urlPageClamped * urlPageSize);

  const copyUrl = (value: string) => {
    navigator.clipboard?.writeText(value).catch(() => undefined);
  };

  const handleStart = async () => {
    try {
      setStatusMsg("Starting browser...");
      await window.playwrightFlowStudio.recorder.start(url, { captureWaitTime, captureSmartWaits });
      setIsRecording(true);
      setStatusMsg(captureWaitTime || captureSmartWaits ? "Recording (capturing waits)..." : "Recording...");
      window.playwrightFlowStudio.recorder.saveUrl(url).then(setUrls).catch(() => undefined);
    } catch (err: any) {
      setStatusMsg(`Error: ${err.message}`);
    }
  };

  const handleStop = async () => {
    try {
      setStatusMsg("Stopping...");
      const finalActions = await window.playwrightFlowStudio.recorder.stop();
      setActions(finalActions);
      setIsRecording(false);
      setStatusMsg("Recording stopped. Ready to save.");
      window.playwrightFlowStudio.recorder.getUrls().then(setUrls).catch(() => undefined);
    } catch (err: any) {
      setStatusMsg(`Error: ${err.message}`);
    }
  };

  const handleCancel = async () => {
    try {
      await window.playwrightFlowStudio.recorder.cancel();
      setIsRecording(false);
      setActions([]);
      window.playwrightFlowStudio.recorder.getUrls().then(setUrls).catch(() => undefined);
      setStatusMsg("Recording cancelled.");
    } catch (err: any) {
      setStatusMsg(`Error: ${err.message}`);
    }
  };

  const handleIgnoreProtected = async () => {
    setHandoffBusy(true);
    try {
      const status = await window.playwrightFlowStudio.recorder.ignoreProtectedDetection();
      setHandoff(null);
      setIsRecording(status.isRecording);
      setProtectedDetectionIgnored(status.protectedDetectionIgnored ?? true);
      setStatusMsg("Protected detection ignored for this session. Complete any real login manually.");
      window.playwrightFlowStudio.recorder.getActions().then(setActions).catch(() => undefined);
    } catch (err: any) {
      setStatusMsg(`Could not resume recording: ${err?.message ?? err}`);
      window.playwrightFlowStudio.recorder.getHandoff().then(setHandoff).catch(() => undefined);
    } finally {
      setHandoffBusy(false);
    }
  };

  const handleContinueBrowser = async () => {
    setHandoffBusy(true);
    try {
      const updated = await window.playwrightFlowStudio.recorder.continueWithNormalBrowser();
      setHandoff(updated);
      setStatusMsg("Chrome opened for manual login. Complete it, then click Capture Session & Resume.");
    } catch (err: any) {
      setStatusMsg(`Could not open normal browser: ${err?.message ?? err}`);
      window.playwrightFlowStudio.recorder.getHandoff().then(setHandoff).catch(() => undefined);
    } finally {
      setHandoffBusy(false);
    }
  };

  const handleCaptureAndResume = async () => {
    setHandoffBusy(true);
    try {
      const updated = await window.playwrightFlowStudio.recorder.captureSessionAndResume(sessionNameInput.trim() || undefined);
      setHandoff(updated);
      setIsRecording(true);
      setStatusMsg(updated.message);
      setSessionNameInput("");
      window.playwrightFlowStudio.recorder.getActions().then(setActions).catch(() => undefined);
    } catch (err: any) {
      setStatusMsg(`Session capture failed: ${err?.message ?? err}`);
      window.playwrightFlowStudio.recorder.getHandoff().then(setHandoff).catch(() => undefined);
    } finally {
      setHandoffBusy(false);
    }
  };

  const handleCancelHandoff = async () => {
    setHandoffBusy(true);
    try {
      await window.playwrightFlowStudio.recorder.cancelHandoff();
      setHandoff(null);
      setIsRecording(false);
      setActions([]);
      setStatusMsg("Secure login handoff cancelled.");
    } catch (err: any) {
      setStatusMsg(`Error: ${err?.message ?? err}`);
    } finally {
      setHandoffBusy(false);
    }
  };

  // Async-activity review of the recorded actions, computed before saving (awkit-54t). Each action's
  // observed waits are classified Reliable / Needs review / Incomplete / Unsafe so the user can vet
  // them (and their contradictions) before the flow is persisted.
  const asyncReviews = useMemo(
    () => actions.map((a) => reviewStepAsync(a)).filter((r): r is NonNullable<typeof r> => r !== null),
    [actions]
  );
  const reviewSummary = useMemo(() => summarizeReviews(asyncReviews), [asyncReviews]);

  // Save flow: if the recording captured async activity, show the review summary first; otherwise
  // persist directly. Confirming in the modal calls doSave.
  const requestSave = () => {
    if (isSaving || saveDisabled) return;
    if (asyncReviews.length > 0) {
      setReviewOpen(true);
      return;
    }
    void doSave();
  };

  const doSave = async () => {
    if (isSaving) return;
    setReviewOpen(false);
    setIsSaving(true);
    setSaveResult(null);
    setStatusMsg("Saving flow...");
    try {
      await window.playwrightFlowStudio.recorder.saveFlow(flowName, actions);
      const message = `Flow saved to library successfully${flowName.trim() ? `: ${flowName.trim()}` : "."}`;
      setStatusMsg(message);
      setSaveResult({ tone: "success", text: message });
      setToast({ tone: "success", message });
      setActions([]);
      window.playwrightFlowStudio.recorder.getUrls().then(setUrls).catch(() => undefined);
    } catch (err: any) {
      const detail = typeof err?.message === "string" ? err.message : "";
      const message = `Failed to save flow to library. Please try again.${detail ? ` (${detail})` : ""}`;
      setStatusMsg(message);
      setSaveResult({ tone: "error", text: message });
      setToast({ tone: "error", message });
    } finally {
      setIsSaving(false);
    }
  };

  usePageChrome({
    actions: [],
    dirty: false
  }, []);

  const handoffActive = !!handoff?.active;
  const showHandoffPanel = !!handoff && handoff.phase !== "resumed";
  const saveDisabled = isRecording || isSaving || actions.length === 0 || !flowName.trim();

  return (
    <div className="page-content recorder-page">
      <section className={`recorder-control-bar${isRecording ? " is-recording" : ""}`} aria-label="Recorder controls">
        <header className="recorder-control-head">
          <div className="recorder-control-title">
            <Video size={18} />
            <div>
              <h3>Recorder Controls</h3>
              <span>Capture browser actions into a reusable flow.</span>
            </div>
          </div>
          <span className={`recorder-status-pill${isRecording ? " is-recording" : handoffActive ? " is-handoff" : " is-idle"}`}>
            {isRecording ? "Recording" : handoffActive ? "Manual handoff" : actions.length > 0 ? "Ready to save" : "Idle"}
          </span>
        </header>

        <div className="recorder-url-row">
          <label className="recorder-url-field">
            <span className="recorder-field-label">Target URL</span>
            <span className="recorder-url-input-shell">
              <Link size={16} />
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={isRecording}
                placeholder="https://example.com"
              />
            </span>
          </label>
          <div className="recorder-control-actions">
            <button
              type="button"
              className="toolbar-button recorder-button-subtle"
              disabled={isRecording || !url.trim()}
              onClick={() => void saveCurrentUrl()}
              title="Save this URL to the reusable list"
            >
              <Bookmark size={16} />
              Save URL
            </button>
            <button
              type="button"
              className="toolbar-button primary recorder-record-button"
              disabled={isRecording || handoffActive}
              onClick={handleStart}
            >
              <PlayCircle size={16} />
              Start Recording
            </button>
          </div>
        </div>

        <div className="recorder-switch-row">
          <button
            type="button"
            className={`recorder-switch${captureSmartWaits ? " is-on" : ""}`}
            role="switch"
            aria-checked={captureSmartWaits}
            disabled={isRecording}
            onClick={toggleCaptureSmartWaits}
            title="When on, condition-based waits are captured from page signals"
          >
            <span className="recorder-switch-track" aria-hidden><span /></span>
            <Sparkles size={15} />
            Smart waits {captureSmartWaits ? "On" : "Off"}
          </button>
          <button
            type="button"
            className={`recorder-switch recorder-switch-wait${captureWaitTime ? " is-on" : ""}`}
            role="switch"
            aria-checked={captureWaitTime}
            disabled={isRecording}
            onClick={toggleCaptureWaitTime}
            title="When on, pauses between your actions are recorded as wait steps"
          >
            <span className="recorder-switch-track" aria-hidden><span /></span>
            <Timer size={15} />
            Capture waiting time {captureWaitTime ? "On" : "Off"}
          </button>
          <span className="recorder-switch-note">Records pauses of 0.5s or longer between actions as wait steps.</span>
        </div>

        <div className="recorder-command-row">
          <button
            type="button"
            className="toolbar-button recorder-button-danger"
            disabled={!isRecording}
            onClick={handleStop}
          >
            <StopCircle size={16} />
            Stop
          </button>
          <button
            type="button"
            className="toolbar-button recorder-button-subtle"
            disabled={!isRecording}
            onClick={handleCancel}
          >
            <XCircle size={16} />
            Cancel
          </button>
          {statusMsg ? <span className="recorder-status-text">{statusMsg}</span> : null}
        </div>
      </section>

      {protectedDetectionIgnored && isRecording && !showHandoffPanel ? (
        <div className="recorder-ignore-notice" role="status" data-testid="protected-ignore-notice">
          <ShieldAlert size={15} />
          <span>
            Protected login detection is ignored for this Recorder session. Authentication and security
            steps (login, MFA, CAPTCHA) must still be completed manually.
          </span>
        </div>
      ) : null}

      {/* Non-blocking security indicator: rendered BELOW the toolbar so it never covers the
          Start/Stop/Cancel controls. Shown only while a session is actually running with the bypass. */}
      {isRecording && ignoreHttpsErrors ? (
        <section className="recorder-security-notice" role="status">
          <ShieldAlert size={16} />
          <span>
            Certificate validation is disabled for this Recorder session. Change it in Settings → Recorder
            Security.
          </span>
        </section>
      ) : null}

      {showHandoffPanel && handoff ? (
        <section
          className={`recorder-handoff-panel${handoff.phase === "error" ? " is-error" : ""}`}
          data-testid="protected-handoff-panel"
          role="alertdialog"
          aria-label="Protected login detected"
        >
          <div className="recorder-handoff-head">
            <ShieldAlert size={20} />
            <h3>{handoff.phase === "error" ? "Secure login handoff error" : "Protected login or protected popup detected"}</h3>
          </div>

          <p>{handoff.message}</p>

          <div className="recorder-handoff-meta">
            <span><strong>Source:</strong> {handoff.sourceAlias}</span>
            <span><strong>Reason:</strong> {handoff.reason}</span>
            {handoff.origin ? <span><strong>Origin:</strong> {handoff.origin}</span> : null}
            {handoff.signals.length > 0 ? <span><strong>Signals:</strong> {handoff.signals.join(", ")}</span> : null}
          </div>

          {handoff.phase === "error" && handoff.error ? (
            <div className="recorder-handoff-error">{handoff.error}</div>
          ) : null}

          {handoff.phase === "capturingSession" ? (
            <div className="recorder-handoff-session">
              <label className="recorder-field-label">Session name (optional)</label>
              <input
                type="text"
                value={sessionNameInput}
                onChange={(e) => setSessionNameInput(e.target.value)}
                placeholder="e.g. Acme Portal Login"
                disabled={handoffBusy}
              />
              {handoff.sessionName ? <span>Saved session: {handoff.sessionName}</span> : null}
            </div>
          ) : null}

          <div className="recorder-handoff-actions">
            {handoff.phase === "detected" ? (
              <button
                type="button"
                className="toolbar-button primary"
                data-testid="handoff-ignore-continue"
                disabled={handoffBusy}
                onClick={() => void handleIgnoreProtected()}
                title="Treat this as a false positive and keep recording on the same page. Does not bypass authentication."
              >
                <PlayCircle size={16} />
                Ignore and continue recording
              </button>
            ) : null}

            {handoff.phase === "detected" || handoff.phase === "error" ? (
              <button
                type="button"
                className="toolbar-button"
                data-testid="handoff-continue-browser"
                disabled={handoffBusy}
                onClick={() => void handleContinueBrowser()}
              >
                <ExternalLink size={16} />
                {handoff.phase === "error" ? "Retry in normal browser" : "Continue using normal browser"}
              </button>
            ) : null}

            {handoff.phase === "capturingSession" ? (
              <button
                type="button"
                className="toolbar-button recorder-button-success"
                data-testid="handoff-capture-resume"
                disabled={handoffBusy}
                onClick={() => void handleCaptureAndResume()}
              >
                {handoffBusy ? <RefreshCw size={16} className="spin" /> : <CheckCircle2 size={16} />}
                {handoffBusy ? "Capturing..." : "Capture Session & Resume"}
              </button>
            ) : null}

            {handoff.phase === "sessionCaptured" ? (
              <span className="recorder-handoff-resuming">
                <RefreshCw size={16} className="spin" /> Resuming recorder with the saved session...
              </span>
            ) : null}

            <button
              type="button"
              className="toolbar-button recorder-button-subtle"
              data-testid="handoff-cancel"
              disabled={handoffBusy}
              onClick={() => void handleCancelHandoff()}
            >
              <XCircle size={16} />
              {handoff.phase === "detected" || handoff.phase === "error" ? "Cancel recording" : "Cancel"}
            </button>
          </div>
        </section>
      ) : null}

      <div className="recorder-main-grid">
        <section className="form-panel recorder-actions-panel">
          <header className="recorder-panel-header">
            <div className="recorder-panel-title">
              <Video size={18} />
              <div>
                <h3>Recorded Actions</h3>
                <span>{actions.length} captured action{actions.length === 1 ? "" : "s"}</span>
              </div>
            </div>
            {isRecording ? <span className="recorder-recording-dot" title="Recording" /> : null}
          </header>

          {actions.length === 0 ? (
            <div className="recorder-empty">
              <Video size={40} />
              <strong>No actions recorded yet.</strong>
              <span>Start recording to capture browser events.</span>
            </div>
          ) : (
            <div ref={actionsListRef} className="recorder-timeline" aria-live="polite">
              {actions.map((action, index) => {
                const actionBadge = recorderActionBadge(action);
                const waitTypes = [...(action.beforeWaits ?? []), ...(action.afterWaits ?? [])].map((wait) => wait.type);

                return (
                  <article key={action.id} className="recorder-timeline-row">
                    <div className="recorder-timeline-marker" aria-hidden>
                      <span>{index + 1}</span>
                    </div>
                    <div className="recorder-action-card">
                      <div className={`recorder-action-icon tone-${recorderActionTone(action.type)}`}>
                        <RecorderActionIcon type={action.type} />
                      </div>
                      <div className="recorder-action-main">
                        <div className="recorder-action-head">
                          <strong>{action.name}</strong>
                          <span className="recorder-action-type">{formatActionType(action.type)}</span>
                          {actionBadge ? <span className="recorder-action-badge">{actionBadge}</span> : null}
                        </div>
                        {action.locator ? (
                          <code className="recorder-locator-code">
                            {action.locator.strategy}: {action.locator.value}
                          </code>
                        ) : null}
                        {waitTypes.length > 0 ? (
                          <span className="recorder-wait-note">Smart waits: {waitTypes.join(", ")}</span>
                        ) : null}
                      </div>
                      {action.valueSource ? (
                        <div className="recorder-action-value" title={action.valueSource.value}>
                          <ArrowRight size={12} />
                          <span>{action.valueSource.value}</span>
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <aside className="form-panel recorder-save-panel">
          <header className="recorder-panel-header">
            <div className="recorder-panel-title">
              <Save size={18} />
              <div>
                <h3>Save Options</h3>
                <span>Send the captured actions to the Flow Library.</span>
              </div>
            </div>
          </header>
          <div className="recorder-save-stack">
            <label className="recorder-field">
              <span className="recorder-field-label">Flow Name</span>
              <input
                type="text"
                value={flowName}
                onChange={(e) => setFlowName(e.target.value)}
                disabled={isRecording}
              />
            </label>
            <button
              type="button"
              className="toolbar-button recorder-button-success recorder-save-button"
              disabled={saveDisabled}
              onClick={requestSave}
            >
              <Save size={16} />
              {isSaving ? "Saving..." : "Save to Flow Library"}
            </button>
            {saveResult ? (
              <div role="status" className={`recorder-save-result ${saveResult.tone}`}>
                {saveResult.tone === "success" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                <span>{saveResult.text}</span>
              </div>
            ) : null}
            {actions.length === 0 && !isRecording && !isSaving ? (
              <p className="recorder-save-hint">Record some actions first.</p>
            ) : null}
          </div>
        </aside>
      </div>

      <section className="form-panel recorder-saved-urls-panel">
        <header className="recorder-panel-header">
          <div className="recorder-panel-title">
            <Globe size={18} />
            <div>
              <h3>Recorded URLs</h3>
              <span>{filteredUrls.length} matching URL{filteredUrls.length === 1 ? "" : "s"}</span>
            </div>
          </div>
        </header>

        <div className="table-search recorder-url-search">
          <Search size={15} />
          <input
            value={urlSearch}
            placeholder="Search by URL, title, source, or session..."
            onChange={(e) => {
              setUrlSearch(e.target.value);
              setUrlPage(1);
            }}
          />
          {urlSearch ? (
            <button type="button" title="Clear search" onClick={() => { setUrlSearch(""); setUrlPage(1); }}>
              <X size={14} />
            </button>
          ) : null}
        </div>

        {urls.length === 0 ? (
          <TableEmptyState filtered={false} title="No URLs recorded yet." hint="Start recording and navigate to pages to see them here." />
        ) : filteredUrls.length === 0 ? (
          <TableEmptyState filtered title="No matching URLs found." hint="Adjust your search text." />
        ) : (
          <>
            <div className="wl-table-wrapper">
              <table className="wl-table recorded-urls-table">
                <colgroup>
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "22%" }} />
                  <col style={{ width: "36%" }} />
                  <col style={{ width: "13%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "7%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Title</th>
                    <th>URL</th>
                    <th>Source</th>
                    <th>Session</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedUrls.map((record) => (
                    <tr key={record.id}>
                      <td title={new Date(record.timestamp).toLocaleString()}>{new Date(record.timestamp).toLocaleTimeString()}</td>
                      <td title={record.title || undefined}>{record.title || "--"}</td>
                      <td title={isRecording ? record.url : `Click to use: ${record.url}`}>
                        <button
                          type="button"
                          className="recorded-url-value recorded-url-use"
                          disabled={isRecording}
                          onClick={() => useSavedUrl(record.url)}
                        >
                          {record.url}
                        </button>
                      </td>
                      <td>
                        <span className="state-pill">{record.source}</span>
                      </td>
                      <td title={record.sessionId || undefined}>{record.sessionId ? record.sessionId.slice(0, 8) : "--"}</td>
                      <td>
                        <div className="table-actions">
                          <button type="button" title="Use this URL in Recorder Controls" disabled={isRecording} onClick={() => useSavedUrl(record.url)}>
                            <CornerDownLeft size={14} />
                          </button>
                          <button type="button" title="Copy URL" onClick={() => copyUrl(record.url)}>
                            <Copy size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <DataTablePagination
              page={urlPageClamped}
              totalPages={urlTotalPages}
              total={filteredUrls.length}
              pageSize={urlPageSize}
              onPage={setUrlPage}
              onPageSize={(size) => {
                setUrlPageSize(size);
                setUrlPage(1);
              }}
            />
          </>
        )}
      </section>
      {reviewOpen ? (
        <div className="modal-overlay" role="presentation" onClick={() => setReviewOpen(false)}>
          <div
            className="modal-dialog recorder-review-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Async activity review"
            data-testid="recorder-review-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <span className={`modal-icon ${reviewSummary.worst === "unsafe" || reviewSummary.worst === "incomplete" ? "warn" : "create"}`}>
                <ClipboardCheck size={18} />
              </span>
              <h2>Review async activity before saving</h2>
            </div>
            <p className="modal-body">
              {reviewSummary.total} recorded action{reviewSummary.total === 1 ? "" : "s"} captured asynchronous activity.
              {" "}Reliable {reviewSummary.counts.reliable} · Needs review {reviewSummary.counts.needsReview} · Incomplete{" "}
              {reviewSummary.counts.incomplete} · Unsafe {reviewSummary.counts.unsafe}. Unsafe or incomplete conditions are
              flagged below — you can still save, but they will not behave as reliable waits.
            </p>
            <div className="recorder-review-list">
              {asyncReviews.map((r) => {
                const badge = classLabel(r.classification);
                const waitWarnings = r.waits.flatMap((w) => w.warnings);
                return (
                  <div className="recorder-review-item" key={r.id}>
                    <div className="recorder-review-item-head">
                      <strong>{r.name}</strong>
                      <span className={`async-badge async-badge-${r.classification}`} title={badge.hint}>{badge.label}</span>
                    </div>
                    <span>
                      Policy: {r.completionMode} · {r.waits.length} condition{r.waits.length === 1 ? "" : "s"}
                    </span>
                    {[...r.warnings, ...waitWarnings].slice(0, 4).map((w, i) => (
                      <small key={i} className="async-warning">⚠ {w}</small>
                    ))}
                  </div>
                );
              })}
            </div>
            <div className="modal-actions">
              <button type="button" className="toolbar-button" onClick={() => setReviewOpen(false)}>
                Keep editing
              </button>
              <button
                type="button"
                className="toolbar-button recorder-button-success"
                data-testid="review-confirm-save"
                onClick={() => void doSave()}
                disabled={isSaving}
              >
                <Save size={16} />
                {isSaving ? "Saving..." : "Save to Flow Library"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

function recorderActionTone(type: string): "nav" | "click" | "input" | "wait" | "session" | "default" {
  const normalized = type.toLowerCase();
  if (normalized.includes("wait")) return "wait";
  if (normalized.includes("session") || normalized.includes("login") || normalized.includes("secure")) return "session";
  if (normalized.includes("goto") || normalized.includes("navigate") || normalized.includes("popup") || normalized.includes("mainpage")) return "nav";
  if (normalized.includes("fill") || normalized.includes("input") || normalized.includes("type") || normalized.includes("select")) return "input";
  if (normalized.includes("click") || normalized.includes("press")) return "click";
  return "default";
}

function RecorderActionIcon({ type }: { type: string }) {
  const tone = recorderActionTone(type);
  if (tone === "nav") return <Globe size={15} />;
  if (tone === "click") return <CornerDownLeft size={15} />;
  if (tone === "input") return <ArrowRight size={15} />;
  if (tone === "wait") return <Timer size={15} />;
  if (tone === "session") return <ShieldAlert size={15} />;
  return <Video size={15} />;
}

function recorderActionBadge(action: RecordedAction): string | null {
  if (action.type === "switchToPopup") return "Switch popup";
  if (action.type === "closePopup") return "Close popup";
  if (action.type === "switchToMainPage") return "Main page";
  if (action.opensPopup) return "Opens popup";
  if (action.pageAlias && action.pageAlias !== "main") return action.pageAlias;
  return null;
}

function formatActionType(type: string): string {
  const formatted = type
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return formatted ? formatted.charAt(0).toUpperCase() + formatted.slice(1) : "Action";
}
