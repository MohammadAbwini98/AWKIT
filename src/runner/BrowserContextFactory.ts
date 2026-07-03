import { mkdir } from "node:fs/promises";
import type { Browser, BrowserContext, BrowserType, LaunchOptions } from "playwright";
import { chromium } from "playwright";
import { BundledBrowserResolver } from "@src/offline/BundledBrowserResolver";
import type { InstanceConfig } from "@src/instances/InstanceConfig";
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
      const persistentContext = await browserType.launchPersistentContext(config.userDataDir, {
        ...launchOptions,
        acceptDownloads: true,
        viewport: config.viewport
      });

      return {
        context: persistentContext,
        close: () => persistentContext.close()
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

  private createLaunchOptions(config: InstanceConfig): LaunchOptions {
    const launchOptions: LaunchOptions = {
      headless: config.headless,
      timeout: config.timeoutMs
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
