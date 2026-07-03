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

export function registerIpcHandlers(): void {
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
  registerOfflineRuntimeIpc();
  registerSettingsIpc();
  registerSessionIpc();
}
