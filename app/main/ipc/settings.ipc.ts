import { ipcMain, shell, app } from "electron";
import { existsSync } from "node:fs";
import { rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  clearUiState,
  getDefaultPaths,
  getUiSettings,
  replaceUiSettings,
  resetUiSettings,
  updateUiSettings,
  validateSettings,
  type DeepPartial,
  type UiSettings
} from "../uiSettings";
import { getRuntimeDataRoot, isProductionOffline } from "../appPaths";
import { applyRuntimeConcurrencyFromSettings } from "./execution.ipc";
import {
  createDataSourceProfileStore,
  createFlowProfileStore,
  createReportStore,
  createWorkflowProfileStore
} from "../profileStores";
import { assertSenderPermission, assertSenderSuperUser } from "../security/sessionContext";
import { Permission } from "@src/security/authz/Permissions";
import { getDebugLogService } from "../debugLogService";
import { getSecurityKernel } from "../security/securityKernel";
import { sessionInactivityMinutesToMs } from "@src/security/session/SessionPolicy";
import { InstalledChromeResolver } from "@src/session/InstalledChromeResolver";

/**
 * Config groups the Settings page owns; a patch touching any of these requires SETTINGS_EDIT. Everything
 * else in UiSettings is per-user UI state (theme, sidebar, last route, panel widths/zoom, table view,
 * last-run values) written implicitly as ANY signed-in role navigates, so it stays open to all roles.
 */
const SUBSTANTIVE_SETTINGS_KEYS = ["paths", "runtime", "execution", "designerDefaults"] as const;
function patchTouchesSubstantiveSettings(patch: DeepPartial<UiSettings>): boolean {
  // `recorder.security` is privileged (it can disable HTTPS certificate validation for automation
  // browsers) even though its siblings `recorder.captureWaitTime` / `captureSmartWaits` are plain UI
  // state the Recorder page writes implicitly for any signed-in role. Gate the security group only.
  if (patch.recorder?.security !== undefined) return true;
  // AWKIT-SEC-004: `ignoreProtectedLoginDetection` suppresses the protected-login pause-and-handoff
  // for every future Recorder session on this machine, so persisting it is a privileged write too —
  // its sibling `security` was gated while this field one level over was missed.
  if (patch.recorder?.ignoreProtectedLoginDetection !== undefined) return true;
  return SUBSTANTIVE_SETTINGS_KEYS.some((key) => patch[key] !== undefined);
}

async function countSafe(list: () => Promise<unknown[]>): Promise<number> {
  try {
    return (await list()).length;
  } catch {
    return 0;
  }
}

/**
 * Writability is decided by attempting an actual write, not by `access(path, W_OK)`.
 *
 * `access` is not a usable writability test for a DIRECTORY on Windows: Node does not consult the
 * directory ACL, so a folder the user has been explicitly denied "create file"/"create folder" on
 * still reports writable, while a real write fails `EPERM` (measured both ways). These paths are
 * where run artifacts land, so a wrong "writable" label sends the operator away satisfied and then
 * fails at run time, with nothing in Settings having warned them (`AWKIT-SET-005`).
 *
 * The probe file is uniquely named and removed in a `finally`, so a crash between write and delete
 * cannot leave a permanent artifact in a user-configured folder.
 */
async function checkPath(path: string): Promise<{ path: string; exists: boolean; writable: boolean }> {
  const exists = !!path && existsSync(path);
  let writable = false;
  if (exists) {
    const probePath = join(path, `.awkit-write-probe-${randomUUID()}`);
    try {
      if (!(await stat(path)).isDirectory()) return { path, exists, writable: false };
      await writeFile(probePath, "");
      writable = true;
    } catch {
      writable = false;
    } finally {
      await rm(probePath, { force: true }).catch(() => undefined);
    }
  }
  return { path, exists, writable };
}

