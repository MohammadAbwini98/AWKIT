import type { ProtectedLoginProvider, ProtectedLoginReason } from "./ProtectedLoginDetector";

/** Approved handoff actions. None of these bypass a protection — they cancel, retry, or use an
 *  already-approved session/OAuth path. */
export type ProtectedLoginHandoffAction =
  | "cancel"
  | "retry"
  | "continue"
  | "useSavedSession"
  | "openSystemBrowser"
  | "useOAuth"
  | "useTestSession";

export interface ProtectedLoginHandoffResult {
  action: ProtectedLoginHandoffAction;
  sessionId?: string;
  note?: string;
}

/**
 * Handoff info surfaced to the instance/UI when the runner pauses. Contains only the page URL,
 * provider, reason, and human message — never cookies/tokens/session contents.
 */
export interface HandoffInfo {
  kind: "manual" | "protectedLogin";
  message: string;
  provider?: ProtectedLoginProvider;
  reason?: ProtectedLoginReason;
  url?: string;
  allowedActions: ProtectedLoginHandoffAction[];
}
