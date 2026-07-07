import { readFile } from "node:fs/promises";

export interface DependencyManifest {
  schema?: {
    name: string;
    version: number;
    sourceTemplate: string;
  };
  application: {
    name: string;
    version: string;
    buildMode: string;
    builtAt: string;
  };
  offline: {
    internetRequired: boolean;
    runtimeDownloadsAllowed: boolean;
    adminPermissionRequired: boolean;
    globalNodeRequired: boolean;
    globalPlaywrightRequired: boolean;
    globalBrowserRequired: boolean;
  };
  runtime: {
    electronIncluded: boolean;
    nodeRuntimeIncluded: boolean;
    productionNodeModulesIncluded: boolean;
    nativeModulesIncluded: boolean;
    nativeModulesRequired?: boolean;
    playwrightRuntimeIncluded?: boolean;
    /** sql.js (WASM SQLite) powers the durable runtime store — required since Phase 4. */
    sqlJsRuntimeIncluded?: boolean;
    sqlJsWasmIncluded?: boolean;
  };
  browsers: Array<{
    name: string;
    included: boolean;
    relativeExecutablePath: string;
    version: string;
    validated: boolean;
  }>;
  paths: Record<string, string>;
  validation: Record<string, boolean>;
  startupChecklist?: Record<string, boolean>;
  dependencies: Record<string, string>;
}

export async function loadDependencyManifest(path: string): Promise<DependencyManifest | null> {
  try {
    const content = await readFile(path, "utf8");
    // Strip a leading UTF-8 BOM — PowerShell can write one, and JSON.parse throws on it.
    return JSON.parse(content.replace(/^﻿/, "")) as DependencyManifest;
  } catch {
    return null;
  }
}

export function validateDependencyManifestPolicy(manifest: DependencyManifest | null): string[] {
  if (!manifest) return ["Dependency manifest is missing or invalid JSON."];

  const issues: string[] = [];
  const requiredTopLevelSections = ["application", "offline", "runtime", "browsers", "paths", "validation", "startupChecklist", "dependencies"];
  const requiredRuntimeFlags = ["electronIncluded", "nodeRuntimeIncluded", "productionNodeModulesIncluded", "nativeModulesIncluded"];
  const requiredValidationFlags = [
    "bundledBrowserExists",
    "browserLaunchTestPassed",
    "profileStorageWritable",
    "runtimeFoldersWritable",
    "noRuntimeDownloadsDetected",
    "noAdminPathRequired"
  ];
  const requiredPaths = ["runtimeDataRoot", "flows", "workflows", "scenarios", "instances", "data", "downloads", "screenshots", "logs", "reports"];

  for (const section of requiredTopLevelSections) {
    if (!(section in manifest)) issues.push(`Manifest is missing required section: ${section}.`);
  }

  if (manifest.application?.name !== "WebFlow Studio") issues.push("Manifest application name must be WebFlow Studio.");
  if (!manifest.application?.version) issues.push("Manifest application version is required.");
  if (!manifest.application?.buildMode) issues.push("Manifest build mode is required.");
  if (!manifest.application?.builtAt) issues.push("Manifest build timestamp is required.");

  if (manifest.offline?.internetRequired) issues.push("Manifest must not require internet access.");
  if (manifest.offline?.runtimeDownloadsAllowed) issues.push("Manifest must not allow runtime downloads.");
  if (manifest.offline?.adminPermissionRequired) issues.push("Manifest must not require admin permission.");
  if (manifest.offline?.globalNodeRequired) issues.push("Manifest must not require global Node.js.");
  if (manifest.offline?.globalPlaywrightRequired) issues.push("Manifest must not require global Playwright.");
  if (manifest.offline?.globalBrowserRequired) issues.push("Manifest must not require a global browser.");

  for (const flag of requiredRuntimeFlags) {
    if (manifest.runtime?.[flag as keyof DependencyManifest["runtime"]] !== true) {
      issues.push(`Manifest runtime flag must be true: ${flag}.`);
    }
  }

  if (manifest.runtime?.playwrightRuntimeIncluded !== true) {
    issues.push("Manifest must confirm Playwright runtime files are included.");
  }

  if (manifest.runtime?.sqlJsRuntimeIncluded !== true || manifest.runtime?.sqlJsWasmIncluded !== true) {
    issues.push("Manifest must confirm the sql.js runtime and its WASM asset are included.");
  }

  if (!manifest.browsers?.some((browser) => browser.name === "chromium" && browser.relativeExecutablePath === "resources/browsers/chromium/chrome.exe")) {
    issues.push("Manifest must include bundled Chromium at resources/browsers/chromium/chrome.exe.");
  }

  for (const pathKey of requiredPaths) {
    const value = manifest.paths?.[pathKey];
    if (!value?.startsWith("%LOCALAPPDATA%/WebFlow Studio")) {
      issues.push(`Manifest path must use the user profile runtime root: ${pathKey}.`);
    }
  }

  for (const flag of requiredValidationFlags) {
    if (typeof manifest.validation?.[flag] !== "boolean") {
      issues.push(`Manifest validation flag is required: ${flag}.`);
    }
  }

  if (manifest.validation?.noRuntimeDownloadsDetected !== true) issues.push("Manifest validation must confirm no runtime downloads.");
  if (manifest.validation?.noAdminPathRequired !== true) issues.push("Manifest validation must confirm no admin path is required.");

  return issues;
}
