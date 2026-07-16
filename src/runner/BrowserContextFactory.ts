import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, BrowserContext, BrowserType, LaunchOptions } from "playwright";
import { chromium } from "playwright";
import { BundledBrowserResolver } from "@src/offline/BundledBrowserResolver";
import { buildChromiumHardeningArgs } from "./ChromiumHardening";
import type { LaunchArgOverrides } from "./browserProfile/BrowserRuntimeConfigurationResolver";
import type { InstanceConfig } from "@src/instances/InstanceConfig";
import { globalProfileLocks, type ProfileLease } from "@src/profiles/ProfileLockManager";
import type { InstanceExecutionContext } from "./InstanceExecutionContext";
import type { SharedBrowserPool, SharedBrowserLauncher } from "./browser/SharedBrowserPool";
import { sharedCompatibilityKey } from "./browser/browserSharing";
import type { OperationLimiters } from "./concurrency/OperationLimiters";
import {
  loadResourceRoutingConfig,
  installResourceRouting,
  resolveContextOptions,
  type ResourceRoutingConfig
} from "./ResourceRoutingPolicy";

export interface BrowserContextFactoryOptions {
  productionOffline: boolean;
  resourcesRoot: string;
  /**
   * Phase A5 (experimental): when provided, `browserContext`-isolation instances lease an isolated
   * context from this shared Chromium pool instead of launching a dedicated browser. The engine only
   * supplies it for shared-eligible instances (see browserSharing.isSharedEligible).
   */
  sharedBrowserPool?: SharedBrowserPool;
  /** Phase A6: staggers simultaneous browser launches / context creations across all instances. */
  operationLimiters?: OperationLimiters;
  /**
   * Phase A9: resource-reduction routing (Normal / Lean / Ultra-Lean). When omitted it is loaded from
   * the environment (default Normal → no behaviour change). Applies request aborts + deterministic
   * context options to every context this factory creates.
   */
  resourceRouting?: ResourceRoutingConfig;
  /**
   * Browser Resource Optimization: launch-argument deltas from the resolved profile — extra Chromium
   * switches (gpu/webgl/cache) plus the specific Playwright default switches to drop for background
   * throttling. When omitted, launch args are exactly today's hardened defaults.
   */
  launchArgOverrides?: LaunchArgOverrides;
}

export interface BrowserRuntime {
  browser?: Browser;
  context: BrowserContext;
  close: () => Promise<void>;
}

/**
 * Close an isolated context and then its owning browser, guaranteeing the browser is closed even
 * when `context.close()` rejects (e.g. the target already crashed). Without the `finally`, a throwing
 * context close would skip `browser.close()` and orphan the Chromium process inside the long-running
 * Electron host. The original context error still propagates; a failing browser close is swallowed so
 * it can't mask that root cause.
 */
