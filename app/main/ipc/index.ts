import { registerDataSourceIpc } from "./dataSource.ipc";
import { registerExecutionIpc } from "./execution.ipc";
import { registerFlowIpc } from "./flow.ipc";
import { registerInstanceIpc } from "./instance.ipc";
import { registerOfflineRuntimeIpc } from "./offlineRuntime.ipc";
import { registerReportIpc } from "./report.ipc";
import { registerRuntimeInputIpc } from "./runtimeInput.ipc";
import { registerScenarioIpc } from "./scenario.ipc";
import { registerSettingsIpc } from "./settings.ipc";
import { registerRecorderIpc } from "./recorder.ipc";
import { registerSystemIpc } from "./system.ipc";
import { registerAuthIpc } from "./auth.ipc";
import { registerSessionIpc } from "./session.ipc";
import { registerTelemetryIpc } from "./telemetry.ipc";
import { registerWindowIpc } from "./window.ipc";
import { registerSecretsIpc } from "./secrets.ipc";
import { registerOracleIpc } from "./oracle.ipc";
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { isTrustedSender } from "./senderGuard";

/**
 * Wrap every `ipcMain.handle` registration so a renderer→main call is rejected unless it originates
 * from AWKIT's own bundle (audit F-09, defense-in-depth). Installed once, before the register
 * functions run, so it covers every channel — not just the highest-privilege ones already guarded
 * explicitly. Paired with the `will-navigate` lockdown (F-06), the renderer can only ever be trusted.
 */
function installGlobalSenderGuard(): void {
  const originalHandle = ipcMain.handle.bind(ipcMain);
  (ipcMain as unknown as {
    handle: (channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => void;
  }).handle = (channel, listener) => {
    originalHandle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!isTrustedSender(event)) {
        throw new Error(`Rejected IPC "${channel}" from an untrusted sender frame.`);
      }
      return listener(event, ...args);
    });
  };
}

export function registerIpcHandlers(): void {
  installGlobalSenderGuard();
  registerWindowIpc();
  registerSystemIpc();
  registerAuthIpc();
  registerRecorderIpc();
  registerFlowIpc();
  registerScenarioIpc();
  registerExecutionIpc();
  registerInstanceIpc();
  registerDataSourceIpc();
  registerRuntimeInputIpc();
  registerReportIpc();
  registerTelemetryIpc();
  registerOfflineRuntimeIpc();
  registerSettingsIpc();
  registerSessionIpc();
  registerSecretsIpc();
  registerOracleIpc();
}
