/**
 * Reporting failure taxonomy. This is a MAP over the existing runtime `ErrorClass`
 * (src/runner/runtime/ErrorClassifier.ts) — it never re-parses raw error text, so there is a
 * single source of truth for classification. Conservative: anything unmapped becomes `unknown`.
 * See docs/ai/ui-reports-refactor/04_ENHANCED_REPORTING_TELEMETRY_CONTRACT.md §2.
 */
import type { ErrorClass } from "@src/runner/runtime/ErrorClassifier";

export type ReportCategory =
  | "navigation"
  | "selector"
  | "timeout"
  | "assertion"
  | "browser-crash"
  | "context-closed"
  | "profile-lock"
  | "session-expired"
  | "auth-handoff-required"
  | "network"
  | "download-upload"
  | "data-binding"
  | "cancelled"
  | "unknown";

export const REPORT_CATEGORIES: readonly ReportCategory[] = [
  "navigation",
  "selector",
  "timeout",
  "assertion",
  "browser-crash",
  "context-closed",
  "profile-lock",
  "session-expired",
  "auth-handoff-required",
  "network",
  "download-upload",
  "data-binding",
  "cancelled",
  "unknown"
] as const;

const ERROR_CLASS_TO_CATEGORY: Record<ErrorClass, ReportCategory> = {
  navigation: "navigation",
  timeout: "timeout",
  locator: "selector",
  "browser-crash": "browser-crash",
  "context-closed": "context-closed",
  "page-closed": "context-closed",
  "auth-expired": "session-expired",
  "profile-locked": "profile-lock",
  "download-failed": "download-upload",
  "manual-action-required": "auth-handoff-required",
  "business-rule": "assertion",
  // A dangerous-side-effect refusal is a safety stop, not a diagnosable failure category.
  "dangerous-side-effect": "unknown",
  cancelled: "cancelled",
  unknown: "unknown"
};

/** Map an `ErrorClass` (or undefined/unknown string) to a report category. Conservative. */
export function toReportCategory(errorClass: ErrorClass | string | undefined): ReportCategory {
  if (!errorClass) return "unknown";
  return ERROR_CLASS_TO_CATEGORY[errorClass as ErrorClass] ?? "unknown";
}

/** Human label for a report category (UI + tooltips). */
export function reportCategoryLabel(category: ReportCategory): string {
  switch (category) {
    case "navigation":
      return "Navigation";
    case "selector":
      return "Selector";
    case "timeout":
      return "Timeout";
    case "assertion":
      return "Assertion / validation";
    case "browser-crash":
      return "Browser crash";
    case "context-closed":
      return "Context / page closed";
    case "profile-lock":
      return "Profile lock";
    case "session-expired":
      return "Session expired";
    case "auth-handoff-required":
      return "Auth handoff required";
    case "network":
      return "Network";
    case "download-upload":
      return "Download / upload";
    case "data-binding":
      return "Data binding";
    case "cancelled":
      return "Cancelled";
    case "unknown":
    default:
      return "Unknown";
  }
}

/**
 * Whether a category counts toward the technical failure rate. User-cancelled runs are an
 * intentional stop, not a failure; everything else (including an unclassified `unknown`) counts.
 */
export function isFailureCategory(category: ReportCategory): boolean {
  return category !== "cancelled";
}
