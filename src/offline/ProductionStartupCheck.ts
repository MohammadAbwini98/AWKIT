import type { OfflineRuntimeStatus } from "./OfflineRuntimeValidator";

export interface StartupCheckResult {
  ok: boolean;
  blockingFailures: string[];
}

export function evaluateProductionStartup(status: OfflineRuntimeStatus): StartupCheckResult {
  const blockingFailures = status.checks
    .filter((check) => !check.ok)
    .map((check) => check.label);

  return {
    ok: blockingFailures.length === 0,
    blockingFailures
  };
}

/**
 * Checks that must pass before a packaged offline build is allowed to open its
 * main window. This is intentionally narrower than {@link evaluateProductionStartup}:
 * it gates only on assets whose absence makes the app unusable offline, and skips
 * advisory checks (e.g. native modules) and any folder-writability probe failures
 * are included because runtime data must be persistable.
 */
const BLOCKING_STARTUP_CHECK_KEYS = ["manifest", "offlineManifest", "bundledBrowser", "runtimeDownloads", "runtimeRoot"];

export function evaluateOfflineStartupGate(status: OfflineRuntimeStatus): StartupCheckResult {
  const blockingFailures = status.checks
    .filter((check) => !check.ok && (BLOCKING_STARTUP_CHECK_KEYS.includes(check.key) || check.key.startsWith("folder.")))
    .map((check) => (check.detail ? `${check.label} — ${check.detail}` : check.label));

  return {
    ok: blockingFailures.length === 0,
    blockingFailures
  };
}
