import { access, mkdir, writeFile, rm } from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import { join } from "node:path";
import { BundledBrowserResolver } from "./BundledBrowserResolver";
import { loadDependencyManifest, validateDependencyManifestPolicy } from "./DependencyManifest";
import type { RuntimePaths } from "./PortablePathResolver";

export interface OfflineRuntimeCheck {
  key: string;
  label: string;
  ok: boolean;
  detail?: string;
}

export interface OfflineRuntimeStatus {
  productionOffline: boolean;
  internetRequired: boolean;
  runtimeDownloadsAllowed: boolean;
  bundledBrowserPath: string;
  bundledBrowserExists: boolean;
  resourcesRoot: string;
  runtimeDataRoot: string;
  checks: OfflineRuntimeCheck[];
}

export interface OfflineRuntimeValidatorOptions {
  productionOffline: boolean;
  allowRuntimeDownloads: boolean;
  resourcesRoot: string;
  runtimePaths: RuntimePaths;
  manifestPath?: string;
  offlineManifestPath?: string;
}

export class OfflineRuntimeValidator {
  async validate(options: OfflineRuntimeValidatorOptions): Promise<OfflineRuntimeStatus> {
    const browser = new BundledBrowserResolver(options.resourcesRoot).resolveChromium();
    const manifestPath = options.manifestPath ?? join(options.resourcesRoot, "dependency-manifest.json");
    const offlineManifestPath = options.offlineManifestPath ?? join(options.resourcesRoot, "offline-runtime.json");
    const manifest = await loadDependencyManifest(manifestPath);
    const manifestPolicyIssues = validateDependencyManifestPolicy(manifest);
    const offlineManifestExists = existsSync(offlineManifestPath);
    const rootWritable = await this.canWrite(options.runtimePaths.root);
    const playwrightRuntimeExists = this.playwrightRuntimeExists();
    const nativeModulesOk = manifest?.runtime.nativeModulesIncluded ?? false;
    const folderChecks = await Promise.all(
      Object.entries(options.runtimePaths.folders).map(async ([key, folder]) => ({
        key: `folder.${key}`,
        label: `${key} folder writable`,
        ok: await this.canWrite(folder),
        detail: folder
      }))
    );

    return {
      productionOffline: options.productionOffline,
      internetRequired: false,
      runtimeDownloadsAllowed: options.allowRuntimeDownloads,
      bundledBrowserPath: browser.executablePath,
      bundledBrowserExists: browser.exists,
      resourcesRoot: options.resourcesRoot,
      runtimeDataRoot: options.runtimePaths.root,
      checks: [
        {
          key: "manifest",
          label: "Dependency manifest",
          ok: manifest !== null && manifestPolicyIssues.length === 0,
          detail: manifestPolicyIssues.length ? manifestPolicyIssues.join(" ") : manifestPath
        },
        {
          key: "offlineManifest",
          label: "Offline runtime manifest",
          ok: offlineManifestExists,
          detail: offlineManifestExists ? offlineManifestPath : `Missing: ${offlineManifestPath}`
        },
        {
          key: "playwrightRuntime",
          label: "Playwright runtime files",
          ok: playwrightRuntimeExists,
          detail: playwrightRuntimeExists ? "Playwright runtime is available." : "node_modules/playwright and playwright-core are required before packaging."
        },
        {
          key: "nativeModules",
          label: "Native modules",
          ok: options.productionOffline ? nativeModulesOk : true,
          detail: nativeModulesOk ? "Native modules marked included." : "No native modules are currently bundled."
        },
        {
          key: "bundledBrowser",
          label: "Bundled Chromium browser",
          ok: options.productionOffline ? browser.exists : true,
          detail: browser.exists ? browser.executablePath : "Required for production offline builds"
        },
        {
          key: "runtimeDownloads",
          label: "Runtime downloads disabled",
          ok: !options.allowRuntimeDownloads
        },
        {
          key: "runtimeRoot",
          label: "Runtime data root writable",
          ok: rootWritable,
          detail: options.runtimePaths.root
        },
        ...folderChecks
      ]
    };
  }

  private playwrightRuntimeExists(): boolean {
    // Check both the development layout (cwd/node_modules) and packaged layouts
    // where electron-builder places production modules (asar-unpacked or app dir).
    const roots = [join(process.cwd(), "node_modules")];
    if (process.resourcesPath) {
      roots.push(join(process.resourcesPath, "app.asar.unpacked", "node_modules"));
      roots.push(join(process.resourcesPath, "app", "node_modules"));
    }
    return roots.some((root) => existsSync(join(root, "playwright")) && existsSync(join(root, "playwright-core")));
  }

  private async canWrite(path: string): Promise<boolean> {
    try {
      await mkdir(path, { recursive: true });
      await access(path, constants.W_OK);
      const probePath = join(path, ".write-test");
      await writeFile(probePath, "ok", "utf8");
      await rm(probePath, { force: true });
      return true;
    } catch {
      return false;
    }
  }
}
