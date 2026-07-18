import { BrowserWindow, dialog, ipcMain } from "electron";
import { assertTrustedSender } from "./senderGuard";
import {
  addJavaRuntime,
  deleteOracleDataSource,
  getJavaRuntime,
  getJavaRuntimeUsage,
  getOracleDataSource,
  getOracleDriverBundle,
  getOracleDriverBundleUsage,
  getOracleServices,
  importOracleDriverBundle,
  listJavaRuntimes,
  listOracleDataSources,
  listOracleDriverBundles,
  oracleAvailability,
  refreshOracleDataSourceSnapshot,
  removeJavaRuntime,
  removeOracleDriverBundle,
  saveOracleDataSource,
  setDefaultJavaRuntime,
  setDefaultOracleDriverBundle,
  testJavaRuntimeBridge,
  testOracleDriverBundleLoad,
  validateJavaRuntime,
  validateOracleDriverBundle,
  type OracleDataSourceInput
} from "../oracleService";
import type { OracleProfileInput } from "@src/oracle/OracleProfileService";

/**
 * IPC surface for Oracle connection profiles + test-connection. Renderer channels return only
 * credential-free views (`hasPassword`/`hasTrustStoreSecret`, never a value). Mutating channels
 * additionally assert a trusted sender (defense in depth on top of the global guard).
 */
export function registerOracleIpc(): void {
  ipcMain.handle("oracle:availability", async () => oracleAvailability());

  ipcMain.handle("oracle:profiles:list", async () => getOracleServices().profiles.list());
  ipcMain.handle("oracle:profiles:get", async (_event, id: string) => getOracleServices().profiles.get(id));

  ipcMain.handle("oracle:profiles:save", async (event, input: OracleProfileInput) => {
    assertTrustedSender(event);
    return getOracleServices().profiles.save(input);
  });
  ipcMain.handle("oracle:profiles:delete", async (event, id: string) => {
    assertTrustedSender(event);
    return getOracleServices().profiles.delete(id);
  });

  ipcMain.handle("oracle:profiles:test", async (event, id: string) => {
    assertTrustedSender(event);
    return getOracleServices().profiles.testConnection(id);
  });
  ipcMain.handle("oracle:profiles:testDraft", async (event, input: OracleProfileInput) => {
    assertTrustedSender(event);
    return getOracleServices().profiles.testProfileDraft(input);
  });

  // ── Oracle Data Sources (stored in the shared data-sources folder as a union type) ──────────────
  ipcMain.handle("oracle:dataSources:list", async () => listOracleDataSources());
  ipcMain.handle("oracle:dataSources:get", async (_event, id: string) => getOracleDataSource(id));

  ipcMain.handle("oracle:dataSources:save", async (event, input: OracleDataSourceInput) => {
    assertTrustedSender(event);
    return saveOracleDataSource(input);
  });
  ipcMain.handle("oracle:dataSources:delete", async (event, id: string) => {
    assertTrustedSender(event);
    return deleteOracleDataSource(id);
  });
  ipcMain.handle("oracle:dataSources:refreshSnapshot", async (event, id: string) => {
    assertTrustedSender(event);
    return refreshOracleDataSourceSnapshot(id);
  });

  // ── Managed Oracle JDBC driver bundles (Phases 05–07) ────────────────────────────────────────────
  ipcMain.handle("oracle:drivers:list", async () => listOracleDriverBundles());
  ipcMain.handle("oracle:drivers:get", async (_event, id: string) => getOracleDriverBundle(id));
  ipcMain.handle("oracle:drivers:usage", async (_event, id: string) => getOracleDriverBundleUsage(id));

  // Import opens a native file dialog in the main process — imported JARs are executable code and are
  // load-tested in an isolated Java bridge before being copied into managed storage. The renderer must
  // have already shown the security warning + explicit confirmation (it passes { name }).
  ipcMain.handle("oracle:drivers:import", async (event, input: { name: string }) => {
    assertTrustedSender(event);
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const picked = await dialog.showOpenDialog(win!, {
      title: "Select Oracle JDBC driver jar(s)",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Java Archives", extensions: ["jar"] }]
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;
    return importOracleDriverBundle({ name: input.name, sourceFiles: picked.filePaths });
  });

  ipcMain.handle("oracle:drivers:validate", async (event, id: string) => {
    assertTrustedSender(event);
    return validateOracleDriverBundle(id);
  });
  ipcMain.handle("oracle:drivers:setDefault", async (event, id: string) => {
    assertTrustedSender(event);
    return setDefaultOracleDriverBundle(id);
  });
  ipcMain.handle("oracle:drivers:remove", async (event, id: string) => {
    assertTrustedSender(event);
    return removeOracleDriverBundle(id);
  });
  ipcMain.handle("oracle:drivers:testLoad", async (event, id: string) => {
    assertTrustedSender(event);
    return testOracleDriverBundleLoad(id);
  });

  // ── User-selected Java runtimes (WS-B). The runtime is an EXTERNAL install — Specter records only a
  // path + metadata and never copies or loads Java classes in-process. `java -version` and the bridge
  // handshake run in an isolated child process. Add opens a native file/dir dialog in main.
  ipcMain.handle("oracle:java:list", async () => listJavaRuntimes());
  ipcMain.handle("oracle:java:get", async (_event, id: string) => getJavaRuntime(id));
  ipcMain.handle("oracle:java:usage", async (_event, id: string) => getJavaRuntimeUsage(id));

  ipcMain.handle("oracle:java:addExe", async (event, input: { name: string }) => {
    assertTrustedSender(event);
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const picked = await dialog.showOpenDialog(win!, {
      title: "Select a Java executable (java.exe)",
      properties: ["openFile"],
      filters: process.platform === "win32" ? [{ name: "Java executable", extensions: ["exe"] }] : []
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;
    return addJavaRuntime({ name: input.name, selectedPath: picked.filePaths[0] });
  });

  ipcMain.handle("oracle:java:addDir", async (event, input: { name: string }) => {
    assertTrustedSender(event);
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const picked = await dialog.showOpenDialog(win!, {
      title: "Select a JRE/JDK directory",
      properties: ["openDirectory"]
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;
    return addJavaRuntime({ name: input.name, selectedPath: picked.filePaths[0] });
  });

  ipcMain.handle("oracle:java:validate", async (event, id: string) => {
    assertTrustedSender(event);
    return validateJavaRuntime(id);
  });
  ipcMain.handle("oracle:java:setDefault", async (event, id: string) => {
    assertTrustedSender(event);
    return setDefaultJavaRuntime(id);
  });
  ipcMain.handle("oracle:java:remove", async (event, id: string) => {
    assertTrustedSender(event);
    return removeJavaRuntime(id);
  });
  ipcMain.handle("oracle:java:testBridge", async (event, id: string, driverBundleId?: string) => {
    assertTrustedSender(event);
    return testJavaRuntimeBridge(id, driverBundleId);
  });
}
