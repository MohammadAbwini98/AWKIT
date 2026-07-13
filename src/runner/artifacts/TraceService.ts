/**
 * Failure-path Playwright trace capture. Tracing is started once per browser context and each
 * step runs inside a trace *chunk*: failed steps save their chunk to
 * `<traceDir>/<stepId>-<timestamp>.zip`; successful steps discard theirs, so success runs write
 * nothing to disk. Active only when the engine provides a traces directory AND the mode allows
 * it (`AWKIT_TRACE_MODE`: `onFailure` (default) | `always` | `off`) — direct PlaywrightRunner
 * users (verify scripts) see zero overhead.
 *
 * Every method is best-effort: trace problems are logged and never mask the automation failure.
 * Concurrent isolated parallel branches share one context tracing session, so only one chunk can
 * be open at a time — overlapping steps simply skip tracing.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserContext } from "playwright";
import { loadArtifactProfile, resolveArtifactSettings } from "./ArtifactProfile";

export type TraceMode = "off" | "onFailure" | "always";

export function loadTraceMode(): TraceMode {
  const raw = (process.env.AWKIT_TRACE_MODE ?? "").toLowerCase();
  if (raw === "off" || raw === "always") return raw;
  if (raw === "onfailure") return "onFailure";
  // Unset/unrecognized: defer to the Phase A9 artifact profile (default "balanced" → onFailure, so the
  // historical default is unchanged). AWKIT_TRACE_MODE, when set, always wins above.
  return resolveArtifactSettings(loadArtifactProfile()).traceMode;
}

export class TraceService {
  private context?: BrowserContext;
  private tracingStarted = false;
  private chunkOpen = false;

  constructor(
    private readonly traceDir: string | undefined,
    private readonly mode: TraceMode = loadTraceMode(),
    private readonly warn: (message: string) => void = (message) => console.warn(`[trace] ${message}`)
  ) {}

  get enabled(): boolean {
    return this.mode !== "off" && !!this.traceDir;
  }

  /** Start tracing on a (new) context — called at launch and after every mid-run browser swap. */
  async attach(context: BrowserContext): Promise<void> {
    if (!this.enabled) return;
    this.context = context;
    this.tracingStarted = false;
    this.chunkOpen = false;
    try {
      await context.tracing.start({ screenshots: true, snapshots: true });
      this.tracingStarted = true;
    } catch (error) {
      this.warn(`could not start tracing: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Open a chunk for one step. Returns false when tracing is unavailable or a chunk is open. */
  async beginStep(): Promise<boolean> {
    if (!this.enabled || !this.tracingStarted || this.chunkOpen || !this.context) return false;
    try {
      await this.context.tracing.startChunk();
      this.chunkOpen = true;
      return true;
    } catch (error) {
      this.warn(`could not start trace chunk: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Close the step's chunk. Saves a zip when the step failed (or mode is `always`) and returns
   * its path; otherwise discards. Never throws.
   */
  async endStep(stepId: string, failed: boolean): Promise<string | undefined> {
    if (!this.chunkOpen || !this.context) return undefined;
    this.chunkOpen = false;
    const save = failed || this.mode === "always";
    try {
      if (!save) {
        await this.context.tracing.stopChunk();
        return undefined;
      }
      await mkdir(this.traceDir!, { recursive: true });
      const safeStepId = stepId.replace(/[^\w.-]+/g, "_");
      const path = join(this.traceDir!, `${safeStepId}-${Date.now()}.zip`);
      await this.context.tracing.stopChunk({ path });
      return path;
    } catch (error) {
      this.warn(`could not save trace for step ${stepId}: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }
}
