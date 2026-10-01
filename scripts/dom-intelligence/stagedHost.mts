/**
 * The parser-only DOM-intelligence host, staged for a verifier or benchmark exactly as packaging stages it:
 * scripts/prepare-dom-intelligence-host.mjs from the pinned `.cache/dom-intelligence` inputs into a temp
 * dir OUTSIDE the repository. `undefined` when the pinned inputs are absent: callers report NOT RUN, never
 * a pass on an unstaged runtime. The staging and sandbox contract itself is verify:dom-intelligence-host's.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { ScraplingDomIntelligenceProvider, scraplingHostLaunch } from "@src/runner/domIntelligence/ScraplingDomIntelligenceProvider";

const ROOT = resolve(".");

export interface StagedHost {
  root: string;
  python: string;
  hostScript: string;
  stageMs: number;
  /** A fresh provider over the staged host (each owns its own child process). */
  provider: () => ScraplingDomIntelligenceProvider;
  cleanup: () => void;
}

export function pinnedInputsPresent(): boolean {
  const pin = JSON.parse(readFileSync(join(ROOT, "src/offline/dom-intelligence-runtime.json"), "utf8")) as { python: { archive: string }; wheels: Array<{ file: string }> };
  return existsSync(join(ROOT, ".cache/dom-intelligence", pin.python.archive)) && pin.wheels.every((wheel) => existsSync(join(ROOT, ".cache/dom-intelligence/wheels", wheel.file)));
}

export function stageHost(prefix = "awkit-dom-intel-"): StagedHost | undefined {
  if (!pinnedInputsPresent()) return undefined;
  const work = mkdtempSync(join(tmpdir(), prefix));
  const staged = join(work, "dom-intelligence");
  const started = performance.now();
  const run = spawnSync(process.execPath, ["scripts/prepare-dom-intelligence-host.mjs", "--out", staged], { encoding: "utf8", windowsHide: true, timeout: 300_000 });
  if (run.status !== 0) {
    rmSync(work, { recursive: true, force: true });
    throw new Error(`staging failed: ${(run.stderr || run.stdout).trim().slice(-600)}`);
  }
  const python = join(staged, "python/python.exe");
  const hostScript = join(staged, "host/dom_intelligence_host.py");
  return {
    root: staged,
    python,
    hostScript,
    stageMs: performance.now() - started,
    provider: () => new ScraplingDomIntelligenceProvider({ launch: () => scraplingHostLaunch(python, hostScript) }),
    cleanup: () => rmSync(work, { recursive: true, force: true })
  };
}
