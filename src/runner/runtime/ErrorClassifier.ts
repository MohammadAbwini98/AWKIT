/**
 * Classifies step/runtime failures into actionable error classes so retry decisions are
 * evidence-based instead of blanket. Classification uses the raw error text plus the step
 * type — never secrets.
 */

export type ErrorClass =
  | "navigation"
  | "timeout"
  | "locator"
  | "browser-crash"
  | "context-closed"
  | "page-closed"
  | "auth-expired"
  | "profile-locked"
  | "download-failed"
  | "manual-action-required"
  | "business-rule"
  | "dangerous-side-effect"
  | "cancelled"
  | "unknown";

/** Error classes that are safe to retry automatically (transient/read-only failures). */
export const RETRYABLE_ERROR_CLASSES: ReadonlySet<ErrorClass> = new Set([
  "navigation",
  "timeout",
  "locator",
  "download-failed"
]);

/** Error classes that must never be auto-retried. */
export const TERMINAL_ERROR_CLASSES: ReadonlySet<ErrorClass> = new Set([
  "browser-crash",
  "context-closed",
  "page-closed",
  "auth-expired",
  "profile-locked",
  "manual-action-required",
  "business-rule",
  "dangerous-side-effect",
  "cancelled"
]);

/**
 * Infrastructure-terminal classes: retrying is pointless even when explicit safety metadata says
 * the step itself is retryable (the browser/session is gone or a human is required).
 */
export const INFRA_TERMINAL_ERROR_CLASSES: ReadonlySet<ErrorClass> = new Set([
  "browser-crash",
  "context-closed",
  "page-closed",
  "profile-locked",
  "manual-action-required",
  "cancelled"
]);

export function classifyError(error: string | Error | undefined, stepType?: string): ErrorClass {
  const text = (error instanceof Error ? `${error.name}: ${error.message}` : error ?? "").toLowerCase();
  if (!text) return "unknown";

  if (text.includes("cancellederror") || text.includes("execution cancelled")) {
    return "cancelled";
  }
  if (text.includes("profilelockederror") || text.includes("persistentprofileinuseerror") || text.includes("profile is currently in use") || text.includes("profile is already in use")) {
    return "profile-locked";
  }
  if (text.includes("manual handoff") || text.includes("manual action") || text.includes("protected login")) {
    return "manual-action-required";
  }
  // Playwright's generic closed-target message names page, context AND browser — check it
  // before the browser-specific patterns so it lands in the (equally terminal) context class.
  if (text.includes("context or browser has been closed") || text.includes("context has been closed") || text.includes("context closed")) {
    return "context-closed";
  }
  if (text.includes("browser has been closed") || text.includes("browser closed") || text.includes("browser is disconnected") || text.includes("browser crash")) {
    return "browser-crash";
  }
  if (text.includes("page has been closed") || text.includes("page is closed") || text.includes("page closed") || text.includes("page crashed")) {
    return "page-closed";
  }
  if (text.includes("session expired") || text.includes("auth expired") || text.includes("401") || text.includes("unauthorized")) {
    return "auth-expired";
  }
  if (stepType === "download" || text.includes("download failed") || text.includes("download error")) {
    return "download-failed";
  }
  if (text.includes("net::err") || text.includes("navigation failed") || text.includes("navigation to") || stepType === "goto" && text.includes("timeout")) {
    return "navigation";
  }
  if (text.includes("strict mode violation") || text.includes("locator") || text.includes("element is not") || text.includes("no element matches") || text.includes("resolved to")) {
    return "locator";
  }
  if (text.includes("timeout") || text.includes("timed out")) {
    return "timeout";
  }
  if (text.includes("assertion failed") || text.includes("expected") && text.includes("received")) {
    return "business-rule";
  }
  return "unknown";
}

/**
 * Dangerous-mutation detection: steps whose visible name/label/value suggests a
 * non-idempotent business side effect (submit/approve/delete/send/payment/confirm).
 * These must not be blindly re-run by automatic retry.
 */
const DANGEROUS_KEYWORDS = [
  "submit",
  "approve",
  "approval",
  "delete",
  "remove permanently",
  "send",
  "pay",
  "payment",
  "purchase",
  "checkout",
  "confirm order",
  "final confirm",
  "finalize",
  "sign and",
  "transfer"
];

/** Step types capable of triggering a server-side mutation. */
const MUTATING_STEP_TYPES = new Set(["click", "fill", "check", "select", "upload", "keyboard"]);

export function isDangerousMutationStep(step: { type: string; name?: string; value?: string }): boolean {
  if (!MUTATING_STEP_TYPES.has(step.type)) return false;
  const haystack = `${step.name ?? ""} ${step.value ?? ""}`.toLowerCase();
  return DANGEROUS_KEYWORDS.some((keyword) => haystack.includes(keyword));
}