export async function closeIsolatedRuntime(
  context: Pick<BrowserContext, "close">,
  browser: Pick<Browser, "close">
): Promise<void> {
  try {
    await context.close();
  } finally {
    await browser.close().catch(() => undefined);
  }
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
  /** Resolved once so every context this factory creates shares one profile (env-loaded when unset). */
  private readonly resourceRouting: ResourceRoutingConfig;

  constructor(private readonly options: BrowserContextFactoryOptions) {
    this.resourceRouting = options.resourceRouting ?? loadResourceRoutingConfig();
  }

  /** Run an expensive browser op under its operation limiter (A6), or directly when none is wired. */
  private limit<T>(kind: "browserLaunch" | "contextCreation", fn: () => Promise<T>): Promise<T> {
    return this.options.operationLimiters ? this.options.operationLimiters.run(kind, fn) : fn();
  }

  /**
   * Shared `newContext` / `launchPersistentContext` options for one instance, folding the Phase A9
   * resource profile in (download opt-out, blocked service workers, reduced motion, fixed device-scale).
   * Under the Normal profile this is just `{ acceptDownloads: true, viewport }` (unchanged). `storageState`
   * is added separately at the isolated-context sites — it is not valid for a persistent profile.
   */
  private buildContextOptions(config: InstanceConfig): {
    acceptDownloads: boolean;
    viewport: InstanceConfig["viewport"];
    serviceWorkers?: "allow" | "block";
    reducedMotion?: "reduce" | "no-preference";
    deviceScaleFactor?: number;
  } {
    const routing = resolveContextOptions(this.resourceRouting);
    return {
      acceptDownloads: routing.acceptDownloads,
      viewport: config.viewport,
      serviceWorkers: routing.serviceWorkers,
      reducedMotion: routing.reducedMotion,
      deviceScaleFactor: routing.deviceScaleFactor
    };
  }

  /** Install the Phase A9 request routing on a freshly created context (no-op under Normal). */
  private applyResourceRouting(context: BrowserContext): Promise<void> {
    return installResourceRouting(context, this.resourceRouting).catch((error) => {
      console.warn(`[resource-routing] failed to install (continuing without): ${error instanceof Error ? error.message : String(error)}`);
    });
  }

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
        persistentContext = await this.limit("browserLaunch", () =>
          browserType.launchPersistentContext(config.userDataDir!, {
            ...launchOptions,
            ...this.buildContextOptions(config)
          })
        );
        await this.applyResourceRouting(persistentContext);
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

    // Phase A5: shared-eligible instances lease an isolated context on a pooled (shared) browser so many
    // instances share a few Chromium processes. Closing the runtime closes only the context; the shared
    // browser stays alive for reuse and is recycled/drained by the pool.
    const sharedPool = this.options.sharedBrowserPool;
    if (sharedPool) {
      const launcher: SharedBrowserLauncher = {
        // Only browsers with an identical browser-LEVEL launch config may share a Chromium process. The
        // key folds in the resolved launch-arg deltas so a low-resource/custom-profile instance can never
        // reuse a browser launched with different flags (context-level options stay isolated per context).
        launchKey: sharedCompatibilityKey(config, this.options.launchArgOverrides),
        launch: () => this.limit("browserLaunch", () => browserType.launch(launchOptions)),
        newContext: (browser) =>
          this.limit("contextCreation", () =>
            browser.newContext({ ...this.buildContextOptions(config), storageState: config.storageState })
          )
      };
      const lease = await sharedPool.acquireContext(launcher);
      await this.applyResourceRouting(lease.context);
      return {
        browser: lease.browser,
        context: lease.context,
        close: async () => {
          await lease.release();
        }
      };
    }

    const browser = await this.limit("browserLaunch", () => browserType.launch(launchOptions));
    const isolatedContext = await this.limit("contextCreation", () =>
      browser.newContext({ ...this.buildContextOptions(config), storageState: config.storageState })
    );
    await this.applyResourceRouting(isolatedContext);

    return {
      browser,
      context: isolatedContext,
      close: async () => {
        await closeIsolatedRuntime(isolatedContext, browser);
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
    const overrides = this.options.launchArgOverrides;
    const launchOptions: LaunchOptions = {
      headless: config.headless,
      timeout: config.timeoutMs,
      // No-egress hardening (Phase 5.1C): suppress Chromium background service calls
      // (time/variations/component updates). Page-level networking is untouched. The Browser Resource
      // Optimization profile may append switches (gpu/webgl/cache) and, for the low-resource profile,
      // re-enable background throttling (omit the throttle pin here + drop Playwright's copy via
      // ignoreDefaultArgs below). When no overrides are supplied this is exactly today's arg set.
      args: [
        ...buildChromiumHardeningArgs(process.env, {
          omitBackgroundTimerThrottlePin: overrides?.omitBackgroundTimerThrottlePin
        }),
        ...(overrides?.add ?? [])
      ],
      // Embedded in a long-running Electron host: let the runner own the browser lifecycle so a
      // host-process signal (or a sibling browser being torn down during a mid-run swap) can't
      // reap the freshly launched browser out from under the next step.
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false
    };

    // Selectively drop specific Playwright default switches (never `ignoreDefaultArgs: true`) — used
    // only to re-enable Chromium's normal background throttling under the low-resource profile.
    if (overrides && overrides.ignoreDefaultArgs.length > 0) {
      launchOptions.ignoreDefaultArgs = overrides.ignoreDefaultArgs;
    }

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
