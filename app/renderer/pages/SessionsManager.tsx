import { useState, useEffect, useMemo, useCallback } from "react";
import {
  CheckCircle2,
  Chrome,
  Clock,
  Edit3,
  FolderOpen,
  GitBranch,
  Globe,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  XCircle
} from "lucide-react";
import { usePageChrome } from "../state/pageChrome";
import { Toast, type ToastState } from "../components/shared/Toast";
import type { SessionProfile, SessionCaptureStatus, DetectedBrowser } from "@src/session/SessionProfile";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import {
  SysBanner,
  SysButton,
  SysCheckRow,
  SysChecklist,
  SysField,
  SysIconButton,
  SysList,
  SysListRow,
  SysModal,
  SysModalFields,
  SysPage,
  SysPanel,
  SysPanelEmpty,
  SysPanels,
  type SysTone
} from "../components/system/SystemUI";

const STATUS: Record<SessionProfile["status"], { label: string; tone: SysTone }> = {
  ready: { label: "Ready", tone: "success" },
  capturing: { label: "Capturing…", tone: "warning" },
  error: { label: "Error", tone: "danger" }
};

function sourceLabel(source: SessionProfile["source"]): string {
  return source === "autoSecureLogin" ? "Auto login" : source === "imported" ? "Imported" : "Manual";
}

function browserLabel(path?: string): string | null {
  if (path?.includes("msedge")) return "Edge";
  if (path?.includes("chrome")) return "Chrome";
  return null;
}

