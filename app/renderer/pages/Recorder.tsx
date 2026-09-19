import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Bookmark,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Copy,
  CornerDownLeft,
  ExternalLink,
  Eye,
  Fingerprint,
  Globe,
  KeyRound,
  Link,
  Link2,
  ListChecks,
  Play,
  PlayCircle,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  StopCircle,
  Trash2,
  Video,
  XCircle
} from "lucide-react";
import { usePageChrome } from "../state/pageChrome";
import { Toast, type ToastState } from "../components/shared/Toast";
import {
  SysBadge,
  SysBanner,
  SysBars,
  SysButton,
  SysCellActions,
  SysCheckRow,
  SysChecklist,
  SysField,
  SysIconButton,
  SysList,
  SysListRow,
  SysMetric,
  SysMetrics,
  SysPage,
  SysPagination,
  SysPanel,
  SysPanelEmpty,
  SysPanels,
  SysSwitch,
  SysTableCard,
  SysTableEmpty,
  SysTimeline,
  SysTimelineRow,
  type SysTone
} from "../components/system/SystemUI";
import {
  isLocatorRecordingMode,
  LOCATOR_RECORDING_MODES,
  type RecordedAction,
  type RecordedUrl,
  type RecorderHandoffInfo,
  type AmbiguityState,
  type AmbiguityResolutionChoice,
  type LocatorRecordingMode
} from "@src/recorder/RecorderTypes";
import { reviewStepAsync, summarizeReviews, classLabel } from "@src/profiles/asyncCompletionReview";
import { locatorContainerChain, type StepLocator } from "@src/profiles/FlowProfile";
import { classifyLocatorQuality, LOCATOR_QUALITY_CLASS_LABEL, type LocatorQualityClass } from "@src/recorder/LocatorQualityClass";
import { ConfirmDialog } from "../components/shared/ConfirmDialog";
import { RECORDED_URL_SENSITIVE_QUERY_KEYS } from "@src/recorder/recordedUrlPolicy";

