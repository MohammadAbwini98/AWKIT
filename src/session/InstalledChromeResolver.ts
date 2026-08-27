import { access, stat } from "node:fs/promises";
import { basename, normalize, resolve } from "node:path";

export type InstalledChromeResolution =
  | { available: true; executablePath: string; source: "configured" | "discovered" }
  | { available: false; code: "CHROME_UNAVAILABLE" | "CHROME_EXECUTABLE_INVALID"; message: string };

/**
 * Resolve locally installed Google Chrome without a runtime download or a single hardcoded location.
 * A configured override is authoritative: invalid means explicit failure, never silent substitution.
 */
export class InstalledChromeResolver {
  constructor(private readonly environment: NodeJS.ProcessEnv = process.env) {}

  async resolve(configuredPath?: string): Promise<InstalledChromeResolution> {
    const configured = configuredPath?.trim();
    if (configured) {
      return (await this.isChromeExecutable(configured))
        ? { available: true, executablePath: resolve(configured), source: "configured" }
        : {
            available: false,
            code: "CHROME_EXECUTABLE_INVALID",
            message: "The configured Google Chrome executable is invalid or unavailable."
          };
    }

    for (const candidate of this.candidates()) {
      if (await this.isChromeExecutable(candidate)) {
        return { available: true, executablePath: resolve(candidate), source: "discovered" };
      }
    }
    return {
      available: false,
      code: "CHROME_UNAVAILABLE",
      message: "Google Chrome is not installed in a supported location. Configure chrome.exe explicitly or use bundled Chromium."
    };
  }

  private candidates(): string[] {
    const suffix = "Google/Chrome/Application/chrome.exe";
    return Array.from(new Set([
      this.environment.PROGRAMFILES,
      this.environment["PROGRAMFILES(X86)"],
      this.environment.LOCALAPPDATA
    ].filter((root): root is string => Boolean(root)).map((root) => normalize(`${root}/${suffix}`))));
  }

  private async isChromeExecutable(path: string): Promise<boolean> {
    if (basename(path).toLowerCase() !== "chrome.exe") return false;
    try {
      await access(path);
      return (await stat(path)).isFile();
    } catch {
      return false;
    }
  }
}
