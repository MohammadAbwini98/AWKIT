import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  KeyRound,
  Chrome,
  Search,
  X,
  Trash2,
  Edit3,
  FolderOpen,
  Play,
  Square,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Globe,
  Clock,
  Info
} from "lucide-react";
import { usePageChrome } from "../state/pageChrome";
import { Toast, type ToastState } from "../components/shared/Toast";
import { DataTablePagination, TableEmptyState } from "../components/table/TableUI";
import type { SessionProfile, SessionCaptureStatus, DetectedBrowser } from "@src/session/SessionProfile";

export function SessionsManager() {
  // ─── State ──────────────────────────────────────────────────────────
  const [profiles, setProfiles] = useState<SessionProfile[]>([]);
  const [captureStatus, setCaptureStatus] = useState<SessionCaptureStatus>({ active: false, status: "idle" });
  const [browser, setBrowser] = useState<DetectedBrowser | null>(null);

  const [sessionName, setSessionName] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const captureNameRef = useRef<HTMLInputElement | null>(null);

  // Table state
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Rename inline editing
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // ─── Data loading ───────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    try {
      const [list, status, detected] = await Promise.all([
        window.playwrightFlowStudio.session.list(),
        window.playwrightFlowStudio.session.getStatus(),
        window.playwrightFlowStudio.session.detectBrowser()
      ]);
      setProfiles(list);
      setCaptureStatus(status);
      setBrowser(detected);
    } catch {
      // best effort
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll while capturing is active
  useEffect(() => {
    if (!captureStatus.active) return;
    const interval = setInterval(async () => {
      try {
        const [status, list] = await Promise.all([
          window.playwrightFlowStudio.session.getStatus(),
          window.playwrightFlowStudio.session.list()
        ]);
        setCaptureStatus(status);
        setProfiles(list);
        if (!status.active) clearInterval(interval);
      } catch {
        // best effort
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [captureStatus.active]);

  // ─── Filtered + paginated profiles ─────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...profiles].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    if (!q) return sorted;
    return sorted.filter(
      (p) => `${p.name} ${p.targetUrl ?? ""} ${p.origin ?? ""} ${p.source ?? ""} ${p.status} ${p.id}`.toLowerCase().includes(q)
    );
  }, [profiles, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageClamped = Math.min(page, totalPages);
  const paged = filtered.slice((pageClamped - 1) * pageSize, pageClamped * pageSize);

  // ─── Actions ────────────────────────────────────────────────────────
  const handleStartCapture = async () => {
    if (isStarting || captureStatus.active) return;
    if (!sessionName.trim()) {
      setToast({ tone: "error", message: "Enter a session name." });
      return;
    }
    setIsStarting(true);
    try {
      const status = await window.playwrightFlowStudio.session.startCapture({
        name: sessionName.trim(),
        targetUrl: targetUrl.trim()
      });
      setCaptureStatus(status);
      setToast({ tone: "success", message: `Browser launched. Log in manually, then close the browser when done.` });
      await refresh();
    } catch (err: any) {
      setToast({ tone: "error", message: err?.message ?? "Failed to start session capture." });
    } finally {
      setIsStarting(false);
    }
  };

  const handleStopCapture = async () => {
    try {
      await window.playwrightFlowStudio.session.stopCapture();
      setCaptureStatus({ active: false, status: "closed" });
      setToast({ tone: "success", message: "Capture stopped. Session profile saved." });
      await refresh();
    } catch (err: any) {
      setToast({ tone: "error", message: err?.message ?? "Failed to stop capture." });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await window.playwrightFlowStudio.session.delete(id);
      setToast({ tone: "success", message: "Session profile deleted." });
      await refresh();
    } catch (err: any) {
      setToast({ tone: "error", message: err?.message ?? "Failed to delete." });
    }
  };

  const handleRenameStart = (profile: SessionProfile) => {
    setRenamingId(profile.id);
    setRenameValue(profile.name);
  };

  const handleRenameSubmit = async (id: string) => {
    if (!renameValue.trim()) {
      setRenamingId(null);
      return;
    }
    try {
      await window.playwrightFlowStudio.session.rename({ id, newName: renameValue.trim() });
      setRenamingId(null);
      await refresh();
    } catch (err: any) {
      setToast({ tone: "error", message: err?.message ?? "Failed to rename." });
    }
  };

  const handleOpenFolder = async (profile: SessionProfile) => {
    try {
      await window.playwrightFlowStudio.system.openPath(profile.profileDir);
    } catch {
      // best effort
    }
  };

  const focusCapture = () => {
    captureNameRef.current?.scrollIntoView({ block: "center" });
    captureNameRef.current?.focus();
  };

  usePageChrome(
    {
      actions: [
        {
          id: "capture-session",
          label: "Capture session",
          icon: <Play size={15} aria-hidden="true" />,
          variant: "primary",
          disabled: captureStatus.active,
          onClick: focusCapture,
          title: captureStatus.active ? "A session capture is already active" : "Focus the session capture details"
        },
        {
          id: "refresh-sessions",
          label: "Refresh",
          icon: <RefreshCw size={15} aria-hidden="true" />,
          onClick: () => void refresh(),
          title: "Reload saved sessions and browser detection"
        }
      ],
      dirty: false
    },
    [captureStatus.active, refresh]
  );

  // ─── Render ─────────────────────────────────────────────────────────
  // Status pills use the shared status-token trio (-soft fill, base ink, -muted border) so
  // they track the theme. Never concatenate alpha onto a var() string — `var(--x)1a` is
  // invalid CSS and the declaration is silently dropped.
  const statusTone = (s: SessionProfile["status"]) =>
    s === "ready" ? "success" : s === "capturing" ? "warning" : "danger";

  const statusLabel = (s: SessionProfile["status"]) =>
    s === "ready" ? "Ready" : s === "capturing" ? "Capturing…" : "Error";

  return (
    <section className="page sessions-system-page operations-system-page">
      <h1 className="sr-only">Sessions</h1>

      <section className={`operations-system-banner sessions-browser-banner ${browser?.found ? "tone-success" : "tone-danger"}`}>
        <Chrome size={20} aria-hidden="true" />
        {browser?.found ? (
          <span>
            <strong>{browser.browser === "chrome" ? "Google Chrome" : "Microsoft Edge"}</strong> detected at{" "}
            <code>{browser.path}</code>
          </span>
        ) : (
          <span>
            No Chrome or Edge browser found. Install one to use Session Capture.
          </span>
        )}
      </section>

      <section className="operations-system-panel sessions-capture-panel" aria-labelledby="capture-session-heading">
        <div className="operations-system-panel-head">
          <div>
            <h2 id="capture-session-heading"><KeyRound size={18} aria-hidden="true" />Capture session</h2>
            <span>Open a real Chrome or Edge profile, sign in manually, then close it to save the reusable session.</span>
          </div>
          <span className={`state-pill sessions-capture-status ${captureStatus.active ? "is-capturing" : "is-idle"}`}>
            {captureStatus.active ? "Capture active" : "Ready to capture"}
          </span>
        </div>

        {captureStatus.active ? (
          <div className="sessions-active-capture">
            <div className="sessions-active-capture-title">
              <Loader2 size={18} className="sessions-spin" aria-hidden="true" />
              <strong>Browser is open — log in manually</strong>
            </div>
            <p>
              Session: <strong>{captureStatus.sessionName}</strong>
              {captureStatus.browserPid ? ` (PID ${captureStatus.browserPid})` : ""}.
              Complete your login, then <strong>close the browser window</strong> when done.
              The session profile will be saved automatically.
            </p>
            <button
              onClick={handleStopCapture}
              className="toolbar-button danger"
              type="button"
            >
              <Square size={14} />
              Force Close Browser
            </button>
          </div>
        ) : (
          <div className="sessions-capture-form">
            <div className="sessions-capture-fields">
              <label className="sessions-field">
                  Session Name
                <input
                  ref={captureNameRef}
                  type="text"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  placeholder="e.g. Google Work Account"
                />
              </label>
              <label className="sessions-field">
                  Target URL <span className="sessions-field-optional">(optional)</span>
                <span className="sessions-url-input">
                  <Globe size={14} aria-hidden="true" />
                  <input
                    type="text"
                    value={targetUrl}
                    onChange={(e) => setTargetUrl(e.target.value)}
                    placeholder="https://accounts.google.com"
                  />
                </span>
              </label>
            </div>
            <div className="sessions-capture-actions">
              <button
                disabled={isStarting || !browser?.found || !sessionName.trim()}
                onClick={handleStartCapture}
                className="toolbar-button primary"
                type="button"
              >
                <Play size={15} />
                {isStarting ? "Launching…" : "Open Browser & Capture Session"}
              </button>
              <button
                onClick={refresh}
                title="Refresh"
                className="toolbar-button"
                type="button"
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="operations-system-banner sessions-security-banner tone-info">
        <Info size={16} aria-hidden="true" />
        <div>
          <strong>How it works:</strong> This opens your real Chrome/Edge browser — not the
          automation Chromium — so login pages like Google won't block you. After you log in
          and close the browser, select the saved session when running a workflow. The
          automation browser will reuse your login state.
        </div>
      </section>

      <section className="table-surface sessions-table-surface" aria-labelledby="saved-sessions-heading">
        <div className="table-surface-head">
          <h2 id="saved-sessions-heading">Saved sessions</h2>
          <span className="table-surface-count">{filtered.length} session{filtered.length === 1 ? "" : "s"}</span>
        </div>

        <div className="table-search sessions-search">
          <Search size={15} />
          <input
            value={search}
            placeholder="Search by name, URL, or status…"
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
          {search ? (
            <button type="button" title="Clear search" onClick={() => { setSearch(""); setPage(1); }}>
              <X size={14} />
            </button>
          ) : null}
        </div>

        {profiles.length === 0 ? (
          <TableEmptyState
            filtered={false}
            title="No saved sessions yet."
            hint="Capture a session above to start. Your login will be saved for reuse in automation runs."
          />
        ) : filtered.length === 0 ? (
          <TableEmptyState filtered title="No matching sessions found." hint="Adjust your search." />
        ) : (
          <>
            <div className="wl-table-wrapper">
                <table className="wl-table sessions-table">
                  <colgroup>
                    <col className="sessions-col-status" />
                    <col className="sessions-col-name" />
                    <col className="sessions-col-target" />
                    <col className="sessions-col-source" />
                    <col className="sessions-col-created" />
                    <col className="sessions-col-last-used" />
                    <col className="sessions-col-browser" />
                    <col className="sessions-col-actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Name</th>
                    <th>Target URL</th>
                    <th>Source</th>
                    <th>Created</th>
                    <th>Last Used</th>
                    <th>Browser</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((profile) => (
                    <tr key={profile.id}>
                      <td className="sessions-status-cell">
                        <span
                          className={`state-pill sessions-status-pill tone-${statusTone(profile.status)}`}
                          title={statusLabel(profile.status)}
                        >
                          {statusLabel(profile.status)}
                        </span>
                      </td>
                      <td className="sessions-name-cell" title={profile.name}>
                        {renamingId === profile.id ? (
                          <input
                            autoFocus
                            className="sessions-rename-input"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => handleRenameSubmit(profile.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleRenameSubmit(profile.id);
                              if (e.key === "Escape") setRenamingId(null);
                            }}
                          />
                        ) : (
                          <strong className="sessions-name-value">{profile.name}</strong>
                        )}
                      </td>
                      <td className="sessions-target-cell">
                        <span className="sessions-target-value">
                          <span className="sessions-target-url" title={profile.targetUrl || undefined}>
                            {profile.targetUrl || "—"}
                          </span>
                          {profile.origin && profile.origin !== profile.targetUrl ? (
                            <span className="sessions-target-origin" title={`origin: ${profile.origin}`}>origin: {profile.origin}</span>
                          ) : null}
                        </span>
                      </td>
                      <td className="sessions-source-cell">
                        <span className="sessions-source-value">
                          {profile.source === "autoSecureLogin" ? "Auto login" : profile.source === "imported" ? "Imported" : "Manual"}
                        </span>
                      </td>
                      <td className="sessions-date-cell" title={new Date(profile.createdAt).toLocaleString()}>
                        <span className="sessions-date-value">
                          <Clock size={12} />
                          {new Date(profile.createdAt).toLocaleDateString()}
                        </span>
                      </td>
                      <td className="sessions-date-cell">
                        <span className="sessions-date-value">
                          {profile.lastUsedAt
                            ? new Date(profile.lastUsedAt).toLocaleDateString()
                            : "Never"}
                        </span>
                      </td>
                      <td className="sessions-browser-cell">
                        <span className="sessions-browser-value">
                          {profile.browserPath?.includes("msedge") ? "Edge" : profile.browserPath?.includes("chrome") ? "Chrome" : "—"}
                        </span>
                      </td>
                      <td className="sessions-actions-cell">
                        <div className="table-actions sessions-actions">
                          <button
                            type="button"
                            title="Rename"
                            onClick={() => handleRenameStart(profile)}
                            disabled={profile.status === "capturing"}
                          >
                            <Edit3 size={14} />
                          </button>
                          <button
                            type="button"
                            title="Open profile folder"
                            onClick={() => handleOpenFolder(profile)}
                          >
                            <FolderOpen size={14} />
                          </button>
                          <button
                            type="button"
                            title="Delete session"
                            onClick={() => handleDelete(profile.id)}
                            disabled={profile.status === "capturing"}
                            className="sessions-delete-action"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <DataTablePagination
              page={pageClamped}
              totalPages={totalPages}
              total={filtered.length}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={(s) => { setPageSize(s); setPage(1); }}
            />
          </>
        )}
      </section>

      {/* ── Capture completion toast ─ */}
      {captureStatus.status === "closed" && !captureStatus.active && (
        <section className="operations-system-banner sessions-capture-complete tone-success">
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>
            Session captured successfully! You can now select it when running a workflow.
          </span>
        </section>
      )}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </section>
  );
}
