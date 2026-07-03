export function assertRuntimeDownloadsDisabled(allowRuntimeDownloads: boolean): void {
  if (allowRuntimeDownloads) {
    throw new Error("Runtime downloads are disabled by the offline production policy.");
  }
}