export function registerSettingsIpc(): void {
  ipcMain.handle("settings:get", async () => getUiSettings());
  // After any mutation that can change the runtime caps, push them into the engine so the idle Chrome
  // Consumption gauges + admission reflect the new values immediately (best-effort, never blocks).
  const applyConcurrency = () => void applyRuntimeConcurrencyFromSettings();
  ipcMain.handle("settings:update", async (event, patch: DeepPartial<UiSettings>) => {
    // Substantive config (paths/runtime/execution/designerDefaults) is Settings-page-only and requires
    // SETTINGS_EDIT; pure UI-state patches stay open (the global sender guard still covers them).
    if (patchTouchesSubstantiveSettings(patch)) {
      await assertSenderPermission(event, Permission.SETTINGS_EDIT);
    }
    if (patch.superUser?.debugMode !== undefined) {
      await assertSenderPermission(event, Permission.DEBUG_MODE_MANAGE);
    }
    if (patch.superUser?.sessionInactivityMinutes !== undefined) {
      await assertSenderPermission(event, Permission.SESSION_POLICY_MANAGE);
    }
    if (patch.superUser?.chrome !== undefined) {
      await assertSenderSuperUser(event, Permission.SETTINGS_EDIT, {
        audit: { eventType: "INSTALLED_CHROME_SETTINGS_DENIED", channel: "settings:update" }
      });
    }
    const next = await updateUiSettings(patch);
    if (patch.superUser?.debugMode !== undefined) {
      getDebugLogService().setEnabled(next.superUser.debugMode);
      await getDebugLogService().log("info", "settings", "Debug mode setting changed.", {
        enabled: next.superUser.debugMode
      });
    }
    if (patch.superUser?.sessionInactivityMinutes !== undefined) {
      const idleMs = sessionInactivityMinutesToMs(next.superUser.sessionInactivityMinutes);
      const kernel = await getSecurityKernel();
      kernel.setSessionIdleTimeoutMs(idleMs);
      event.sender.send("security:idle-timeout-changed", idleMs);
      await getDebugLogService().log("info", "security", "Session inactivity policy changed.", {
        minutes: next.superUser.sessionInactivityMinutes
      });
    }
    applyConcurrency();
    return next;
  });
  ipcMain.handle("settings:reset", async (event) => {
    await assertSenderPermission(event, Permission.SETTINGS_EDIT);
    await assertSenderPermission(event, Permission.DEBUG_MODE_MANAGE);
    await assertSenderPermission(event, Permission.SESSION_POLICY_MANAGE);
    const next = await resetUiSettings();
    getDebugLogService().setEnabled(next.superUser.debugMode);
    const kernel = await getSecurityKernel();
    kernel.setSessionIdleTimeoutMs(sessionInactivityMinutesToMs(next.superUser.sessionInactivityMinutes));
    event.sender.send("security:idle-timeout-changed", sessionInactivityMinutesToMs(next.superUser.sessionInactivityMinutes));
    applyConcurrency();
    return next;
  });
  ipcMain.handle("settings:clearUiState", async (event) => {
    await assertSenderPermission(event, Permission.SETTINGS_EDIT);
    return clearUiState();
  });
  ipcMain.handle("settings:export", async (event) => {
    await assertSenderPermission(event, Permission.SETTINGS_EDIT);
    return getUiSettings();
  });
  ipcMain.handle("settings:import", async (event, incoming: unknown) => {
    await assertSenderPermission(event, Permission.SETTINGS_EDIT);
    await assertSenderPermission(event, Permission.DEBUG_MODE_MANAGE);
    await assertSenderPermission(event, Permission.SESSION_POLICY_MANAGE);
    const next = await replaceUiSettings(incoming);
    getDebugLogService().setEnabled(next.superUser.debugMode);
    const kernel = await getSecurityKernel();
    kernel.setSessionIdleTimeoutMs(sessionInactivityMinutesToMs(next.superUser.sessionInactivityMinutes));
    event.sender.send("security:idle-timeout-changed", sessionInactivityMinutesToMs(next.superUser.sessionInactivityMinutes));
    applyConcurrency();
    return next;
  });
  ipcMain.handle("settings:validate", async (event) => {
    await assertSenderPermission(event, Permission.PAGE_SETTINGS);
    return validateSettings(await getUiSettings());
  });

  ipcMain.handle("settings:getDefaultPaths", async (event) => {
    await assertSenderPermission(event, Permission.PAGE_SETTINGS);
    return getDefaultPaths();
  });
  ipcMain.handle("settings:detectInstalledChrome", async (event, configuredPath?: string) => {
    await assertSenderSuperUser(event, Permission.SETTINGS_EDIT, {
      audit: { eventType: "INSTALLED_CHROME_DETECTION_DENIED", channel: "settings:detectInstalledChrome" }
    });
    return new InstalledChromeResolver().resolve(configuredPath);
  });
  ipcMain.handle("settings:openRuntimeFolder", async (event) => {
    await assertSenderPermission(event, Permission.SETTINGS_EDIT);
    return shell.openPath(getRuntimeDataRoot());
  });

  ipcMain.handle("settings:getStorageStats", async (event) => {
    await assertSenderPermission(event, Permission.PAGE_SETTINGS);
    const [flows, workflows, dataSources, reports] = await Promise.all([
      countSafe(() => createFlowProfileStore().list()),
      countSafe(() => createWorkflowProfileStore().list()),
      countSafe(() => createDataSourceProfileStore().list()),
      countSafe(() => createReportStore().list())
    ]);
    return {
      appVersion: app.getVersion(),
      runtimeDataRoot: getRuntimeDataRoot(),
      productionOffline: isProductionOffline(),
      flows,
      workflows,
      dataSources,
      reports
    };
  });

  ipcMain.handle("settings:validatePaths", async (event) => {
    await assertSenderPermission(event, Permission.PAGE_SETTINGS);
    const { paths } = await getUiSettings();
    const entries = await Promise.all(
      Object.entries(paths).map(async ([key, value]) => [key, await checkPath(value)] as const)
    );
    return Object.fromEntries(entries) as Record<keyof UiSettings["paths"], Awaited<ReturnType<typeof checkPath>>>;
  });
}