function shortDate(iso?: string): string {
  if (!iso) return "Never";
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "—" : at.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

interface Binding {
  flowName: string;
  stepName: string;
  sessionId?: string;
  mode: "autoDetect" | "selected";
}

export function SessionsManager() {
  // ─── State ──────────────────────────────────────────────────────────
  const [profiles, setProfiles] = useState<SessionProfile[]>([]);
  const [captureStatus, setCaptureStatus] = useState<SessionCaptureStatus>({ active: false, status: "idle" });
  const [browser, setBrowser] = useState<DetectedBrowser | null>(null);
  const [flows, setFlows] = useState<FlowProfile[]>([]);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [sessionName, setSessionName] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<SessionProfile | null>(null);

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
    // Reuse Session bindings come from the saved flows; a role without the Flows read sees none.
    window.playwrightFlowStudio.flows
      .list()
      .then(setFlows)
      .catch(() => setFlows([]));
  }, []);

  useEffect(() => {
    void refresh();
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

  // ─── Filtered profiles ──────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...profiles].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    if (!q) return sorted;
    return sorted.filter((p) => `${p.name} ${p.targetUrl ?? ""} ${p.origin ?? ""} ${p.source ?? ""} ${p.status} ${p.id}`.toLowerCase().includes(q));
  }, [profiles, search]);

  const bindings = useMemo<Binding[]>(
    () =>
      flows.flatMap((flow) =>
        (flow.nodes ?? [])
          .filter((step) => step.type === "reuseSession")
          .map((step) => ({
            flowName: flow.name,
            stepName: step.name,
            sessionId: step.config?.reuseSessionId,
            mode: step.config?.reuseSessionMode === "selected" ? "selected" : "autoDetect"
          }))
      ),
    [flows]
  );

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
      setCaptureOpen(false);
      setSessionName("");
      setTargetUrl("");
      setToast({ tone: "success", message: "Browser launched. Log in manually, then close the browser when done." });
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

  const openCapture = () => {
    if (!captureStatus.active) setCaptureOpen(true);
  };

  usePageChrome(
    {
      actions: [
        {
          id: "capture-session",
          label: "Capture session",
          icon: <Plus size={15} aria-hidden="true" />,
          variant: "primary",
          disabled: captureStatus.active || !browser?.found,
          onClick: openCapture,
          title: captureStatus.active
            ? "A session capture is already active"
            : browser?.found
              ? "Open your real Chrome or Edge in an app-owned profile and capture the login"
              : "Install Chrome or Edge to capture sessions"
        }
      ],
      dirty: false
    },
    [captureStatus.active, browser?.found]
  );

  const sessionNameById = (id?: string) => profiles.find((profile) => profile.id === id)?.name;

  return (
    <SysPage className="sessions-page">
      <h1 className="sr-only">Sessions</h1>

      {browser?.found ? (
        <SysBanner tone="success" icon={Chrome}>
          <strong>{browser.browser === "chrome" ? "Google Chrome" : "Microsoft Edge"}</strong> detected at <code>{browser.path}</code>
        </SysBanner>
      ) : browser ? (
        <SysBanner tone="danger" icon={Chrome}>
          No Chrome or Edge browser found. Install one to use Session Capture.
        </SysBanner>
      ) : null}

      <SysBanner tone="info" icon={KeyRound}>
        Session capture opens your real Chrome or Edge — not the automation Chromium — in an app-owned profile, so sign-in pages
        will not block you. Log in, close the browser, then reuse the saved login state through the Reuse Session node in any flow.
      </SysBanner>

      {captureStatus.active ? (
        <SysBanner tone="warning" icon={Loader2} actionLabel="Force close browser" onAction={() => void handleStopCapture()}>
          Browser is open — log in manually. Session <strong>{captureStatus.sessionName}</strong>
          {captureStatus.browserPid ? ` (PID ${captureStatus.browserPid})` : ""}: complete your login, then close the browser window.
          The session profile is saved automatically.
        </SysBanner>
      ) : captureStatus.status === "closed" ? (
        <SysBanner tone="success" icon={CheckCircle2}>
          Session captured successfully! You can now select it when running a workflow.
        </SysBanner>
      ) : null}

      <SysPanels min={640}>
        <SysPanel
          wide
          icon={KeyRound}
          title="Saved sessions"
          meta={`${profiles.length} session${profiles.length === 1 ? "" : "s"} · stored in app-owned scoped profiles`}
          className="sessions-panel"
          actions={
            <>
              {profiles.length > 0 ? (
                <span className="sys-search sessions-search">
                  <Search size={14} strokeWidth={1.9} aria-hidden="true" />
                  <input
                    value={search}
                    aria-label="Search sessions"
                    placeholder="Search by name, URL, or status…"
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </span>
              ) : null}
              <SysButton kind="smallPrimary" icon={Plus} disabled={captureStatus.active || !browser?.found} onClick={openCapture}>
                Capture
              </SysButton>
              <SysButton kind="small" icon={RefreshCw} onClick={() => void refresh()} title="Reload saved sessions and browser detection">
                Refresh
              </SysButton>
            </>
          }
        >
          {profiles.length === 0 ? (
            <SysPanelEmpty icon={KeyRound} title="No saved sessions yet" hint="Capture a session to start. Your login will be saved for reuse in automation runs." />
          ) : filtered.length === 0 ? (
            <SysPanelEmpty icon={Search} title="No matching sessions found" hint="Adjust your search." />
          ) : (
            <div className="sessions-list">
              <SysList label="Saved sessions">
                {filtered.map((profile) => {
                  const status = STATUS[profile.status] ?? STATUS.error;
                  const browserName = browserLabel(profile.browserPath);
                  const target = profile.targetUrl || profile.origin || "";
                  const meta = [
                    sourceLabel(profile.source),
                    `captured ${shortDate(profile.createdAt)}`,
                    `last used ${shortDate(profile.lastUsedAt)}`,
                    browserName
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <SysListRow
                      key={profile.id}
                      className="sessions-row"
                      icon={profile.status === "error" ? XCircle : profile.status === "capturing" ? Clock : Globe}
                      tone={status.tone === "success" ? "running" : status.tone}
                      titleAttr={profile.name}
                      title={
                        renamingId === profile.id ? (
                          <input
                            autoFocus
                            className="sys-control sessions-rename-input"
                            aria-label={`Rename ${profile.name}`}
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => void handleRenameSubmit(profile.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void handleRenameSubmit(profile.id);
                              if (e.key === "Escape") setRenamingId(null);
                            }}
                          />
                        ) : (
                          profile.name
                        )
                      }
                      badge={status.label}
                      badgeTone={status.tone}
                      actions={
                        <>
                          <SysIconButton icon={Edit3} label={`Rename ${profile.name}`} title="Rename" disabled={profile.status === "capturing"} onClick={() => handleRenameStart(profile)} />
                          <SysIconButton icon={FolderOpen} label={`Open profile folder for ${profile.name}`} title="Open profile folder" onClick={() => void handleOpenFolder(profile)} />
                          <SysIconButton icon={Trash2} tone="danger" label={`Delete ${profile.name}`} title="Delete session" disabled={profile.status === "capturing"} onClick={() => setDeleting(profile)} />
                        </>
                      }
                    >
                      <span className="sessions-row-sub">
                        {target ? (
                          <span className="sessions-target-url" title={profile.targetUrl || undefined}>
                            {target}
                          </span>
                        ) : (
                          <span className="sessions-target-url">No target URL</span>
                        )}
                        {profile.origin && profile.origin !== profile.targetUrl ? (
                          <span className="sessions-target-origin" title={`origin: ${profile.origin}`}>
                            origin: {profile.origin}
                          </span>
                        ) : null}
                        <span className="sessions-row-meta">{meta}</span>
                      </span>
                    </SysListRow>
                  );
                })}
              </SysList>
            </div>
          )}
        </SysPanel>
      </SysPanels>

      <SysPanels>
        <SysPanel icon={GitBranch} title="Reuse Session bindings" meta="Which flows consume which session">
          {bindings.length === 0 ? (
            <SysPanelEmpty icon={GitBranch} title="No Reuse Session nodes yet" hint="Add a Reuse Session node to a flow to load a captured session before the flow runs." />
          ) : (
            <SysList label="Reuse Session bindings">
              {bindings.map((binding, index) => {
                const bound = binding.mode === "selected" ? sessionNameById(binding.sessionId) : undefined;
                const missing = binding.mode === "selected" && !bound;
                return (
                  <SysListRow
                    key={`${binding.flowName}-${binding.stepName}-${index}`}
                    icon={missing ? ShieldAlert : GitBranch}
                    tone={missing ? "warning" : "running"}
                    title={`${binding.flowName} · ${binding.stepName}`}
                    sub={
                      binding.mode === "selected"
                        ? missing
                          ? "The selected session no longer exists — the run will pause for handoff"
                          : `Reuse Session node → ${bound}`
                        : "Reuse Session node → auto-detected by target origin"
                    }
                    badge={missing ? "Will pause" : binding.mode === "selected" ? "Bound" : "Auto-detect"}
                    badgeTone={missing ? "warning" : binding.mode === "selected" ? "success" : "info"}
                  />
                );
              })}
            </SysList>
          )}
        </SysPanel>

        <SysPanel icon={ShieldAlert} tone="warning" title="Capture contract" meta="Product behaviour, not a preference">
          <SysChecklist label="Capture contract">
            <SysCheckRow tone="success" title="The app never automates a login page" sub="MFA, OTP, CAPTCHA, passkey and approval surfaces are completed by you" badge="Enforced" />
            <SysCheckRow tone="success" title="The run pauses and preserves the draft" sub="The automation browser closes; nothing is lost" badge="Enforced" />
            <SysCheckRow tone="success" title="Handoff uses your real Chrome" sub="In an app-owned scoped session profile, never your default profile" badge="Enforced" />
          </SysChecklist>
        </SysPanel>
      </SysPanels>

      {captureOpen ? (
        <SysModal
          icon={KeyRound}
          title="Capture session"
          message="Opens your real Chrome or Edge in an app-owned profile. Sign in manually, then close the browser to save the reusable session."
          width={480}
          closeDisabled={isStarting}
          onClose={() => setCaptureOpen(false)}
          onSubmit={() => void handleStartCapture()}
          actions={
            <>
              <SysButton kind="secondary" onClick={() => setCaptureOpen(false)} disabled={isStarting}>Cancel</SysButton>
              <SysButton kind="primary" type="submit" icon={Globe} disabled={isStarting || !browser?.found || !sessionName.trim()}>
                {isStarting ? "Launching…" : "Open browser & capture"}
              </SysButton>
            </>
          }
        >
          <SysModalFields>
            <SysField label="Session name" wide>
              <input className="sys-control" autoFocus value={sessionName} onChange={(e) => setSessionName(e.target.value)} placeholder="e.g. Google Work Account" />
            </SysField>
            <SysField label="Target URL" wide hint="Optional — the page the browser opens first">
              <input className="sys-control is-mono" value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} placeholder="https://accounts.google.com" />
            </SysField>
          </SysModalFields>
        </SysModal>
      ) : null}

      {deleting ? (
        <SysModal
          role="alertdialog"
          tone="danger"
          icon={Trash2}
          width={420}
          title={`Delete “${deleting.name}”?`}
          message="The saved login state and its profile folder are removed. Flows bound to this session will pause for handoff."
          onClose={() => setDeleting(null)}
          actions={
            <>
              <SysButton kind="secondary" onClick={() => setDeleting(null)}>Cancel</SysButton>
              <SysButton
                kind="danger"
                onClick={() => {
                  const id = deleting.id;
                  setDeleting(null);
                  void handleDelete(id);
                }}
              >
                Delete session
              </SysButton>
            </>
          }
        />
      ) : null}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </SysPage>
  );
}
