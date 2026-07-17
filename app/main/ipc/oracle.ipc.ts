import { BrowserWindow, dialog, ipcMain } from "electron";
import { assertTrustedSender } from "./senderGuard";
import {
  deleteOracleDataSource,
  getOracleDataSource,
  getOracleDriverBundle,
  getOracleDriverBundleUsage,
  getOracleServices,
  importOracleDriverBundle,
  listOracleDataSources,
  listOracleDriverBundles,
  oracleAvailability,
  refreshOracleDataSourceSnapshot,
  removeOracleDriverBundle,
  saveOracleDataSource,
  setDefaultOracleDriverBundle,
  testOracleDriverBundleLoad,
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
}
