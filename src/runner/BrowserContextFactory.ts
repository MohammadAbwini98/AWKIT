import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, BrowserContext, BrowserType, LaunchOptions } from "playwright";
import { chromium } from "playwright";
import { BundledBrowserResolver } from "@src/offline/BundledBrowserResolver";
import { buildChromiumHardeningArgs } from "./ChromiumHardening";
import type { InstanceConfig } from "@src/instances/InstanceConfig";
import { globalProfileLocks, type ProfileLease } from "@src/profiles/ProfileLockManager";
import type { InstanceExecutionContext } from "./InstanceExecutionContext";

export interface BrowserContextFactoryOptions {
  productionOffline: boolean;
  resourcesRoot: string;
}

export interface BrowserRuntime {
  browser?: Browser;
  context: BrowserContext;
  close: () => Promise<void>;
}

export class PersistentProfileInUseError extends Error {
  constructor(userDataDir: string, artifacts: string[]) {
    super(
      `The saved session profile is currently in use by another browser process. ` +
        `Close the manual login browser window, then run the workflow again. ` +
        `(profile: ${userDataDir}; lock: ${artifacts.join(", ")})`
    );
    this.name = "PersistentProfileInUseError";
  }
}

export class BrowserContextFactory {
  constructor(private readonly options: BrowserContextFactoryOptions) {}

  getIsolationDescription(mode: "browserContext" | "persistentContext"): string {
    return mode === "persistentContext" ? "Separate persistent user data directory" : "Isolated browser context";
  }

  async create(config: InstanceConfig, context: InstanceExecutionContext): Promise<BrowserRuntime> {
    const browserType = this.resolveBrowserType(config.browser);
    const launchOptions = this.createLaunchOptions(config);

    await Promise.all([mkdir(context.paths.downloads, { recursive: true }), mkdir(context.paths.screenshots, { recursive: true })]);

    if (config.isolationMode === "persistentContext") {
      if (!config.userDataDir) throw new Error(`Persistent context for ${config.id} requires userDataDir.`);
      await mkdir(config.userDataDir, { recursive: true });

      // Exclusive profile lock — in-process AND durable cross-process (when the engine has
      // configured the durable lock store): two active runtimes, even in two AWKIT app
      // instances, must never share one userDataDir. Held for the runtime's lifetime; released
      // in close() below. Chrome's on-disk Singleton* artifacts (checked next) additionally
      // cover external non-AWKIT browser processes.
      const ownerId = context.instanceId || config.id;
      const profileLease: ProfileLease = await globalProfileLocks.acquireDurable(ownerId, config.userDataDir, `instance ${ownerId}`);

      let persistentContext: BrowserContext;
      try {
        await this.assertPersistentProfileAvailable(config.userDataDir);
        persistentContext = await browserType.launchPersistentContext(config.userDataDir, {
          ...launchOptions,
          acceptDownloads: true,
          viewport: config.viewport
        });
      } catch (error) {
        profileLease.release();
        throw error;
      }

      return {
        context: persistentContext,
        close: async () => {
          try {
            await persistentContext.close();
          } finally {
            profileLease.release();
          }
        }
      };
    }

    const browser = await browserType.launch(launchOptions);
    const isolatedContext = await browser.newContext({
      acceptDownloads: true,
      viewport: config.viewport,
      storageState: config.storageState
    });

    return {
      browser,
      context: isolatedContext,
      close: async () => {
        await isolatedContext.close();
        await browser.close();
      }
    };
  }

  /** Fail before launch when a captured profile still appears to be open in Chrome/Edge. */
  private async assertPersistentProfileAvailable(userDataDir: string): Promise<void> {
    const lockArtifacts = ["SingletonLock", "SingletonCookie", "SingletonSocket", "lockfile"];
    const present: string[] = [];
    for (const name of lockArtifacts) {
      const path = join(userDataDir, name);
      if (await access(path).then(() => true).catch(() => false)) present.push(name);
    }
    if (present.length > 0) throw new PersistentProfileInUseError(userDataDir, present);
  }

  private createLaunchOptions(config: InstanceConfig): LaunchOptions {
    const launchOptions: LaunchOptions = {
      headless: config.headless,
      timeout: config.timeoutMs,
      // No-egress hardening (Phase 5.1C): suppress Chromium background service calls
      // (time/variations/component updates). Page-level networking is untouched.
      args: buildChromiumHardeningArgs(),
      // Embedded in a long-running Electron host: let the runner own the browser lifecycle so a
      // host-process signal (or a sibling browser being torn down during a mid-run swap) can't
      // reap the freshly launched browser out from under the next step.
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false
    };

    if (this.options.productionOffline) {
      const bundledBrowser = new BundledBrowserResolver(this.options.resourcesRoot).resolveChromium();
      if (!bundledBrowser.exists) {
        throw new Error(`Bundled Chromium is required for production offline mode: ${bundledBrowser.executablePath}`);
      }
      launchOptions.executablePath = bundledBrowser.executablePath;
      console.log(`[offline] Runner using bundled Chromium: ${bundledBrowser.executablePath}`);
    }
    return launchOptions;
  }

  private resolveBrowserType(browser: InstanceConfig["browser"]): BrowserType {
    if (browser === "chromium") return chromium;
    throw new Error(`Unsupported browser type: ${browser}`);
  }
}
