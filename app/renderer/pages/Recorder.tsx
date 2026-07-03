import { useState, useEffect, useMemo } from "react";
import { PlayCircle, StopCircle, XCircle, Save, Video, Link, ArrowRight, CheckCircle2, AlertCircle, Search, X, Copy, Globe, Timer, Bookmark, CornerDownLeft } from "lucide-react";
import { usePageChrome } from "../state/pageChrome";
import { Toast, type ToastState } from "../components/shared/Toast";
import { DataTablePagination, TableEmptyState } from "../components/table/TableUI";
import type { RecordedAction, RecordedUrl } from "@src/recorder/RecorderTypes";

export function Recorder() {
  const [url, setUrl] = useState("https://example.com");
  const [isRecording, setIsRecording] = useState(false);
  // Task 1: optionally capture the user's think-time between actions as wait steps (persisted).
  const [captureWaitTime, setCaptureWaitTime] = useState(false);
  const [actions, setActions] = useState<RecordedAction[]>([]);
  const [flowName, setFlowName] = useState("New Recorded Flow");
  const [statusMsg, setStatusMsg] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  // Inline + toast feedback for the "Save to Flow Library" action.
  const [saveResult, setSaveResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  // Recorded URLs table (auto-captured during recording).
  const [urls, setUrls] = useState<RecordedUrl[]>([]);
  const [urlSearch, setUrlSearch] = useState("");
  const [urlPage, setUrlPage] = useState(1);
  const [urlPageSize, setUrlPageSize] = useState(10);

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
    window.playwrightFlowStudio.recorder.getStatus()
      .then(status => setIsRecording(status.isRecording))
      .catch(() => setIsRecording(false));
    // Load any URLs captured in the current/last session so they survive re-opening the screen.
    window.playwrightFlowStudio.recorder.getUrls()
      .then(setUrls)
      .catch(() => undefined);
    // Restore the persisted "capture waiting time" preference (Task 1).
    window.playwrightFlowStudio.settings.get()
      .then((settings) => setCaptureWaitTime(settings.recorder?.captureWaitTime ?? false))
      .catch(() => undefined);
  }, []);

  const toggleCaptureWaitTime = () => {
    setCaptureWaitTime((current) => {
      const next = !current;
      window.playwrightFlowStudio.settings.update({ recorder: { captureWaitTime: next } }).catch(() => undefined);
      return next;
    });
  };

  // Fill the Recorder Controls URL field from a saved URL record (does not start recording).
  const useSavedUrl = (value: string) => {
    if (isRecording) return;
    setUrl(value);
    setStatusMsg("URL loaded from saved list.");
  };

  // Persist the current URL into the reusable saved-URL history without recording.
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

  // Filter (URL / title / source / session) → sort newest-first → paginate.
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
      await window.playwrightFlowStudio.recorder.start(url, { captureWaitTime });
      setIsRecording(true);
      setStatusMsg(captureWaitTime ? "Recording (capturing wait time)..." : "Recording...");
      // Persist the entered URL to the reusable saved-URL list (Task 6).
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
      // Saved URLs persist across a cancel so they stay reusable — refresh from the backend.
      window.playwrightFlowStudio.recorder.getUrls().then(setUrls).catch(() => undefined);
      setStatusMsg("Recording cancelled.");
    } catch (err: any) {
      setStatusMsg(`Error: ${err.message}`);
    }
  };

  const handleSave = async () => {
    // Guard against duplicate clicks corrupting the save while one is in flight.
    if (isSaving) return;
    setIsSaving(true);
    setSaveResult(null);
    setStatusMsg("Saving flow...");
    try {
      await window.playwrightFlowStudio.recorder.saveFlow(flowName, actions);
      const message = `Flow saved to library successfully${flowName.trim() ? `: ${flowName.trim()}` : "."}`;
      setStatusMsg(message);
      setSaveResult({ tone: "success", text: message });
      setToast({ tone: "success", message });
      // The recording is now saved as a flow; the service discards its draft, so clear the
      // recorded actions here. Saved URLs persist for reuse — refresh them from the backend.
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

  return (
    <div className="page-content" style={{ display: "flex", flexDirection: "column", gap: "20px", padding: "20px" }}>
      <div className="form-panel" style={{ padding: "20px", background: "#fff", borderRadius: "8px", border: "1px solid #dfe6ef" }}>
        <h3 style={{ margin: "0 0 15px 0", fontSize: "16px", color: "#1e293b", display: "flex", alignItems: "center", gap: "8px" }}>
          <Video size={18} />
          Recorder Controls
        </h3>
        
        <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "15px" }}>
          <div style={{ display: "flex", alignItems: "center", flex: 1, border: "1px solid #cbd5e1", borderRadius: "6px", padding: "0 10px" }}>
            <Link size={16} color="#64748b" />
            <input 
              type="text" 
              value={url} 
              onChange={e => setUrl(e.target.value)}
              disabled={isRecording}
              style={{ flex: 1, border: "none", padding: "10px", outline: "none", background: "transparent" }}
              placeholder="https://example.com"
            />
          </div>
          <button
            disabled={isRecording || !url.trim()}
            onClick={() => void saveCurrentUrl()}
            title="Save this URL to the reusable list"
            style={{ display: "flex", alignItems: "center", gap: "6px", padding: "10px 14px", background: "transparent", color: isRecording || !url.trim() ? "#94a3b8" : "#475569", border: "1px solid", borderColor: isRecording || !url.trim() ? "#e2e8f0" : "#cbd5e1", borderRadius: "6px", cursor: isRecording || !url.trim() ? "not-allowed" : "pointer", fontWeight: 500 }}
          >
            <Bookmark size={16} />
            Save URL
          </button>
          <button
            disabled={isRecording}
            onClick={handleStart}
            style={{ display: "flex", alignItems: "center", gap: "6px", padding: "10px 16px", background: isRecording ? "#e2e8f0" : "#2563eb", color: isRecording ? "#94a3b8" : "#fff", border: "none", borderRadius: "6px", cursor: isRecording ? "not-allowed" : "pointer", fontWeight: 500 }}
          >
            <PlayCircle size={16} />
            Start Recording
          </button>
        </div>

        {/* Task 1: capture user waiting time between actions as wait steps. */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "15px" }}>
          <button
            type="button"
            role="switch"
            aria-checked={captureWaitTime}
            disabled={isRecording}
            onClick={toggleCaptureWaitTime}
            title="When on, pauses between your actions are recorded as wait steps"
            style={{
              display: "inline-flex", alignItems: "center", gap: "8px", padding: "6px 10px",
              background: captureWaitTime ? "#ecfdf3" : "#f8fafc",
              border: "1px solid", borderColor: captureWaitTime ? "#abefc6" : "#cbd5e1",
              borderRadius: "999px", cursor: isRecording ? "not-allowed" : "pointer",
              color: captureWaitTime ? "#067647" : "#475569", fontWeight: 600, fontSize: "13px",
              opacity: isRecording ? 0.7 : 1
            }}
          >
            <span
              aria-hidden
              style={{
                width: "34px", height: "18px", borderRadius: "999px", position: "relative",
                background: captureWaitTime ? "#10b981" : "#cbd5e1", transition: "background 0.15s ease", flex: "0 0 auto"
              }}
            >
              <span
                style={{
                  position: "absolute", top: "2px", left: captureWaitTime ? "18px" : "2px",
                  width: "14px", height: "14px", borderRadius: "50%", background: "#fff", transition: "left 0.15s ease"
                }}
              />
            </span>
            <Timer size={15} />
            Capture waiting time {captureWaitTime ? "On" : "Off"}
          </button>
          <span style={{ fontSize: "12px", color: "#94a3b8" }}>
            Records pauses (≥ 0.5s) between actions as wait steps.
          </span>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button 
            disabled={!isRecording} 
            onClick={handleStop}
            style={{ display: "flex", alignItems: "center", gap: "6px", padding: "10px 16px", background: !isRecording ? "#e2e8f0" : "#ef4444", color: !isRecording ? "#94a3b8" : "#fff", border: "none", borderRadius: "6px", cursor: !isRecording ? "not-allowed" : "pointer", fontWeight: 500 }}
          >
            <StopCircle size={16} />
            Stop
          </button>
          <button 
            disabled={!isRecording} 
            onClick={handleCancel}
            style={{ display: "flex", alignItems: "center", gap: "6px", padding: "10px 16px", background: "transparent", color: !isRecording ? "#94a3b8" : "#64748b", border: "1px solid", borderColor: !isRecording ? "#e2e8f0" : "#cbd5e1", borderRadius: "6px", cursor: !isRecording ? "not-allowed" : "pointer", fontWeight: 500 }}
          >
            <XCircle size={16} />
            Cancel
          </button>

          <span style={{ marginLeft: "auto", fontSize: "14px", color: "#64748b" }}>
            {statusMsg}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", gap: "20px" }}>
        <div className="form-panel" style={{ flex: 1, padding: "20px", background: "#fff", borderRadius: "8px", border: "1px solid #dfe6ef", minHeight: "400px" }}>
          <h3 style={{ margin: "0 0 15px 0", fontSize: "16px", color: "#1e293b", display: "flex", alignItems: "center", gap: "8px", justifyContent: "space-between" }}>
            <span>Recorded Actions ({actions.length})</span>
            {isRecording && <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#ef4444", display: "inline-block", animation: "pulse 1.5s infinite" }} />}
          </h3>
          
          {actions.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "300px", color: "#94a3b8" }}>
              <Video size={48} style={{ marginBottom: "16px", opacity: 0.5 }} />
              <p>No actions recorded yet.</p>
              <p style={{ fontSize: "12px", marginTop: "8px" }}>Click 'Start Recording' to begin capturing browser events.</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "400px", overflowY: "auto", paddingRight: "10px" }}>
              {actions.map((action, index) => (
                <div key={action.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px", background: "#f8fafc", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                  <span style={{ background: "#cbd5e1", color: "#475569", padding: "2px 6px", borderRadius: "4px", fontSize: "12px", fontWeight: "bold" }}>
                    {index + 1}
                  </span>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <strong style={{ fontSize: "14px", color: "#334155" }}>{action.name}</strong>
                    {action.locator && (
                      <span style={{ fontSize: "12px", color: "#64748b", fontFamily: "monospace" }}>
                        {action.locator.strategy}: {action.locator.value}
                      </span>
                    )}
                  </div>
                  {action.valueSource && (
                    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#0ea5e9", background: "#e0f2fe", padding: "4px 8px", borderRadius: "4px" }}>
                      <ArrowRight size={12} />
                      "{action.valueSource.value}"
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="form-panel" style={{ width: "300px", padding: "20px", background: "#fff", borderRadius: "8px", border: "1px solid #dfe6ef", height: "fit-content" }}>
          <h3 style={{ margin: "0 0 15px 0", fontSize: "16px", color: "#1e293b", display: "flex", alignItems: "center", gap: "8px" }}>
            <Save size={18} />
            Save Options
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "12px", fontWeight: "bold", color: "#475569", textTransform: "uppercase" }}>Flow Name</label>
              <input 
                type="text" 
                value={flowName} 
                onChange={e => setFlowName(e.target.value)}
                style={{ padding: "10px", border: "1px solid #cbd5e1", borderRadius: "6px", outline: "none", width: "100%", boxSizing: "border-box" }}
              />
            </div>
            {(() => {
              const saveDisabled = isRecording || isSaving || actions.length === 0 || !flowName.trim();
              return (
                <button
                  disabled={saveDisabled}
                  onClick={handleSave}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", padding: "10px 16px", background: saveDisabled ? "#e2e8f0" : "#10b981", color: saveDisabled ? "#94a3b8" : "#fff", border: "none", borderRadius: "6px", cursor: saveDisabled ? "not-allowed" : "pointer", fontWeight: "bold", width: "100%" }}
                >
                  <Save size={16} />
                  {isSaving ? "Saving…" : "Save to Flow Library"}
                </button>
              );
            })()}
            {saveResult && (
              <div
                role="status"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "12px",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: `1px solid ${saveResult.tone === "success" ? "#abefc6" : "#fecdca"}`,
                  background: saveResult.tone === "success" ? "#ecfdf3" : "#fef3f2",
                  color: saveResult.tone === "success" ? "#067647" : "#b42318"
                }}
              >
                {saveResult.tone === "success" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                <span>{saveResult.text}</span>
              </div>
            )}
            {actions.length === 0 && !isRecording && !isSaving && (
               <p style={{ fontSize: "12px", color: "#94a3b8", textAlign: "center", margin: 0 }}>Record some actions first</p>
            )}
          </div>
        </div>
      </div>

      {/* Recorded URLs — auto-captured during recording */}
      <div className="form-panel" style={{ padding: "20px", background: "#fff", borderRadius: "8px", border: "1px solid #dfe6ef" }}>
        <h3 style={{ margin: "0 0 15px 0", fontSize: "16px", color: "#1e293b", display: "flex", alignItems: "center", gap: "8px" }}>
          <Globe size={18} />
          Recorded URLs ({filteredUrls.length})
        </h3>

        <div className="table-search" style={{ maxWidth: 460, marginBottom: 12 }}>
          <Search size={15} />
          <input
            value={urlSearch}
            placeholder="Search by URL, title, source, or session…"
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
                      <td title={record.title || undefined}>{record.title || "—"}</td>
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
                      <td title={record.sessionId || undefined}>{record.sessionId ? record.sessionId.slice(0, 8) : "—"}</td>
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
      </div>
      <style>{`
        @keyframes pulse {
          0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
          70% { box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
          100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        }
      `}</style>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
