/**
 * Health / degraded-state model for the optional semantic subsystem (plan §21.1).
 *
 * Two rules are baked in rather than left to the future IPC layer:
 *
 *  1. **Physical paths are privileged.** `buildSemanticHealth` only emits `indexPath` when the
 *     caller explicitly asks for it, so the default shape is safe to hand to any surface. Phase 0
 *     found empirically that vendor errors embed absolute paths, so leaking a path is a realistic
 *     mistake rather than a hypothetical one.
 *  2. **"Unavailable" is not one state.** Not-included-in-this-build, never-started, degraded after
 *     a failure, and circuit-open are operationally different and get distinct reasons, because
 *     "semantic search is off" with no explanation is unactionable for a user or a support engineer.
 *
 * Framework-agnostic: no Electron, no filesystem.
 */

import type { ZvecHostReasonCode } from "./ZvecHostProtocol";

/** Why semantic capability is unavailable. Null when it is available. */
export type SemanticDegradedReason =
  /** The optional native host was not included in this build. */
  | "NOT_INCLUDED"
  /** Included, but the user has disabled semantic features. */
  | "DISABLED_BY_SETTING"
  /** Host present but never started (normal before the first semantic operation). */
  | "NOT_STARTED"
  /** Host asset missing, unreadable, or incompatible. */
  | "HOST_UNAVAILABLE"
  /** Repeated crashes tripped the circuit breaker for this session. */
  | "CIRCUIT_OPEN"
  /** Started but a previous operation failed; it will retry on the next call. */
  | "DEGRADED_AFTER_FAILURE"
  /** The index needs a rebuild before it can serve queries. */
  | "REBUILD_REQUIRED"
  /**
   * The active pointer governs, so the index is usable, but derived metadata could not be brought
   * into agreement with it. Surfaced rather than hidden: silently serving from a knowingly stale
   * metadata document is how a subtle inconsistency becomes invisible.
   */
  | "METADATA_REPAIR_FAILED";

/**
 * Three states, not two.
 *
 * A lazily-started host that simply has not been needed yet is NOT unavailable — reporting it as
 * such would make product UI show a warning for the entirely normal case of "nobody has searched
 * yet". `availableOnDemand` means the host will start on first use.
 */
export type SemanticCapability = "available" | "availableOnDemand" | "unavailable";

export interface SemanticHealth {
  capability: SemanticCapability;
  /**
   * Null when capability is "available". For "availableOnDemand" it carries NOT_STARTED as
   * information, not as a fault. Non-null and actionable only for "unavailable".
   */
  degradedReason: SemanticDegradedReason | null;
  /** Human-facing, path-free sentence safe to show in any surface. */
  summary: string;
  /** True when the native host shipped in this build at all. */
  included: boolean;
  hostState: string;
  /** Unexpected host exits inside the current restart window. */
  unexpectedExits: number;
  circuitOpen: boolean;
  /** Last stable reason code seen from the host, never a raw native message. */
  lastReasonCode: ZvecHostReasonCode | null;
  activeGeneration: string | null;
  /** Populated only when the caller is privileged; otherwise omitted entirely. */
  indexPath?: string;
  /** Whether the previous session ended cleanly; false means reconciliation ran. */
  previousShutdownClean: boolean;
  reclaimedBytesOnStartup: number;
}

export interface SemanticHealthInput {
  included: boolean;
  enabledBySetting: boolean;
  hostState: string;
  circuitOpen: boolean;
  unexpectedExits: number;
  lastReasonCode: ZvecHostReasonCode | null;
  activeGeneration: string | null;
  previousShutdownClean: boolean;
  reclaimedBytesOnStartup: number;
  rebuildRequired?: boolean;
  /** A startup metadata repair failed; the pointer still governs. */
  metadataRepairFailed?: boolean;
  /** Absolute index path. Included in the output ONLY when `includePaths` is true. */
  indexPath?: string;
  /** Caller is authorised to see filesystem locations (administrator surfaces only). */
  includePaths?: boolean;
}

const SUMMARIES: Record<SemanticDegradedReason, string> = {
  NOT_INCLUDED: "Semantic search is not included in this build.",
  DISABLED_BY_SETTING: "Semantic search is turned off in Settings.",
  NOT_STARTED: "Semantic search is idle and will start on first use.",
  HOST_UNAVAILABLE: "Semantic search is unavailable because its local engine could not be loaded.",
  CIRCUIT_OPEN: "Semantic search is paused after repeated engine failures. Run a health check or rebuild to re-enable it.",
  DEGRADED_AFTER_FAILURE: "Semantic search had a recent failure and will retry on the next request.",
  REBUILD_REQUIRED: "Semantic search needs its index rebuilt before it can answer queries.",
  METADATA_REPAIR_FAILED: "Semantic search is running, but its index bookkeeping could not be updated. A rebuild will restore it."
};

/**
 * Derive the health view. Order matters: the checks run from most fundamental
 * ("did it even ship?") to most transient ("did the last call fail?"), so the reason reported is the
 * one a user can actually act on rather than a downstream symptom.
 */
export function buildSemanticHealth(input: SemanticHealthInput): SemanticHealth {
  const base = {
    included: input.included,
    hostState: input.hostState,
    unexpectedExits: input.unexpectedExits,
    circuitOpen: input.circuitOpen,
    lastReasonCode: input.lastReasonCode,
    activeGeneration: input.activeGeneration,
    previousShutdownClean: input.previousShutdownClean,
    reclaimedBytesOnStartup: input.reclaimedBytesOnStartup
  };

  const withPath = (health: SemanticHealth): SemanticHealth =>
    input.includePaths && input.indexPath ? { ...health, indexPath: input.indexPath } : health;

  const degraded = (reason: SemanticDegradedReason): SemanticHealth =>
    withPath({ ...base, capability: "unavailable", degradedReason: reason, summary: SUMMARIES[reason] });

  // Idle-but-ready. Distinguished from "unavailable" so no surface warns about a host that has
  // simply not been needed yet.
  const onDemand = (): SemanticHealth =>
    withPath({ ...base, capability: "availableOnDemand", degradedReason: "NOT_STARTED", summary: SUMMARIES.NOT_STARTED });

  if (!input.included) return degraded("NOT_INCLUDED");
  if (!input.enabledBySetting) return degraded("DISABLED_BY_SETTING");
  if (input.circuitOpen) return degraded("CIRCUIT_OPEN");
  if (input.rebuildRequired) return degraded("REBUILD_REQUIRED");
  // Reported after the hard blockers but before host state: the host may be perfectly healthy while
  // its bookkeeping is stale, and that is still worth telling someone about.
  if (input.metadataRepairFailed) return degraded("METADATA_REPAIR_FAILED");

  switch (input.hostState) {
    case "ready":
      return withPath({ ...base, capability: "available", degradedReason: null, summary: "Semantic search is available." });
    case "degraded":
      return degraded("DEGRADED_AFTER_FAILURE");
    case "failedOpen":
      return degraded("CIRCUIT_OPEN");
    case "disabled":
      return degraded("DISABLED_BY_SETTING");
    case "stopped":
    case "starting":
    case "stopping":
      return onDemand();
    default:
      return degraded("HOST_UNAVAILABLE");
  }
}