export function Recorder() {
  const [url, setUrl] = useState("https://example.com");
  const [isRecording, setIsRecording] = useState(false);
  const [captureWaitTime, setCaptureWaitTime] = useState(false);
  const [captureSmartWaits, setCaptureSmartWaits] = useState(true);
  const [locatorRecordingMode, setLocatorRecordingMode] = useState<LocatorRecordingMode>("default");
  const [locatorModeBusy, setLocatorModeBusy] = useState(false);
  const [instrumentationError, setInstrumentationError] = useState("");
  /** True while the live Recorder session is running with HTTPS certificate validation disabled. */
  const [ignoreHttpsErrors, setIgnoreHttpsErrors] = useState(false);
  const [actions, setActions] = useState<RecordedAction[]>([]);
  const [flowName, setFlowName] = useState("New Recorded Flow");
  const [statusMsg, setStatusMsg] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [startOverwriteConfirmOpen, setStartOverwriteConfirmOpen] = useState(false);
  // AWKIT-REC-037 refinement (caught by verify:recorder-gui): the overwrite confirm must arm ONLY
  // for a draft RESTORED from disk at mount — not for the leftover actions of a session this page
  // itself just stopped/cancelled/saved, which starting over is allowed to clear silently.
  const [pendingRestoredDraft, setPendingRestoredDraft] = useState(false);
  const [saveResult, setSaveResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [actionMutationBusy, setActionMutationBusy] = useState(false);
  const [actionMutationConfirm, setActionMutationConfirm] = useState<
    { kind: "clear" } | { kind: "delete"; action: RecordedAction } | null
  >(null);

  const [handoff, setHandoff] = useState<RecorderHandoffInfo | null>(null);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [ambiguity, setAmbiguity] = useState<AmbiguityState | null>(null);
  const [ambiguityBusy, setAmbiguityBusy] = useState(false);
  const [fallbackApprovalReason, setFallbackApprovalReason] = useState("");
  const [sessionNameInput, setSessionNameInput] = useState("");
  /** True while protected-login detection is being ignored (global setting or session override). */
  const [protectedDetectionIgnored, setProtectedDetectionIgnored] = useState(false);

  const [urls, setUrls] = useState<RecordedUrl[]>([]);
  const [favoriteUrls, setFavoriteUrls] = useState<RecordedUrl[]>([]);
  const [urlTab, setUrlTab] = useState<"recorded" | "favorites">("recorded");
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const favoriteMutation = useRef(false);
  const [urlSearch, setUrlSearch] = useState("");
  const [urlPage, setUrlPage] = useState(1);
  const [urlPageSize, setUrlPageSize] = useState(10);
  const actionsListRef = useRef<HTMLDivElement | null>(null);
  const reviewDialogRef = useRef<HTMLDivElement | null>(null);
  const reviewReturnFocusRef = useRef<HTMLElement | null>(null);
  const ambiguityDialogRef = useRef<HTMLElement | null>(null);
  const ambiguityReturnFocusRef = useRef<HTMLElement | null>(null);
  // Session clock for the Elapsed metric: starts when capture goes live, freezes when it ends.
  const [clock, setClock] = useState<{ start: number | null; stop: number | null; now: number }>(() => ({ start: null, stop: null, now: Date.now() }));

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

  // AWKIT-REC-037: fetch the preserved draft (and any active handoff) ON MOUNT. The service
  // restores a pre-crash draft to memory on first access; the page used to fetch only while
  // `isRecording`, so the restored actions were invisible after a restart and Save stayed
  // disabled — the AWKIT-REC-001 guarantee died at the UI layer.
  useEffect(() => {
    window.playwrightFlowStudio.recorder.getActions()
      .then((restored) => {
        setActions(restored);
        setPendingRestoredDraft(restored.length > 0);
      })
      .catch(() => undefined);
    window.playwrightFlowStudio.recorder.getHandoff().then(setHandoff).catch(() => undefined);
    window.playwrightFlowStudio.recorder.getUrls().then(setUrls).catch(() => undefined);
    const favoritesApi = window.playwrightFlowStudio.recorder as typeof window.playwrightFlowStudio.recorder & {
      getFavoriteUrls: () => Promise<RecordedUrl[]>;
    };
    favoritesApi.getFavoriteUrls().then(setFavoriteUrls).catch(() => undefined);
  }, []);

  useEffect(() => {
    const list = actionsListRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }, [actions.length]);

  /**
   * Keyboard semantics for the async review dialog. It declares `aria-modal="true"`, which tells
   * assistive tech that everything behind it is inert — so focus must move in, stay in, and return
   * to the opener. Without this a keyboard user is stranded: Tab walks into content their screen
   * reader has been told does not exist. `ConfirmDialog` and `RunDetailDrawer` already implement
   * exactly this contract; this dialog has its own markup and so never inherited it.
   */
  useEffect(() => {
    if (!reviewOpen) return;
    reviewReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () =>
      [...(reviewDialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? [])].filter((element) => !element.hasAttribute("hidden"));
    (focusable()[0] ?? reviewDialogRef.current)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Escape dismisses the way "Keep editing" does. It must never commit the save — the whole
        // point of this dialog is that saving is a deliberate act.
        e.preventDefault();
        setReviewOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusable();
      if (list.length === 0) {
        e.preventDefault();
        reviewDialogRef.current?.focus();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      // Focus can be outside the dialog entirely — it is conditionally rendered, and the confirm
      // button becomes disabled mid-save, which drops focus to the body. Pull it back rather than
      // letting the first Tab escape.
      if (!reviewDialogRef.current?.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
        return;
      }
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (reviewReturnFocusRef.current?.isConnected) reviewReturnFocusRef.current.focus();
    };
  }, [reviewOpen]);

  useEffect(() => {
    if (!ambiguity) return;
    ambiguityReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setFallbackApprovalReason("");
    const focusable = () =>
      [...(ambiguityDialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? [])].filter((element) => !element.hasAttribute("hidden"));
    (focusable()[0] ?? ambiguityDialogRef.current)?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void handleAmbiguityResolution("defer");
        return;
      }
      if (event.key !== "Tab") return;
      const list = focusable();
      if (list.length === 0) {
        event.preventDefault();
        ambiguityDialogRef.current?.focus();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      if (!ambiguityDialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (ambiguityReturnFocusRef.current?.isConnected) ambiguityReturnFocusRef.current.focus();
    };
  }, [ambiguity]);

  useEffect(() => {
    const poll = () => {
      window.playwrightFlowStudio.recorder.getHandoff()
        .then(setHandoff)
        .catch(() => undefined);
      window.playwrightFlowStudio.recorder.getAmbiguityState()
        .then(setAmbiguity)
        .catch(() => undefined);
      window.playwrightFlowStudio.recorder.getStatus()
        .then((status) => {
          setIsRecording(status.isRecording);
          setProtectedDetectionIgnored(status.protectedDetectionIgnored ?? false);
          // Reflects the LIVE session's effective value (read from Settings at launch), not the
          // current Settings value — a mid-session Settings change must not change the indicator.
          setIgnoreHttpsErrors(status.ignoreHttpsErrors ?? false);
          setInstrumentationError(status.instrumentationError ?? "");
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
        const mode = settings.recorder?.locatorRecordingMode;
        setLocatorRecordingMode(isLocatorRecordingMode(mode) ? mode : "default");
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

  const changeLocatorRecordingMode = async (next: LocatorRecordingMode) => {
    if (next === locatorRecordingMode || locatorModeBusy) return;
    const previous = locatorRecordingMode;
    setLocatorModeBusy(true);
    try {
      await window.playwrightFlowStudio.settings.update({ recorder: { locatorRecordingMode: next } });
      await window.playwrightFlowStudio.recorder.setLocatorRecordingMode(next);
      setLocatorRecordingMode(next);
      setStatusMsg(
        `${next === "xpath" ? "XPath" : "Default"} locator recording selected. Existing actions were not changed.`
      );
    } catch {
      await window.playwrightFlowStudio.settings.update({ recorder: { locatorRecordingMode: previous } }).catch(() => undefined);
      await window.playwrightFlowStudio.recorder.setLocatorRecordingMode(previous).catch(() => undefined);
      setToast({ tone: "error", message: "Could not change the locator recording mode." });
    } finally {
      setLocatorModeBusy(false);
    }
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

  // Compare against canonical, redacted URLs returned by the existing store. This lookup
  // changes no stored data and never exposes a redacted query value.
  const favoriteForUrl = (value: string) => favoriteUrls.find((favorite) => {
    try {
      const raw = value.trim();
      const normalized = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) || /^(about:|data:|file:)/i.test(raw) ? raw : `https://${raw}`;
      const candidate = new URL(normalized);
      const stored = new URL(favorite.url);
      for (const [key, saved] of stored.searchParams) {
        if (saved === "***" && RECORDED_URL_SENSITIVE_QUERY_KEYS.has(key.toLowerCase()) && candidate.searchParams.has(key)) candidate.searchParams.set(key, "***");
      }
      return candidate.href === stored.href;
    } catch {
      return favorite.url === value.trim();
    }
  });
  const currentFavorite = favoriteForUrl(url);
  const toggleFavorite = async (value: string) => {
    if (!value.trim() || favoriteMutation.current) return;
    favoriteMutation.current = true;
    setFavoriteBusy(true);
    const favorite = favoriteForUrl(value);
    try {
      const api = window.playwrightFlowStudio.recorder;
      setFavoriteUrls(await (favorite ? api.removeFavoriteUrl(favorite.id) : api.saveFavoriteUrl(value)));
      setStatusMsg(favorite ? "URL removed from Favorites." : "URL added to Favorites.");
    } catch {
      setStatusMsg("Could not update Favorites.");
    } finally {
      favoriteMutation.current = false;
      setFavoriteBusy(false);
    }
  };

  const visibleUrls = urlTab === "favorites" ? favoriteUrls : urls;
  const filteredUrls = useMemo(() => {
    const query = urlSearch.trim().toLowerCase();
    const sorted = [...visibleUrls].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    if (!query) return sorted;
    return sorted.filter((record) =>
      `${record.url} ${record.title ?? ""} ${record.source} ${record.sessionId ?? ""}`.toLowerCase().includes(query)
    );
  }, [visibleUrls, urlSearch]);

  const urlTotalPages = Math.max(1, Math.ceil(filteredUrls.length / urlPageSize));
  const urlPageClamped = Math.min(urlPage, urlTotalPages);
  const pagedUrls = filteredUrls.slice((urlPageClamped - 1) * urlPageSize, urlPageClamped * urlPageSize);

  const copyUrl = (value: string) => {
    navigator.clipboard?.writeText(value).catch(() => undefined);
  };

  const applyActionMutation = async () => {
    const request = actionMutationConfirm;
    if (!request || actionMutationBusy) return;
    setActionMutationBusy(true);
    try {
      if (request.kind === "clear") {
        const updated = await window.playwrightFlowStudio.recorder.clearActions();
        setActions(updated);
        setStatusMsg("All recorded actions cleared. URL history was preserved.");
      } else {
        const result = await window.playwrightFlowStudio.recorder.deleteAction(request.action.id);
        setActions(result.actions);
        const dependentCount = Math.max(0, result.removedIds.length - 1);
        setStatusMsg(
          dependentCount > 0
            ? `Action deleted with ${dependentCount} dependent recorder action${dependentCount === 1 ? "" : "s"}.`
            : "Recorded action deleted."
        );
      }
      setActionMutationConfirm(null);
    } catch (error: any) {
      setStatusMsg(`Could not update recorded actions: ${error?.message ?? error}`);
    } finally {
      setActionMutationBusy(false);
    }
  };

  const handleStart = async () => {
    // AWKIT-REC-037: a preserved draft must be confirmed away, not silently destroyed. Starting
    // clears service memory and overwrites the draft file — if displayed actions came from a
    // restored draft (not a live recording), ask first.
    if (!isRecording && pendingRestoredDraft && !handoffActive) {
      setStartOverwriteConfirmOpen(true);
      return;
    }
    await doStart();
  };

  const doStart = async () => {
    try {
      setStatusMsg("Starting browser...");
      await window.playwrightFlowStudio.recorder.start(url, { captureWaitTime, captureSmartWaits });
      setPendingRestoredDraft(false);
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
      // AWKIT-REC-037: the service deliberately PRESERVES the pre-login draft on cancel
      // (AWKIT-REC-001); blanking the local list hid work the user can still save. Refetch it.
      window.playwrightFlowStudio.recorder.getActions().then(setActions).catch(() => undefined);
      setStatusMsg("Secure login handoff cancelled. Your pre-login actions are preserved — review and Save, or Start a new recording.");
    } catch (err: any) {
      setStatusMsg(`Error: ${err?.message ?? err}`);
    } finally {
      setHandoffBusy(false);
    }
  };

  const handleAmbiguityResolution = async (choice: AmbiguityResolutionChoice, candidateIndex?: number) => {
    if (!ambiguity) return;
    setAmbiguityBusy(true);
    try {
      if (choice !== "cancel") {
        window.playwrightFlowStudio.recorder.clearHighlight().catch(() => undefined);
      }
      const result = await window.playwrightFlowStudio.recorder.resolveAmbiguity(choice, {
        candidateIndex,
        approvalReason: choice === "approveFallback" ? fallbackApprovalReason : undefined
      });
      if (!result.success) throw new Error(result.error ?? "The locator review could not be applied.");
      setAmbiguity(null);
      setIsRecording(true);
      setStatusMsg(
        choice === "cancel"
          ? "Action discarded. Recording resumed."
          : choice === "defer"
            ? "Action kept as Needs review. Recording resumed; execution will stay blocked."
            : "Locator resolution saved. Recording resumed."
      );
      window.playwrightFlowStudio.recorder.getActions().then(setActions).catch(() => undefined);
    } catch (err: any) {
      setStatusMsg(`Resolution failed: ${err?.message ?? err}`);
    } finally {
      setAmbiguityBusy(false);
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

  const handoffActive = !!handoff?.active;
  const showHandoffPanel = !!handoff && handoff.phase !== "resumed";
  // AWKIT-REC-037: saving during an active handoff pause empties the service's in-memory actions
  // mid-pause, so it must be disabled for the whole pause — not only while isRecording.
  const saveDisabled = isRecording || handoffActive || isSaving || actions.length === 0 || !flowName.trim();
  const hasDraft = actions.length > 0;
  const live = isRecording || handoffActive;

  useEffect(() => {
    if (!live) {
      setClock((current) => (current.start !== null && current.stop === null ? { ...current, stop: Date.now() } : current));
      return;
    }
    setClock((current) => (current.start !== null && current.stop === null ? current : { start: Date.now(), stop: null, now: Date.now() }));
    const tick = setInterval(() => setClock((current) => ({ ...current, now: Date.now() })), 1000);
    return () => clearInterval(tick);
  }, [live]);

  // Header actions call through a ref so they always reach the latest handlers without
  // re-publishing the page chrome on every recorded action.
  const latest = useRef({ handleStart, handleStop, requestSave });
  latest.current = { handleStart, handleStop, requestSave };

  usePageChrome(
    {
      actions: [
        {
          id: "start-recording",
          label: "Start Recording",
          icon: <PlayCircle size={15} aria-hidden="true" />,
          variant: hasDraft && !live ? "default" : "primary",
          disabled: isRecording || handoffActive,
          onClick: () => void latest.current.handleStart(),
          title: handoffActive ? "Finish or cancel the active secure-login handoff first" : "Start recording the target URL"
        },
        {
          id: "stop-recording",
          label: "Stop recording",
          icon: <StopCircle size={15} aria-hidden="true" />,
          variant: "danger",
          disabled: !isRecording,
          onClick: () => void latest.current.handleStop(),
          title: "Stop recording and keep the captured steps"
        },
        {
          id: "save-flow",
          label: "Save as flow",
          icon: <Save size={15} aria-hidden="true" />,
          variant: hasDraft && !live ? "primary" : "default",
          disabled: saveDisabled,
          onClick: () => latest.current.requestSave(),
          title: saveDisabled ? "Stop the recording and name the flow to save it" : "Save the captured steps to the Flow Library"
        }
      ],
      dirty: false
    },
    [isRecording, handoffActive, hasDraft, live, saveDisabled]
  );

  const stepMix = useMemo(() => {
    const mix = { interaction: 0, navigation: 0, wait: 0, "strong-semantic": 0, "acceptable-semantic": 0, "guarded-positional": 0, "review-required": 0 };
    for (const action of actions) {
      const tone = recorderActionTone(action.type);
      if (tone === "nav") mix.navigation += 1;
      else if (tone === "wait") mix.wait += 1;
      else mix.interaction += 1;
      const locatorQuality = locatorClass(action);
      if (locatorQuality) mix[locatorQuality] += 1;
    }
    return mix;
  }, [actions]);
  const located = stepMix["strong-semantic"] + stepMix["acceptable-semantic"] + stepMix["guarded-positional"] + stepMix["review-required"];
  const qualityPct = located ? Math.round((stepMix["strong-semantic"] / located) * 100) : null;
  const unresolved = actions.filter((action) => action.locator?.resolution === "needs-review" || action.locator?.resolution === "invalid").length;
  const riskyWaits = reviewSummary.counts.unsafe + reviewSummary.counts.incomplete;
  const sessionLinked = handoff?.sessionName ?? (actions.some((action) => action.type === "reuseSession") ? "" : null);
  const elapsedMs = clock.start === null ? null : (clock.stop ?? clock.now) - clock.start;
  const statusLabel = isRecording ? "Recording" : handoffActive ? "Manual handoff" : hasDraft ? "Ready to save" : "Idle";
  const handoffPhaseBadge =
    handoff?.phase === "error" ? "Error" : handoff?.phase === "capturingSession" ? "Signing in" : handoff?.phase === "sessionCaptured" ? "Resuming" : "Paused";

  return (
    <SysPage className="recorder-page">
      <h1 className="sr-only">Recorder</h1>

      {showHandoffPanel && handoff ? (
        <SysBanner
          tone={handoff.phase === "error" ? "danger" : "warning"}
          icon={Fingerprint}
          actionLabel={(handoff.phase === "detected" || handoff.phase === "error") && !handoffBusy ? "Open Chrome" : undefined}
          onAction={() => void handleContinueBrowser()}
        >
          {handoff.phase === "error"
            ? `Secure login handoff failed. ${handoff.error ?? handoff.message}`
            : handoff.phase === "capturingSession"
              ? "Recording is paused. Complete the sign-in in the Chrome window, then capture the session and resume."
              : handoff.phase === "sessionCaptured"
                ? "Session captured. Resuming the recorder with the saved session."
                : "Recording is paused. A protected login was detected, so capture stopped and the draft is preserved. Complete the sign-in in your own Chrome window, then continue."}
        </SysBanner>
      ) : null}

      {protectedDetectionIgnored && isRecording && !showHandoffPanel ? (
        <SysBanner tone="warning" icon={ShieldAlert} data-testid="protected-ignore-notice">
          Protected login detection is ignored for this Recorder session. Authentication and security steps (login, MFA, CAPTCHA) must
          still be completed manually.
        </SysBanner>
      ) : null}

      {/* Non-blocking security indicator, shown only while a session is actually running with the bypass. */}
      {isRecording && ignoreHttpsErrors ? (
        <SysBanner tone="warning" icon={ShieldAlert}>
          Certificate validation is disabled for this Recorder session. Change it in Settings → Recorder Security.
        </SysBanner>
      ) : null}

      {instrumentationError ? <SysBanner tone="danger">{instrumentationError}</SysBanner> : null}

      <SysMetrics min={210} label="Recorder summary">
        <SysMetric
          tone="info"
          icon={ListChecks}
          label="Steps captured"
          value={actions.length}
          detail={`${stepMix.interaction} interaction · ${stepMix.navigation} navigation · ${stepMix.wait} wait`}
        />
        <SysMetric
          tone={qualityPct === null ? "neutral" : stepMix["review-required"] > 0 ? "warning" : "success"}
          icon={Search}
          label="Locator quality"
          value={qualityPct ?? "—"}
          unit={qualityPct === null ? undefined : "%"}
          detail={
            located
              ? `${stepMix["strong-semantic"]} strong, ${stepMix["acceptable-semantic"]} acceptable, ${stepMix["guarded-positional"]} guarded, ${stepMix["review-required"]} review`
              : "Classified as each step is captured"
          }
        />
        <SysMetric
          tone={handoffActive ? "warning" : isRecording ? "running" : "neutral"}
          icon={Clock}
          label="Elapsed"
          value={elapsedMs === null ? "—" : formatClock(elapsedMs)}
          detail={handoffActive ? "Paused — waiting for your sign-in" : isRecording ? "Recording live" : elapsedMs === null ? "Starts when you record" : "Last recording session"}
        />
        <SysMetric
          tone={sessionLinked === null ? "neutral" : "success"}
          icon={KeyRound}
          label="Session"
          value={sessionLinked === null ? "None" : "Scoped"}
          detail={
            sessionLinked
              ? `Profile “${sessionLinked}” — will link to Reuse Session`
              : sessionLinked === ""
                ? "Reuse Session node in this draft"
                : "No saved session in this draft"
          }
        />
      </SysMetrics>

      {showHandoffPanel && handoff ? (
        <SysPanels min={640}>
          <SysPanel
            wide
            tone={handoff.phase === "error" ? "danger" : "warning"}
            icon={ShieldAlert}
            title={handoff.phase === "error" ? "Secure login handoff error" : "Protected login handoff"}
            meta={
              handoff.phase === "capturingSession"
                ? "Complete the sign-in in Chrome, then capture the session"
                : handoff.phase === "sessionCaptured"
                  ? "Resuming with the saved session"
                  : "Waiting for you — three exits"
            }
            data-testid="protected-handoff-panel"
            role="alertdialog"
            actions={
              <div className="recorder-handoff-actions">
                {handoff.phase === "detected" ? (
                  <SysButton
                    kind="smallPrimary"
                    icon={Play}
                    data-testid="handoff-ignore-continue"
                    disabled={handoffBusy}
                    onClick={() => void handleIgnoreProtected()}
                    title="Treat this as a false positive and keep recording on the same page. Does not bypass authentication."
                  >
                    Ignore and continue recording
                  </SysButton>
                ) : null}
                {handoff.phase === "detected" || handoff.phase === "error" ? (
                  <SysButton kind="small" icon={ExternalLink} data-testid="handoff-continue-browser" disabled={handoffBusy} onClick={() => void handleContinueBrowser()}>
                    {handoff.phase === "error" ? "Retry in normal browser" : "Continue using normal browser"}
                  </SysButton>
                ) : null}
                {handoff.phase === "capturingSession" ? (
                  <SysButton
                    kind="smallPrimary"
                    icon={handoffBusy ? RefreshCw : CheckCircle2}
                    data-testid="handoff-capture-resume"
                    disabled={handoffBusy}
                    onClick={() => void handleCaptureAndResume()}
                  >
                    {handoffBusy ? "Capturing..." : "Capture Session & Resume"}
                  </SysButton>
                ) : null}
                <SysButton kind="smallDanger" icon={XCircle} data-testid="handoff-cancel" disabled={handoffBusy} onClick={() => void handleCancelHandoff()}>
                  {handoff.phase === "detected" || handoff.phase === "error" ? "Cancel recording" : "Cancel"}
                </SysButton>
              </div>
            }
          >
            <SysList label="Handoff details">
              <SysListRow
                icon={ShieldAlert}
                tone={handoff.phase === "error" ? "danger" : "warning"}
                title="Reason for the pause"
                sub={handoff.message}
                badge={handoffPhaseBadge}
                badgeTone={handoff.phase === "error" ? "danger" : "warning"}
              />
              <SysListRow
                icon={Search}
                tone="neutral"
                title={`Detected ${handoff.reason} on ${handoff.origin || handoff.sourceAlias}`}
                sub={`Source ${handoff.sourceAlias}${handoff.signals.length ? ` · ${handoff.signals.join(", ")}` : ""}. The app never automates a login, MFA, CAPTCHA, passkey or approval surface.`}
                badge={handoff.confidence ? `${capitalize(handoff.confidence)} confidence` : undefined}
                badgeTone="neutral"
              />
              {handoff.phase === "error" && handoff.error ? (
                <SysListRow icon={XCircle} tone="danger" title="Handoff step failed" sub={handoff.error} badge="Error" badgeTone="danger" />
              ) : null}
              <SysListRow
                icon={ExternalLink}
                title="Sign in with your own Chrome"
                sub="Opens your real Chrome in an app-owned scoped session profile — never your default profile"
                badge={handoff.phase === "capturingSession" ? "In progress" : handoff.phase === "sessionCaptured" ? "Done" : "Available"}
                badgeTone={handoff.phase === "capturingSession" ? "info" : "success"}
              />
              {handoff.phase === "sessionCaptured" ? (
                <SysListRow icon={RefreshCw} title="Resuming recorder with the saved session" sub={handoff.sessionName ? `Session “${handoff.sessionName}”` : undefined} badge="Resuming" badgeTone="info" />
              ) : null}
              <SysListRow
                icon={Link2}
                title="Captured session links to Reuse Session"
                sub="When you continue, the recorder inserts a Reuse Session node bound to this profile"
                badge="Contract"
                badgeTone="info"
              />
            </SysList>
            {handoff.phase === "capturingSession" ? (
              <div className="recorder-handoff-name">
                <SysField label="Session name (optional)" hint={handoff.sessionName ? `Saved session: ${handoff.sessionName}` : undefined}>
                  <input
                    type="text"
                    className="sys-control"
                    value={sessionNameInput}
                    onChange={(e) => setSessionNameInput(e.target.value)}
                    placeholder="e.g. Acme Portal Login"
                    disabled={handoffBusy}
                  />
                </SysField>
              </div>
            ) : null}
          </SysPanel>
        </SysPanels>
      ) : null}

      <SysPanels min={640}>
        <SysPanel
          wide
          icon={Video}
          tone={isRecording ? "danger" : "running"}
          title="Recorder controls"
          meta="Capture browser actions into a reusable flow"
          className={`recorder-control-bar${isRecording ? " is-recording" : ""}`}
          actions={
            // The page's primary state readout. `role="status"` (polite + atomic) so starting, stopping or
            // pausing a recording is announced rather than only recoloured.
            <span className={`recorder-status-pill${isRecording ? " is-recording" : handoffActive ? " is-handoff" : " is-idle"}`} role="status">
              {statusLabel}
            </span>
          }
        >
          <div className="recorder-control-body">
            <div className="recorder-url-row">
              <SysField label="Target URL" className="recorder-url-field">
                <span className="recorder-url-input-shell">
                  <Link size={15} aria-hidden="true" />
                  <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} disabled={isRecording} placeholder="https://example.com" />
                </span>
              </SysField>
              <div className="recorder-control-actions">
                <SysButton
                  kind="secondary"
                  icon={Bookmark}
                  className="recorder-favorite-toggle"
                  aria-pressed={Boolean(currentFavorite)}
                  aria-label={currentFavorite ? "Remove current URL from Favorites" : "Favorite current URL"}
                  title={currentFavorite ? "Remove current URL from Favorites" : "Favorite current URL"}
                  disabled={!url.trim() || favoriteBusy}
                  onClick={() => void toggleFavorite(url)}
                />
                <SysButton kind="secondary" icon={Save} disabled={isRecording || !url.trim()} onClick={() => void saveCurrentUrl()} title="Save this URL to the reusable list">
                  Save URL
                </SysButton>
              </div>
            </div>

            <div className="recorder-switch-row">
              <SysSwitch
                label="Smart waits"
                hint="Capture condition-based waits from page signals"
                checked={captureSmartWaits}
                disabled={isRecording}
                onToggle={toggleCaptureSmartWaits}
                title="When on, condition-based waits are captured from page signals"
              />
              <SysSwitch
                label="Capture waiting time"
                hint="Records pauses of 0.5s or longer between actions as wait steps"
                checked={captureWaitTime}
                disabled={isRecording}
                onToggle={toggleCaptureWaitTime}
                title="When on, pauses between your actions are recorded as wait steps"
              />
            </div>

            <fieldset className="recorder-locator-mode" data-testid="recorder-locator-mode">
              <legend>Locator Recording</legend>
              <div className="recorder-locator-mode-options">
                {LOCATOR_RECORDING_MODES.map((mode) => (
                  <label key={mode} className={`recorder-locator-mode-option${locatorRecordingMode === mode ? " is-active" : ""}`}>
                    <input
                      type="radio"
                      name="recorder-locator-mode"
                      value={mode}
                      checked={locatorRecordingMode === mode}
                      disabled={locatorModeBusy}
                      onChange={() => void changeLocatorRecordingMode(mode)}
                    />
                    <span>{LOCATOR_MODE_LABEL[mode]}</span>
                  </label>
                ))}
              </div>
              <p className="recorder-locator-mode-help" aria-live="polite">
                {LOCATOR_MODE_HELP[locatorRecordingMode]}
              </p>
            </fieldset>

            <div className="recorder-command-row">
              <SysButton kind="danger" icon={StopCircle} disabled={!isRecording} onClick={handleStop}>
                Stop
              </SysButton>
              <SysButton kind="secondary" icon={XCircle} disabled={!isRecording} onClick={handleCancel}>
                Cancel
              </SysButton>
              {statusMsg ? (
                <span className="recorder-status-text" role="status">
                  {statusMsg}
                </span>
              ) : null}
            </div>
          </div>
        </SysPanel>
      </SysPanels>

      {ambiguity ? (
        <div className="modal-overlay" data-testid="ambiguity-resolution-overlay">
          <section
            ref={ambiguityDialogRef}
            className="modal-dialog recorder-locator-review"
            data-testid="ambiguity-resolution-panel"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="ambiguity-review-title"
            aria-describedby="ambiguity-review-description ambiguity-review-blocking"
            tabIndex={-1}
          >
            <div className="recorder-handoff-head">
              <ShieldAlert size={20} />
              <h3 id="ambiguity-review-title">Recorded action needs proof</h3>
            </div>

            <p id="ambiguity-review-description">
              <strong>{ambiguity.action.name}</strong> in the current recording paused before this
              action was committed. {ambiguity.reason}
            </p>

            <div className="recorder-review-evidence" data-testid="ambiguity-evidence">
              <span><strong>Element identity</strong> {ambiguity.action.locator?.identity ? "Resolved" : "Unproven"}</span>
              <span><strong>Interaction prerequisite</strong> {ambiguity.action.locator?.prerequisite?.status ?? "none"}</span>
              <span><strong>Confidence</strong> {ambiguity.action.locator?.quality?.confidence ?? "unknown"}</span>
              <span><strong>Total matches</strong> {ambiguity.action.locator?.quality?.matchCount ?? "unknown"}</span>
              <span><strong>Visible matches</strong> {ambiguity.action.locator?.quality?.visibleMatchCount ?? "unknown"}</span>
              <span><strong>Context</strong> {formatLocatorContext(ambiguity.action)}</span>
            </div>

            {ambiguity.action.locator ? (
              <div
                className="recorder-review-candidate is-primary"
                data-testid="ambiguity-primary-locator"
                onMouseEnter={() => void window.playwrightFlowStudio.recorder.highlightCandidate()}
                onMouseLeave={() => void window.playwrightFlowStudio.recorder.clearHighlight()}
                onFocus={() => void window.playwrightFlowStudio.recorder.highlightCandidate()}
                onBlur={() => void window.playwrightFlowStudio.recorder.clearHighlight()}
              >
                <div>
                  <strong>Recorded primary locator</strong>
                  <code>{ambiguity.action.locator.strategy}: {ambiguity.action.locator.value}{ambiguity.action.locator.name ? ` (${ambiguity.action.locator.name})` : ""}</code>
                </div>
                <span>{ambiguity.kind === "positional" ? "Fragile · approval required" : "Diagnostic"}</span>
              </div>
            ) : null}

            {ambiguity.action.locator?.alternatives?.length ? (
              <div className="recorder-review-list" aria-label="Ranked locator alternatives">
                {ambiguity.action.locator.alternatives.map((candidate, index) => (
                  <div
                    className="recorder-review-candidate"
                    key={`${candidate.strategy}:${candidate.value}:${index}`}
                    onMouseEnter={() => void window.playwrightFlowStudio.recorder.highlightCandidate(index)}
                    onMouseLeave={() => void window.playwrightFlowStudio.recorder.clearHighlight()}
                  >
                    <div>
                      <strong>Alternative {index + 1}</strong>
                      <code>{candidate.strategy}: {candidate.value}{candidate.name ? ` (${candidate.name})` : ""}</code>
                    </div>
                    <button
                      type="button"
                      className="toolbar-button"
                      data-testid={`ambiguity-pick-${index}`}
                      disabled={ambiguityBusy || !ambiguity.canSelectCandidates}
                      onFocus={() => void window.playwrightFlowStudio.recorder.highlightCandidate(index)}
                      onBlur={() => void window.playwrightFlowStudio.recorder.clearHighlight()}
                      onClick={() => void handleAmbiguityResolution("selectCandidate", index)}
                    >
                      Validate and use
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            {ambiguity.canApproveFallback ? (
              <label className="recorder-fallback-reason">
                Approval reason
                <textarea
                  data-testid="ambiguity-approval-reason"
                  value={fallbackApprovalReason}
                  onChange={(event) => setFallbackApprovalReason(event.target.value)}
                  aria-describedby="ambiguity-approval-help"
                />
                <span id="ambiguity-approval-help">
                  Explain why this exact lower-resilience target is acceptable. Approval is bound to
                  the locator, context, and action; sensitive actions remain prohibited.
                </span>
              </label>
            ) : null}

            <p id="ambiguity-review-blocking" className="recorder-review-blocking" role="status">
              Execution is blocked until a valid resolution is persisted. You may keep the action as
              Needs review and save the recording as a draft.
            </p>

            <div className="modal-actions recorder-review-actions">
              {ambiguity.canScopeToCurrentContext ? (
                <button
                  type="button"
                  className="toolbar-button"
                  data-testid="ambiguity-scope-context"
                  disabled={ambiguityBusy}
                  onClick={() => void handleAmbiguityResolution("scopeToAncestor")}
                >
                  Validate captured scope
                </button>
              ) : null}
              {ambiguity.canApproveFallback ? (
                <button
                  type="button"
                  className="toolbar-button recorder-button-success"
                  data-testid="ambiguity-approve-fallback"
                  disabled={ambiguityBusy || fallbackApprovalReason.trim().length < 8}
                  onClick={() => void handleAmbiguityResolution("approveFallback")}
                >
                  Approve this fallback
                </button>
              ) : null}
              <button
                type="button"
                className="toolbar-button"
                data-testid="ambiguity-defer"
                disabled={ambiguityBusy}
                onClick={() => void handleAmbiguityResolution("defer")}
              >
                Keep as Needs review
              </button>
              <button
                type="button"
                className="toolbar-button recorder-button-subtle"
                data-testid="ambiguity-discard"
                disabled={ambiguityBusy}
                onClick={() => void handleAmbiguityResolution("cancel")}
              >
                <XCircle size={16} />
                Discard action
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <SysPanels min={640}>
        <SysPanel
          wide
          icon={Play}
          title="Captured steps"
          meta={`Draft flow — editable before saving · ${actions.length} step${actions.length === 1 ? "" : "s"}`}
          actions={
            <div className="recorder-panel-actions">
              {isRecording ? <span className="recorder-recording-dot" title="Recording" /> : null}
              <SysButton
                kind="small"
                icon={Eye}
                disabled={asyncReviews.length === 0 || saveDisabled}
                onClick={() => setReviewOpen(true)}
                title={asyncReviews.length ? "Review the captured async activity before saving" : "No async activity to review"}
              >
                Review all
              </SysButton>
              <SysButton
                kind="smallDanger"
                icon={Trash2}
                className="recorder-clear-actions"
                disabled={actions.length === 0 || actionMutationBusy}
                onClick={() => setActionMutationConfirm({ kind: "clear" })}
              >
                Clear all
              </SysButton>
            </div>
          }
        >
          {actions.length === 0 ? (
            <div className="recorder-empty">
              <SysPanelEmpty icon={Video} title="No actions recorded yet." hint="Start recording to capture browser events." />
            </div>
          ) : (
            <div ref={actionsListRef} className="recorder-steps-scroll">
              <SysTimeline className="recorder-timeline" label="Captured steps" aria-live="polite">
                {actions.map((action, index) => {
                  const strength = locatorClass(action);
                  const waitTypes = [...(action.beforeWaits ?? []), ...(action.afterWaits ?? [])].map((wait) => wait.type);
                  const meta = [
                    action.locator && locatorContainerChain(action.locator.context).length ? formatLocatorScope(action) : "",
                    waitTypes.length ? `Smart waits: ${waitTypes.join(", ")}` : "",
                    action.valueSource ? `Value → ${action.valueSource.value}` : ""
                  ].filter(Boolean);
                  return (
                    <SysTimelineRow
                      key={action.id}
                      className="recorder-timeline-row"
                      tone={stepTone(action, strength)}
                      live={isRecording && index === actions.length - 1}
                      title={action.name}
                      badge={recorderActionBadge(action) ?? (strength ? LOCATOR_QUALITY_CLASS_LABEL[strength] : formatActionType(action.type))}
                      time={`Step ${index + 1}`}
                      sub={
                        <>
                          {formatActionType(action.type)}
                          {action.locator ? (
                            <>
                              {" · "}
                              <code className="recorder-step-locator">
                                {action.locator.strategy}: {action.locator.value}
                              </code>
                            </>
                          ) : null}
                        </>
                      }
                      actions={
                        <SysIconButton
                          icon={Trash2}
                          tone="danger"
                          className="recorder-action-delete"
                          label={`Delete recorded action ${index + 1}: ${action.name}`}
                          title="Delete recorded action"
                          disabled={actionMutationBusy}
                          onClick={() => setActionMutationConfirm({ kind: "delete", action })}
                        />
                      }
                    >
                      {meta.length ? (
                        <span className="recorder-step-meta" title={action.valueSource?.value}>
                          {meta.join(" · ")}
                        </span>
                      ) : null}
                    </SysTimelineRow>
                  );
                })}
              </SysTimeline>
            </div>
          )}
        </SysPanel>
      </SysPanels>

      <SysPanels>
        <SysPanel icon={Search} title="Locator quality" meta="Classified as each step is captured">
          <SysBars
            label="Locator quality"
            rows={[
              { label: "Strong semantic · unique test id, role, label or placeholder", raw: stepMix["strong-semantic"], value: stepMix["strong-semantic"], color: "var(--awkit-success)" },
              { label: "Acceptable semantic · text, scoped or visibility-dependent", raw: stepMix["acceptable-semantic"], value: stepMix["acceptable-semantic"], color: "var(--awkit-info)" },
              { label: "Guarded positional · position re-proven by identity", raw: stepMix["guarded-positional"], value: stepMix["guarded-positional"], color: "var(--awkit-warning)" },
              { label: "Review required · unproven, structural or not unique", raw: stepMix["review-required"], value: stepMix["review-required"], color: "var(--awkit-danger)" }
            ]}
          />
        </SysPanel>

        <SysPanel icon={ListChecks} title="Review before saving" meta="Send the captured steps to the Flow Library">
          <SysChecklist label="Review before saving">
            <SysCheckRow
              tone={unresolved ? "warning" : "success"}
              title={unresolved ? `${unresolved} step${unresolved === 1 ? "" : "s"} need${unresolved === 1 ? "s" : ""} locator review` : "Every locator is resolved"}
              sub={unresolved ? "Execution stays blocked for these steps until they are resolved" : "No step is waiting on identity proof"}
              badge={unresolved ? "Review" : "Pass"}
            />
            <SysCheckRow
              tone={stepMix["review-required"] ? "warning" : "success"}
              title={
                stepMix["review-required"]
                  ? `${stepMix["review-required"]} locator${stepMix["review-required"] === 1 ? "" : "s"} need${stepMix["review-required"] === 1 ? "s" : ""} review`
                  : "No locator needs review"
              }
              sub="Unguarded positional, structural and non-unique locators are the first to break when the page changes"
              badge={stepMix["review-required"] ? "Review" : "Pass"}
            />
            <SysCheckRow
              tone={riskyWaits ? "warning" : "success"}
              title={asyncReviews.length ? `${asyncReviews.length} step${asyncReviews.length === 1 ? "" : "s"} captured async activity` : "No async activity to review"}
              sub={riskyWaits ? `${riskyWaits} unsafe or incomplete wait${riskyWaits === 1 ? "" : "s"} — reviewed before saving` : "Captured waits are reliable"}
              badge={riskyWaits ? "Review" : "Pass"}
            />
            <SysCheckRow
              tone={sessionLinked === null ? "neutral" : "success"}
              title={sessionLinked === null ? "No session to link" : "Session will be linked"}
              sub={sessionLinked === null ? "Protected logins pause for a manual handoff" : "A Reuse Session node carries the captured login"}
              badge={sessionLinked === null ? "None" : "Pass"}
            />
          </SysChecklist>
          <div className="recorder-save-row">
            <SysField label="Flow Name">
              <input type="text" className="sys-control" value={flowName} onChange={(e) => setFlowName(e.target.value)} disabled={isRecording} />
            </SysField>
            <SysButton kind="primary" icon={Save} className="recorder-save-button" disabled={saveDisabled} onClick={requestSave}>
              {isSaving ? "Saving..." : "Save to Flow Library"}
            </SysButton>
          </div>
          {saveResult ? (
            <div role="status" className={`recorder-save-result ${saveResult.tone}`}>
              {saveResult.tone === "success" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
              <span>{saveResult.text}</span>
            </div>
          ) : null}
          {actions.length === 0 && !isRecording && !isSaving ? <p className="recorder-save-hint">Record some actions first.</p> : null}
        </SysPanel>
      </SysPanels>

      <SysTableCard
        title="URL history"
        className="recorder-saved-urls-panel"
        actions={
          <>
            <div className="recorder-url-tabs" role="tablist" aria-label="URL history">
              {(["recorded", "favorites"] as const).map((tab) => (
                <button
                  key={tab}
                  id={`recorder-url-tab-${tab}`}
                  type="button"
                  role="tab"
                  aria-selected={urlTab === tab}
                  aria-controls="recorder-url-panel"
                  tabIndex={urlTab === tab ? 0 : -1}
                  className="recorder-url-tab"
                  onClick={() => {
                    setUrlTab(tab);
                    setUrlPage(1);
                  }}
                  onKeyDown={(event) => {
                    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                    event.preventDefault();
                    const next = event.key === "Home" ? "recorded" : event.key === "End" ? "favorites" : tab === "recorded" ? "favorites" : "recorded";
                    setUrlTab(next);
                    setUrlPage(1);
                    document.getElementById(`recorder-url-tab-${next}`)?.focus();
                  }}
                >
                  {tab === "recorded" ? "Recorded URLs" : "Favorite URLs"}
                </button>
              ))}
            </div>
            <span className="sys-search recorder-url-search">
              <Search size={14} strokeWidth={1.9} aria-hidden="true" />
              {/* A placeholder is not an accessible name: it is not reliably announced as one, and it
                  disappears the moment the user types. */}
              <input
                type="search"
                value={urlSearch}
                aria-label={urlTab === "favorites" ? "Search favorite URLs" : "Search recorded URLs"}
                placeholder="Search by URL, title, source, or session..."
                onChange={(e) => {
                  setUrlSearch(e.target.value);
                  setUrlPage(1);
                }}
              />
            </span>
          </>
        }
      >
        <div id="recorder-url-panel" role="tabpanel" aria-labelledby={`recorder-url-tab-${urlTab}`}>
          {visibleUrls.length === 0 ? (
            <SysTableEmpty
              icon={urlTab === "favorites" ? Bookmark : Globe}
              title={urlTab === "favorites" ? "No favorite URLs yet." : "No URLs recorded yet."}
              hint={urlTab === "favorites" ? "Use the bookmark beside a URL to add it to Favorites." : "Start recording and navigate to pages to see them here."}
            />
          ) : filteredUrls.length === 0 ? (
            <SysTableEmpty icon={Search} title="No matching URLs found." hint="Adjust your search text." />
          ) : (
            <>
              <div className="sys-table-scroll">
                <table className="sys-table recorded-urls-table">
                  <colgroup>
                    <col style={{ width: "12%" }} />
                    <col style={{ width: "18%" }} />
                    <col style={{ width: "30%" }} />
                    <col style={{ width: "13%" }} />
                    <col style={{ width: "10%" }} />
                    <col style={{ width: "17%" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col" className="sys-th"><span className="sys-th-button">Time</span></th>
                      <th scope="col" className="sys-th"><span className="sys-th-button">Title</span></th>
                      <th scope="col" className="sys-th"><span className="sys-th-button">URL</span></th>
                      <th scope="col" className="sys-th"><span className="sys-th-button">Source</span></th>
                      <th scope="col" className="sys-th"><span className="sys-th-button">Session</span></th>
                      <th scope="col" className="sys-th"><span className="sys-th-button">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedUrls.map((record) => {
                      const favorite = favoriteForUrl(record.url);
                      return (
                        <tr
                          key={record.id}
                          className="recorded-url-row"
                          data-disabled={isRecording || undefined}
                          onClick={() => {
                            if (!isRecording) useSavedUrl(record.url);
                          }}
                        >
                          <td className="recorded-url-row-primary" title={new Date(record.timestamp).toLocaleString()}>
                            <button
                              type="button"
                              className="recorded-url-row-activator recorded-url-use"
                              disabled={isRecording}
                              aria-label={`Use ${urlTab === "favorites" ? "favorite" : "recorded"} URL ${record.title || record.url}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                useSavedUrl(record.url);
                              }}
                            />
                            <span className="sys-cell-text is-muted is-num">{new Date(record.timestamp).toLocaleTimeString()}</span>
                          </td>
                          <td title={record.title || undefined}>{record.title || "--"}</td>
                          <td title={isRecording ? record.url : `Click row to use: ${record.url}`}>
                            <span className="recorded-url-value">{record.url}</span>
                          </td>
                          <td>
                            <SysBadge tone="neutral" icon={null} size="sm">
                              {record.source}
                            </SysBadge>
                          </td>
                          <td title={record.sessionId || undefined}>{record.sessionId ? record.sessionId.slice(0, 8) : "--"}</td>
                          <td className="recorded-url-row-actions">
                            <SysCellActions>
                              <SysIconButton
                                icon={CornerDownLeft}
                                label="Use this URL in Recorder Controls"
                                disabled={isRecording}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  useSavedUrl(record.url);
                                }}
                              />
                              <SysIconButton
                                icon={Copy}
                                label="Copy URL"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  copyUrl(record.url);
                                }}
                              />
                              <SysIconButton
                                icon={Bookmark}
                                className="recorder-favorite-toggle"
                                title={favorite ? "Remove from Favorites" : "Add to Favorites"}
                                label={`${favorite ? "Remove" : "Add"} ${record.url} ${favorite ? "from" : "to"} Favorites`}
                                aria-pressed={Boolean(favorite)}
                                disabled={favoriteBusy}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void toggleFavorite(record.url);
                                }}
                              />
                            </SysCellActions>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <SysPagination
                total={filteredUrls.length}
                noun="URLs"
                page={urlPageClamped}
                pageSize={urlPageSize}
                totalPages={urlTotalPages}
                onPage={setUrlPage}
                onPageSize={(size) => {
                  setUrlPageSize(size);
                  setUrlPage(1);
                }}
              />
            </>
          )}
        </div>
      </SysTableCard>

      {reviewOpen ? (
        <div className="modal-overlay" role="presentation" onClick={() => setReviewOpen(false)}>
          <div
            ref={reviewDialogRef}
            className="modal-dialog recorder-review-dialog"
            role="dialog"
            tabIndex={-1}
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

      {actionMutationConfirm ? (
        <ConfirmDialog
          title={actionMutationConfirm.kind === "clear" ? "Clear all recorded actions?" : "Delete recorded action?"}
          message={
            actionMutationConfirm.kind === "clear"
              ? "This clears the current action list and draft while preserving recorded URL history. Recording can continue afterward."
              : `Delete “${actionMutationConfirm.action.name}”? Any synthetic wait or popup lifecycle actions that depend on it will also be removed.`
          }
          confirmLabel={actionMutationConfirm.kind === "clear" ? "Clear all" : "Delete action"}
          danger
          onConfirm={() => void applyActionMutation()}
          onCancel={() => { if (!actionMutationBusy) setActionMutationConfirm(null); }}
        />
      ) : null}

      {/* AWKIT-REC-037: starting must never silently destroy a preserved draft. */}
      {startOverwriteConfirmOpen ? (
        <ConfirmDialog
          title="Start a new recording?"
          message={`The preserved draft with ${actions.length} recorded action${actions.length === 1 ? "" : "s"} will be discarded when the new recording starts. Save it to the Flow Library first if you want to keep it.`}
          confirmLabel="Discard draft and start"
          cancelLabel="Keep draft"
          danger
          onConfirm={() => {
            setStartOverwriteConfirmOpen(false);
            void doStart();
          }}
          onCancel={() => setStartOverwriteConfirmOpen(false)}
        />
      ) : null}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </SysPage>
  );
}

const LOCATOR_MODE_LABEL: Record<LocatorRecordingMode, string> = {
  default: "Default",
  role: "Role + name",
  text: "Text",
  testId: "Test ID",
  xpath: "XPath"
};

const LOCATOR_MODE_HELP: Record<LocatorRecordingMode, string> = {
  default: "Uses AWKIT's existing resilient locator generation.",
  role: "Prefers a unique role and accessible name; keeps the default choice when there is none.",
  text: "Prefers unique visible text; keeps the default choice when there is none.",
  testId: "Prefers a unique test id; keeps the default choice when there is none.",
  xpath: "Records element locators as XPath (low durability). Existing actions keep their recorded strategy."
};

/** The shared L2 quality class (src/recorder/LocatorQualityClass.ts), never a page-local grade. */
function locatorClass(action: RecordedAction): LocatorQualityClass | null {
  // The draft locator carries the same fields buildRecordedFlow forwards (its guard is not hashed yet).
  return classifyLocatorQuality(action.locator as StepLocator | undefined)?.class ?? null;
}

const CLASS_TONE: Record<LocatorQualityClass, SysTone> = {
  "strong-semantic": "success",
  "acceptable-semantic": "info",
  "guarded-positional": "warning",
  "review-required": "danger"
};

function stepTone(action: RecordedAction, locatorQuality: LocatorQualityClass | null): SysTone {
  if (action.locator?.resolution === "invalid") return "danger";
  if (action.locator?.resolution === "needs-review") return "warning";
  if (locatorQuality) return CLASS_TONE[locatorQuality];
  const tone = recorderActionTone(action.type);
  return tone === "session" ? "warning" : tone === "wait" ? "neutral" : "info";
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

/** Attention and popup-lifecycle badges; an ordinary resolved step shows its locator grade instead. */
function recorderActionBadge(action: RecordedAction): string | null {
  if (action.locator?.prerequisite?.status === "unknown") return "Prerequisite unknown";
  if (action.locator?.resolution === "needs-review") return action.locator?.identity ? "Identity resolved · action blocked" : "Needs identity proof";
  if (action.locator?.resolution === "user-approved-fallback") return "Approved fallback";
  if (action.locator?.resolution === "invalid") return "Invalid locator";
  if (action.type === "switchToPopup") return "Switch popup";
  if (action.type === "closePopup") return "Close popup";
  if (action.type === "switchToMainPage") return "Main page";
  if (action.opensPopup) return "Opens popup";
  if (action.pageAlias && action.pageAlias !== "main") return action.pageAlias;
  return null;
}

function formatLocatorScope(action: RecordedAction): string {
  const chain = locatorContainerChain(action.locator?.context);
  if (!chain.length) return "";
  const quality = action.locator?.quality?.isUnique ? "Unique · " : "";
  return `${quality}scoped · ${chain.length} container${chain.length === 1 ? "" : "s"}: ${chain.map((entry) => entry.type).join(" → ")}`;
}

function formatLocatorContext(action: RecordedAction): string {
  const context = action.locator?.context;
  const parts: string[] = [];
  if (context?.frame?.selector) parts.push(`frame ${context.frame.selector}`);
  if (context?.shadow?.boundary && context.shadow.boundary !== "none") {
    parts.push(`${context.shadow.boundary} shadow${context.shadow.hosts?.length ? ` · ${context.shadow.hosts.length} host(s)` : ""}`);
  }
  const chain = locatorContainerChain(context);
  if (chain.length) parts.push(chain.map((entry) => `${entry.type} ${entry.strategy}:${entry.value}`).join(" → "));
  return parts.length ? parts.join(" → ") : "page root";
}

function formatActionType(type: string): string {
  const formatted = type
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return formatted ? formatted.charAt(0).toUpperCase() + formatted.slice(1) : "Action";
}

function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
