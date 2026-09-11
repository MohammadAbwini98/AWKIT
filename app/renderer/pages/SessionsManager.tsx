import { useState, useEffect, useMemo, useCallback, type CSSProperties } from "react";
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

  usePageChrome({ actions: [], dirty: false }, []);

  // ─── Render ─────────────────────────────────────────────────────────
  // Status pills use the shared status-token trio (-soft fill, base ink, -muted border) so
  // they track the theme. Never concatenate alpha onto a var() string — `var(--x)1a` is
  // invalid CSS and the declaration is silently dropped.
  const statusTone = (s: SessionProfile["status"]) =>
    s === "ready" ? "success" : s === "capturing" ? "warning" : "danger";

  const statusPillStyle = (s: SessionProfile["status"]): CSSProperties => {
    const tone = statusTone(s);
    return {
      background: `var(--awkit-${tone}-soft)`,
      color: `var(--awkit-${tone})`,
      border: `1px solid var(--awkit-${tone}-muted)`
    };
  };

  const statusLabel = (s: SessionProfile["status"]) =>
    s === "ready" ? "Ready" : s === "capturing" ? "Capturing…" : "Error";

  return (
    <div className="page-content" style={{ display: "flex", flexDirection: "column", gap: "var(--space-4h)", padding: "var(--space-4h)" }}>

      {/* ── Browser Detection Banner ─────────────────────────────── */}
      <div
        className="form-panel session-browser-banner"
        style={{
          padding: "var(--space-3) var(--space-4h)",
          background: browser?.found ? "var(--awkit-success-soft)" : "var(--awkit-danger-soft)",
          borderRadius: "var(--radius-xs)",
          border: `1px solid ${browser?.found ? "var(--awkit-success-muted)" : "var(--awkit-danger-muted)"}`,
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)"
        }}
      >
        <Chrome size={20} color={browser?.found ? "var(--awkit-success)" : "var(--awkit-danger)"} />
        {browser?.found ? (
          <span style={{ fontSize: "var(--text-sm)", color: "var(--awkit-success)" }}>
            <strong>{browser.browser === "chrome" ? "Google Chrome" : "Microsoft Edge"}</strong> detected at{" "}
            <code style={{ fontSize: "var(--text-xs)", background: "var(--awkit-success-soft)", padding: "var(--space-1) var(--space-2)", borderRadius: "var(--radius-2xs)" }}>
              {browser.path}
            </code>
          </span>
        ) : (
          <span style={{ fontSize: "var(--text-sm)", color: "var(--awkit-danger)" }}>
            No Chrome or Edge browser found. Install one to use Session Capture.
          </span>
        )}
      </div>

      {/* ── Capture Session Panel ────────────────────────────────── */}
      <div className="form-panel" style={{ padding: "var(--space-4h)", background: "var(--awkit-surface)", borderRadius: "var(--radius-xs)", border: "1px solid var(--awkit-border)" }}>
        <h3 style={{ margin: "0 0 var(--space-2) 0", fontSize: "var(--text-md)", color: "var(--awkit-text)", display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <KeyRound size={18} />
          Capture Session
        </h3>
        <p style={{ margin: "0 0 var(--space-4) 0", fontSize: "var(--text-sm)", color: "var(--awkit-text-secondary)", lineHeight: "var(--leading-base)" }}>
          Opens your real Chrome or Edge browser (no automation flags) so you can log into protected
          sites like Google, Microsoft, or Cloudflare-gated pages. After you log in and close the
          browser, the session is saved for reuse in automation runs.
        </p>

        {captureStatus.active ? (
          /* ── Active capture state ─ */
          <div className="session-active-capture" style={{
            padding: "var(--space-4) var(--space-4h)",
            background: "var(--awkit-warning-soft)",
            borderRadius: "var(--radius-xs)",
            border: "1px solid var(--awkit-warning-muted)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
              <Loader2 size={18} className="session-spin" color="var(--awkit-warning)" />
              <strong style={{ color: "var(--awkit-warning)", fontSize: "var(--text-base)" }}>
                Browser is open — log in manually
              </strong>
            </div>
            <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--awkit-warning)", lineHeight: "var(--leading-base)" }}>
              Session: <strong>{captureStatus.sessionName}</strong>
              {captureStatus.browserPid ? ` (PID ${captureStatus.browserPid})` : ""}.
              Complete your login, then <strong>close the browser window</strong> when done.
              The session profile will be saved automatically.
            </p>
            <button
              onClick={handleStopCapture}
              style={{
                display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)",
                background: "var(--awkit-danger)", color: "var(--awkit-accent-contrast)", border: "none", borderRadius: "var(--radius-2xs)",
                cursor: "pointer", fontWeight: "var(--weight-medium)", width: "fit-content"
              }}
            >
              <Square size={14} />
              Force Close Browser
            </button>
          </div>
        ) : (
          /* ── Capture form ─ */
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <div style={{ display: "flex", gap: "var(--space-3)" }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                <label style={{ fontSize: "var(--text-2xs)", fontWeight: "var(--weight-semibold)", color: "var(--awkit-text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Session Name
                </label>
                <input
                  type="text"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  placeholder="e.g. Google Work Account"
                  style={{
                    padding: "var(--space-2) var(--space-3)", border: "1px solid var(--awkit-border-strong)", borderRadius: "var(--radius-2xs)",
                    outline: "none", fontSize: "var(--text-sm)", width: "100%", boxSizing: "border-box"
                  }}
                />
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                <label style={{ fontSize: "var(--text-2xs)", fontWeight: "var(--weight-semibold)", color: "var(--awkit-text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Target URL <span style={{ fontWeight: "var(--weight-regular)", textTransform: "none" }}>(optional)</span>
                </label>
                <div style={{ display: "flex", alignItems: "center", border: "1px solid var(--awkit-border-strong)", borderRadius: "var(--radius-2xs)", padding: "0 var(--space-2)" }}>
                  <Globe size={14} color="var(--awkit-text-muted)" />
                  <input
                    type="text"
                    value={targetUrl}
                    onChange={(e) => setTargetUrl(e.target.value)}
                    placeholder="https://accounts.google.com"
                    style={{
                      flex: 1, border: "none", padding: "var(--space-2) var(--space-2)", outline: "none",
                      background: "transparent", fontSize: "var(--text-sm)"
                    }}
                  />
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
              <button
                disabled={isStarting || !browser?.found || !sessionName.trim()}
                onClick={handleStartCapture}
                style={{
                  display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-2) var(--space-4h)",
                  background: (isStarting || !browser?.found || !sessionName.trim()) ? "var(--awkit-border-strong)" : "var(--awkit-accent)",
                  color: (isStarting || !browser?.found || !sessionName.trim()) ? "var(--awkit-text-muted)" : "var(--awkit-accent-contrast)",
                  border: "none", borderRadius: "var(--radius-2xs)",
                  cursor: (isStarting || !browser?.found || !sessionName.trim()) ? "not-allowed" : "pointer",
                  fontWeight: "var(--weight-semibold)", fontSize: "var(--text-sm)"
                }}
              >
                <Play size={15} />
                {isStarting ? "Launching…" : "Open Browser & Capture Session"}
              </button>
              <button
                onClick={refresh}
                title="Refresh"
                style={{
                  display: "flex", alignItems: "center", gap: "var(--space-1)", padding: "var(--space-2) var(--space-3)",
                  background: "transparent", color: "var(--awkit-text-secondary)",
                  border: "1px solid var(--awkit-border-strong)", borderRadius: "var(--radius-2xs)", cursor: "pointer"
                }}
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Info Banner ─────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "flex-start", gap: "var(--space-3)", padding: "var(--space-3) var(--space-4)",
        background: "var(--awkit-accent-soft)", borderRadius: "var(--radius-xs)", border: "1px solid var(--awkit-accent-muted)"
      }}>
        <Info size={16} color="var(--awkit-accent)" style={{ marginTop: 2, flexShrink: 0 }} />
        <div style={{ fontSize: "var(--text-xs)", color: "var(--awkit-accent)", lineHeight: "var(--leading-base)" }}>
          <strong>How it works:</strong> This opens your real Chrome/Edge browser — not the
          automation Chromium — so login pages like Google won't block you. After you log in
          and close the browser, select the saved session when running a workflow. The
          automation browser will reuse your login state.
        </div>
      </div>

      {/* ── Saved Sessions Table ─────────────────────────────────── */}
      <div className="form-panel" style={{ padding: "var(--space-4h)", background: "var(--awkit-surface)", borderRadius: "var(--radius-xs)", border: "1px solid var(--awkit-border)" }}>
        <h3 style={{ margin: "0 0 var(--space-4) 0", fontSize: "var(--text-md)", color: "var(--awkit-text)", display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <KeyRound size={18} />
          Saved Sessions ({filtered.length})
        </h3>

        <div className="table-search" style={{ maxWidth: 460, marginBottom: "var(--space-3)" }}>
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
                  <col style={{ width: "6%" }} />
                  <col style={{ width: "18%" }} />
                  <col style={{ width: "24%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "10%" }} />
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
                      <td>
                        <span
                          className="state-pill"
                          style={statusPillStyle(profile.status)}
                        >
                          {statusLabel(profile.status)}
                        </span>
                      </td>
                      <td>
                        {renamingId === profile.id ? (
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => handleRenameSubmit(profile.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleRenameSubmit(profile.id);
                              if (e.key === "Escape") setRenamingId(null);
                            }}
                            style={{
                              padding: "var(--space-1) var(--space-2)", border: "1px solid var(--awkit-accent)", borderRadius: "var(--radius-2xs)",
                              outline: "none", fontSize: "var(--text-sm)", width: "100%", boxSizing: "border-box"
                            }}
                          />
                        ) : (
                          <strong style={{ fontSize: "var(--text-sm)", color: "var(--awkit-text)" }}>{profile.name}</strong>
                        )}
                      </td>
                      <td title={profile.targetUrl}>
                        <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                          <span style={{ fontSize: "var(--text-xs)", color: "var(--awkit-text-secondary)", fontFamily: "var(--font-mono)" }}>
                            {profile.targetUrl || "—"}
                          </span>
                          {profile.origin && profile.origin !== profile.targetUrl ? (
                            <span style={{ fontSize: "var(--text-2xs)", color: "var(--awkit-text-muted)" }}>origin: {profile.origin}</span>
                          ) : null}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: "var(--text-2xs)", color: "var(--awkit-text-secondary)" }}>
                          {profile.source === "autoSecureLogin" ? "Auto login" : profile.source === "imported" ? "Imported" : "Manual"}
                        </span>
                      </td>
                      <td title={new Date(profile.createdAt).toLocaleString()}>
                        <span style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", fontSize: "var(--text-xs)", color: "var(--awkit-text-secondary)" }}>
                          <Clock size={12} />
                          {new Date(profile.createdAt).toLocaleDateString()}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: "var(--text-xs)", color: "var(--awkit-text-secondary)" }}>
                          {profile.lastUsedAt
                            ? new Date(profile.lastUsedAt).toLocaleDateString()
                            : "Never"}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: "var(--text-xs)", color: "var(--awkit-text-secondary)" }}>
                          {profile.browserPath?.includes("msedge") ? "Edge" : profile.browserPath?.includes("chrome") ? "Chrome" : "—"}
                        </span>
                      </td>
                      <td>
                        <div className="table-actions" style={{ display: "flex", gap: "var(--space-1)" }}>
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
                            style={{ color: profile.status === "capturing" ? "var(--awkit-border-strong)" : "var(--awkit-danger)" }}
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
      </div>

      {/* ── Capture completion toast ─ */}
      {captureStatus.status === "closed" && !captureStatus.active && (
        <div
          style={{
            display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-3) var(--space-4h)",
            background: "var(--awkit-success-soft)", borderRadius: "var(--radius-xs)", border: "1px solid var(--awkit-success-muted)"
          }}
        >
          <CheckCircle2 size={18} color="var(--awkit-success)" />
          <span style={{ fontSize: "var(--text-sm)", color: "var(--awkit-success)" }}>
            Session captured successfully! You can now select it when running a workflow.
          </span>
        </div>
      )}

      {/* spinner animation */}
      <style>{`
        @keyframes session-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .session-spin { animation: session-spin 1.2s linear infinite; }
      `}</style>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
