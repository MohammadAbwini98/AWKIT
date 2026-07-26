import { ipcMain } from "electron";
import { getSecretStore, type SecretSummary } from "../secretStore";
import { assertSenderPermission } from "../security/sessionContext";
import { Permission } from "@src/security/authz/Permissions";

/**
 * Secret-store IPC (audit §15). The renderer can manage secrets BY NAME only — `secrets:set`
 * accepts a plaintext value to encrypt but no channel ever returns a decrypted value. Every
 * Reads require Settings-page access; writes require Settings edit. The renderer's hidden route is
 * only a UX hint — every operation is bound to the authenticated sender in the main process.
 */
export function registerSecretsIpc(): void {
  ipcMain.handle("secrets:isAvailable", async (event): Promise<boolean> => {
    await assertSenderPermission(event, Permission.PAGE_SETTINGS);
    return getSecretStore().isAvailable();
  });
  ipcMain.handle("secrets:list", async (event): Promise<SecretSummary[]> => {
    await assertSenderPermission(event, Permission.PAGE_SETTINGS);
    return getSecretStore().list();
  });
  ipcMain.handle("secrets:set", async (event, name: string, value: string): Promise<SecretSummary[]> => {
    await assertSenderPermission(event, Permission.SETTINGS_EDIT);
    getSecretStore().set(name, value);
    return getSecretStore().list();
  });
  ipcMain.handle("secrets:delete", async (event, name: string): Promise<SecretSummary[]> => {
    await assertSenderPermission(event, Permission.SETTINGS_EDIT);
    getSecretStore().delete(name);
    return getSecretStore().list();
  });
}
