import type { IpcMainInvokeEvent } from "electron";

/**
 * Defense-in-depth (audit F-09): confirm a privileged IPC call originates from AWKIT's own
 * renderer bundle rather than an unexpected frame/origin. Paired with the `will-navigate`
 * lockdown in `windowManager.ts` (F-06), the app renderer can only ever be the trusted bundle,
 * so this simply rejects anything that is neither the dev server nor the packaged file bundle.
 */
export function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? "";
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl && url.startsWith(rendererUrl)) return true; // dev server
  if (url.startsWith("file://")) return true; // packaged bundle (loadFile)
  // Electron can report an empty frame URL very early in load; treat that as the trusted shell.
  return url === "";
}

/** Throws when the IPC sender is not the trusted app renderer. Use on privileged handlers. */
export function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!isTrustedSender(event)) {
    throw new Error("Rejected privileged IPC call from an untrusted sender frame.");
  }
}
