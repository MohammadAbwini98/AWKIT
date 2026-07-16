import { ipcMain } from "electron";
import { getSecretStore, type SecretSummary } from "../secretStore";

/**
 * Secret-store IPC (audit §15). The renderer can manage secrets BY NAME only — `secrets:set`
 * accepts a plaintext value to encrypt but no channel ever returns a decrypted value. Every
 * channel is additionally covered by the global sender guard (see ipc/index.ts).
 */
export function registerSecretsIpc(): void {
  ipcMain.handle("secrets:isAvailable", async (): Promise<boolean> => getSecretStore().isAvailable());
  ipcMain.handle("secrets:list", async (): Promise<SecretSummary[]> => getSecretStore().list());
  ipcMain.handle("secrets:set", async (_, name: string, value: string): Promise<SecretSummary[]> => {
    getSecretStore().set(name, value);
    return getSecretStore().list();
  });
  ipcMain.handle("secrets:delete", async (_, name: string): Promise<SecretSummary[]> => {
    getSecretStore().delete(name);
    return getSecretStore().list();
  });
}
