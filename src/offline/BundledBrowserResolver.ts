import { existsSync } from "node:fs";
import { join } from "node:path";

export interface BundledBrowserResolution {
  type: "chromium";
  executablePath: string;
  exists: boolean;
}

export class BundledBrowserResolver {
  constructor(private readonly resourcesRoot: string) {}

  resolveChromium(): BundledBrowserResolution {
    const executablePath = join(this.resourcesRoot, "browsers", "chromium", "chrome.exe");

    return {
      type: "chromium",
      executablePath,
      exists: existsSync(executablePath)
    };
  }
}
