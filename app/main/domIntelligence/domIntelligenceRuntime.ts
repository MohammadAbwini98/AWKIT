/**
 * Main-process owner of the L11 DOM-intelligence provider (awkit-djnl.19, plan E4/E5).
 *
 * One provider per app process. Application start never starts the host. Since L12 a real run or a
 * recorder session prewarms it in the background (`prewarmDomIntelligence`), otherwise the first request
 * starts it (a runner repair suggestion after a refused recovery, an Element Spy or Designer diagnosis, or an
 * AI normalization). Normal steps never wait on it. It is stopped on quit (and exits by itself on stdin EOF
 * if main dies first).
 *
 * The runtime is the staged tree (`scripts/prepare-dom-intelligence-host.mjs`): packaged at
 * `resources/native-hosts/dom-intelligence`, in development at `build/native-hosts/dom-intelligence`.
 * Absent, disabled, corrupt or incompatible, it is a status and the product behaves as without it.
 * `AWKIT_DOM_INTELLIGENCE=off` is the operator kill switch.
 */

import fs from "node:fs";
import path from "node:path";

import { app } from "electron";

import {
  NoopDomIntelligenceProvider,
  type DomIntelligenceProvider,
  type DomIntelligenceRecoveryOptions,
  type DomIntelligenceStatus
} from "@src/runner/domIntelligence/DomIntelligenceProvider";
import { DOM_REFERENCE_FOLDER, FileDomReferenceStore } from "@src/runner/domIntelligence/domReference";
import { ScraplingDomIntelligenceProvider, scraplingHostLaunch, type ScraplingHostLaunch } from "@src/runner/domIntelligence/ScraplingDomIntelligenceProvider";

import { getRuntimePaths } from "../appPaths";

const MANIFEST = "dom-intelligence-host-manifest.json";

let provider: DomIntelligenceProvider | undefined;
let references: FileDomReferenceStore | undefined;

/** The staged runtime root for this build, or null when it does not ship. */
export function domIntelligenceRuntimeRoot(): string | null {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, "native-hosts", "dom-intelligence")
    : path.join(app.getAppPath(), "build", "native-hosts", "dom-intelligence");
  return fs.existsSync(path.join(root, MANIFEST)) ? root : null;
}

/** The launch for a staged runtime whose manifest names the expected entries, else undefined. */
export function resolveDomIntelligenceLaunch(root = domIntelligenceRuntimeRoot()): ScraplingHostLaunch | undefined {
  if (!root) return undefined;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, MANIFEST), "utf8")) as {
      schema?: { name?: string; version?: number };
      pythonEntry?: string;
      hostEntry?: string;
    };
    if (manifest.schema?.name !== "awkit-dom-intelligence-host-manifest" || manifest.schema.version !== 1) return undefined;
    if (manifest.pythonEntry !== "python/python.exe" || manifest.hostEntry !== "host/dom_intelligence_host.py") return undefined;
    const python = path.join(root, "python", "python.exe");
    const host = path.join(root, "host", "dom_intelligence_host.py");
    return fs.existsSync(python) && fs.existsSync(host) ? scraplingHostLaunch(python, host, root) : undefined;
  } catch {
    return undefined;
  }
}

export function isDomIntelligenceDisabled(): boolean {
  return /^(off|0|false|disabled)$/i.test(process.env.AWKIT_DOM_INTELLIGENCE ?? "");
}

/** The process-wide provider: Scrapling when shipped and not disabled, otherwise the no-op provider. */
export function getDomIntelligenceProvider(): DomIntelligenceProvider {
  if (provider) return provider;
  if (isDomIntelligenceDisabled()) {
    provider = new NoopDomIntelligenceProvider("DISABLED", "DOM intelligence is turned off (AWKIT_DOM_INTELLIGENCE=off).");
  } else if (!domIntelligenceRuntimeRoot()) {
    provider = new NoopDomIntelligenceProvider("UNAVAILABLE", "The DOM-intelligence runtime is not part of this build.");
  } else {
    provider = new ScraplingDomIntelligenceProvider({ launch: () => resolveDomIntelligenceLaunch() });
  }
  return provider;
}

export function getDomReferenceStore(): FileDomReferenceStore {
  references ??= new FileDomReferenceStore(path.join(getRuntimePaths().root, DOM_REFERENCE_FOLDER));
  return references;
}

/** What the runner needs for non-executing repair suggestions and reference refresh. */
export function domIntelligenceRecoveryOptions(): DomIntelligenceRecoveryOptions {
  return { provider: getDomIntelligenceProvider(), references: getDomReferenceStore() };
}

export async function domIntelligenceStatus(): Promise<DomIntelligenceStatus> {
  return getDomIntelligenceProvider().getStatus();
}

/**
 * L12.1 (awkit-djnl.21.1): start the host in the background when a run or a recorder session starts, so
 * the first failed lookup does not pay the cold start (about 1 s). Never awaited and never fatal: an absent,
 * disabled or broken runtime answers its status without spawning anything, and an unused host still stops
 * itself after the provider's idle timeout.
 */
export function prewarmDomIntelligence(): void {
  void getDomIntelligenceProvider()
    .getStatus()
    .catch(() => undefined);
}

export async function shutdownDomIntelligence(): Promise<void> {
  const current = provider;
  provider = undefined;
  await current?.shutdown().catch(() => undefined);
}
