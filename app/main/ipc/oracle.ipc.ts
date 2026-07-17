import { ipcMain } from "electron";
import { assertTrustedSender } from "./senderGuard";
import {
  deleteOracleDataSource,
  getOracleDataSource,
  getOracleServices,
  listOracleDataSources,
  oracleAvailability,
  refreshOracleDataSourceSnapshot,
  saveOracleDataSource,
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
}
