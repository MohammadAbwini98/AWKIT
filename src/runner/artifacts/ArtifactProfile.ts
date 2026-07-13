/**
 * Artifact capture profiles (Concurrency Capacity plan — Phase A9).
 *
 * Formalizes the existing trace + failure-screenshot knobs into four named profiles so a run can trade
 * diagnostics for cost with one setting instead of several env vars:
 *
 *   - `production` — no traces; failure screenshots only (leanest).
 *   - `balanced`   — traces on failure; failure screenshots (TODAY'S DEFAULT — unchanged behaviour).
 *   - `debug`      — traces always; failure screenshots.
 *   - `full`       — traces always; failure screenshots; video.
 *
 * `AWKIT_TRACE_MODE`, when explicitly set, still wins over the profile's trace mode (back-compat). Pure —
 * no I/O. See docs/ai/CONCURRENCY_CAPACITY_AND_REPORTS_PLAN.md §A9.
 */
import type { TraceMode } from "./TraceService";

export type ArtifactProfile = "production" | "balanced" | "debug" | "full";

export interface ArtifactSettings {
  traceMode: TraceMode;
  /** Capture a screenshot when a step fails. */
  screenshotOnFailure: boolean;
  /** Record video for the run (only `full` today; wiring is a follow-up). */
  video: boolean;
}

export function resolveArtifactSettings(profile: ArtifactProfile): ArtifactSettings {
  switch (profile) {
    case "production":
      return { traceMode: "off", screenshotOnFailure: true, video: false };
    case "debug":
      return { traceMode: "always", screenshotOnFailure: true, video: false };
    case "full":
      return { traceMode: "always", screenshotOnFailure: true, video: true };
    case "balanced":
    default:
      return { traceMode: "onFailure", screenshotOnFailure: true, video: false };
  }
}

export function parseArtifactProfile(raw: string | undefined): ArtifactProfile {
  const v = (raw ?? "").toLowerCase().trim();
  if (v === "production" || v === "debug" || v === "full") return v;
  return "balanced";
}

/** Effective artifact profile from environment (offline-safe). Default `balanced` == today's behaviour. */
export function loadArtifactProfile(env: NodeJS.ProcessEnv = process.env): ArtifactProfile {
  return parseArtifactProfile(env.AWKIT_ARTIFACT_PROFILE);
}
