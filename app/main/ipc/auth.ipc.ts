import { ipcMain, shell } from "electron";
import { oauthHandoffService } from "@src/auth/OAuthHandoffService";

export function registerAuthIpc(): void {
  ipcMain.handle("auth:getCapabilities", async () => oauthHandoffService.getCapabilities());

  ipcMain.handle("auth:openOAuth", async (_, provider: string) => {
    const url = oauthHandoffService.getAuthorizeUrl(provider);
    if (!url) return { success: false, error: "OAuth is not configured for this project." };
    await shell.openExternal(url);
    return { success: true };
  });

  ipcMain.handle("auth:openExternal", async (_, url: string) => {
    if (!/^https?:\/\//i.test(url ?? "")) return { success: false, error: "Only http(s) URLs can be opened externally." };
    await shell.openExternal(url);
    return { success: true };
  });
}
