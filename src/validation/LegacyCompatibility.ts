/**
 * Legacy Compatibility — the pure policy core (Tranche 2, Stage 2c).
 *
 * Stage 2c completes the staged enforcement model from the design doc
 * (`docs/plans/FLOW_VALIDATION_ENGINE_DESIGN.md`, owner decision 3):
 *
 *  - **Active-path errors block immediately, for every flow.** Nothing here can override that.
 *  - **Off-path errors now block too** (the "full gate" — Stage 2b's universal off-path tolerance
 *    was an explicit interim posture), UNLESS the flow holds a valid **Legacy Compatibility
 *    grant**: an explicit, time-limited, audited exemption issued by the inventory scan to flows
 *    that already existed — unchanged — when enforcement arrived.
 *  - A grant is bound to the flow's **content hash**. The moment the executable content (nodes,
 *    edges, version) changes, the grant no longer matches and the flow is in the modern regime.
 *    Renaming a flow or editing its description does not void the grant — those cannot alter
 *    execution.
 *  - A grant **expires**. After the deadline the flow blocks like any other until repaired.
 *  - The runtime never trusts the grant alone: validation always runs fresh, and the grant only
 *    widens tolerance for off-path errors found *now*.
 *
 * This module is pure (no Electron, no Node built-ins, no I/O): the main process owns grant
 * storage and feeds records in; the renderer feeds the same records to derive identical verdicts.
 *
 * Nothing here mutates a flow. Suggested fixes live in `SafeFixApplier.ts`.
 */
import type { FlowProfile } from "../profiles/FlowProfile";
import {
  activePathErrorsOf,
  errorsOf,
  isExecutionBlocking,
  type FlowValidationIssue,
  type FlowValidationReport
} from "./FlowValidator";

/**
 * Engine + policy version. Bump when a rule is added/changed or the blocking policy shifts, so
 * grants and scan reports record which validator produced them. Version 3 = Stage 2c
 * (1 = Stage 2a engine, 2 = Stage 2b gate wiring).
 */
export const FLOW_VALIDATOR_VERSION = 3;

/** How long a Legacy Compatibility grant lasts, from the moment the inventory scan issues it. */
export const LEGACY_COMPATIBILITY_WINDOW_DAYS = 30;

/* ------------------------------------------------------------------ *
 * Content hash
 * ------------------------------------------------------------------ */

/** Recursively sort object keys so semantically identical JSON hashes identically. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) sorted[key] = canonicalize(entry);
    }
    return sorted;
  }
  return value;
}

/**
 * Fingerprint of a flow's **executable** content: nodes, edges and schema version — not name,
 * description or timestamps, which cannot change what runs. FNV-1a over canonical JSON: this is a
 * change detector, not a security primitive, and it must stay pure (`src/` allows no Node
 * built-ins, so `node:crypto` is off the table).
 */
export function flowContentHash(profile: FlowProfile): string {
  const canonical = JSON.stringify(
    canonicalize({ version: profile.version, nodes: profile.nodes ?? [], edges: profile.edges ?? [] })
  );
  // 64-bit FNV-1a via two 32-bit lanes (JS bitwise ops are 32-bit).
  let hi = 0x811c9dc5;
  let lo = 0xcbf29ce4;
  for (let index = 0; index < canonical.length; index += 1) {
    const code = canonical.charCodeAt(index);
    lo ^= code & 0xff;
    lo = (lo * 0x01000193) >>> 0;
    hi ^= (code >>> 8) ^ (lo & 0xff);
    hi = (hi * 0x01000193) >>> 0;
  }
  return `${hi.toString(16).padStart(8, "0")}${lo.toString(16).padStart(8, "0")}`;
}

/* ------------------------------------------------------------------ *
 * Grants
 * ------------------------------------------------------------------ */

/** A persisted Legacy Compatibility grant. `id` doubles as the flow id (one grant per flow). */
export interface CompatibilityGrant {
  /** Flow id (record key). */
  id: string;
  /** Content hash of the flow at grant time — a mismatch means the flow was edited. */
  contentHash: string;
  grantedAt: string;
  expiresAt: string;
  /** Validator version that issued the grant. */
  validatorVersion: number;
  /** Issue codes present at grant time (diagnostics — the gate always re-validates). */
  issueCodes: string[];
  /** Audit: how many real runs have executed under this grant. */
  runsUnderCompatibility: number;
  lastRunAt?: string;
  /** Set when the grant ended before expiry, with why ("edited" | "repaired"). */
  revokedAt?: string;
  revokedReason?: string;
}

export type CompatibilityStanding =
  /** Valid grant: unexpired, unrevoked, content unchanged. Off-path errors are tolerated. */
  | "granted"
  | "expired"
  /** The flow's executable content no longer matches the grant. */
  | "edited"
  | "revoked"
  /** No grant exists for this flow. */
  | "none";

/** Evaluate a grant against the flow's CURRENT content at a given moment. Pure. */
export function compatibilityStanding(
  grant: CompatibilityGrant | undefined,
  currentContentHash: string,
  nowIso: string
): CompatibilityStanding {
  if (!grant) return "none";
  if (grant.revokedAt) return "revoked";
  if (grant.contentHash !== currentContentHash) return "edited";
  if (nowIso >= grant.expiresAt) return "expired";
  return "granted";
}

/* ------------------------------------------------------------------ *
 * The Stage 2c blocking policy
 * ------------------------------------------------------------------ */

export interface EffectiveValidationVerdict {
  /** Issues that block execution under the full Stage 2c policy. */
  readonly blockingIssues: readonly FlowValidationIssue[];
  readonly blocked: boolean;
  /** Whether a valid grant is actively tolerating off-path errors right now. */
  readonly underCompatibility: boolean;
  readonly standing: CompatibilityStanding;
  /** Off-path errors currently tolerated by the grant (empty unless `underCompatibility`). */
  readonly toleratedIssues: readonly FlowValidationIssue[];
}

/**
 * The one Stage 2c verdict function, shared by the run gate, the designer, the builder and the
 * library so no surface can disagree:
 *
 *  - blocking = active-path errors + connector-structure errors (the Stage 2b floor, which no
 *    grant can override) **plus** every other error unless a valid grant tolerates it.
 *  - `underCompatibility` is true only when the grant is valid AND it is actually excusing at
 *    least one off-path error — a grant on a now-clean flow exempts nothing.
 */
export function effectiveVerdict(
  report: FlowValidationReport,
  grant: CompatibilityGrant | undefined,
  currentContentHash: string,
  nowIso: string
): EffectiveValidationVerdict {
  const floor = report.issues.filter(isExecutionBlocking);
  const offPathErrors = errorsOf(report).filter((issue) => !isExecutionBlocking(issue));
  const standing = compatibilityStanding(grant, currentContentHash, nowIso);
  const tolerates = standing === "granted" && floor.length === 0;

  const blockingIssues = tolerates ? floor : [...floor, ...offPathErrors];
  return {
    blockingIssues,
    blocked: blockingIssues.length > 0,
    underCompatibility: tolerates && offPathErrors.length > 0,
    standing,
    toleratedIssues: tolerates ? offPathErrors : []
  };
}

/* ------------------------------------------------------------------ *
 * Inventory classification & grant planning
 * ------------------------------------------------------------------ */

export type InventoryClassification =
  /** Active-path/structural errors — blocked for everyone, compatibility cannot apply. */
  | "immediately-blocked"
  /** Only off-path errors — eligible to run under a time-limited grant. */
  | "temporarily-compatible"
  | "valid"
  /**
   * The validator rejects a flow whose exact current content completed a successful run after its
   * last edit — a signal the rejection may be a validator false-positive. Grouped for human
   * review instead of silently blocking or silently tolerating.
   */
  | "possible-validator-defect";

export interface InventoryEntry {
  readonly flowId: string;
  readonly flowName: string;
  readonly classification: InventoryClassification;
  readonly contentHash: string;
  readonly errorCount: number;
  readonly blockingCount: number;
  readonly offPathErrorCount: number;
  readonly warningCount: number;
  readonly issueCodes: readonly string[];
}

export interface InventoryContext {
  /**
   * Whether this flow completed a successful run more recently than its last content change.
   * Supplied by the caller from durable run history; absent means "unknown", never "no".
   */
  readonly ranSuccessfullySinceLastEdit?: (flowId: string) => boolean;
}

/** Classify one flow for the inventory report. Pure. */
export function classifyForInventory(
  profile: FlowProfile,
  report: FlowValidationReport,
  context: InventoryContext = {}
): InventoryEntry {
  const errors = errorsOf(report);
  const blocking = report.issues.filter(isExecutionBlocking);
  const offPath = errors.filter((issue) => !isExecutionBlocking(issue));
  const warnings = report.issues.length - errors.length;

  let classification: InventoryClassification;
  if (errors.length === 0) {
    classification = "valid";
  } else if (context.ranSuccessfullySinceLastEdit?.(profile.id) === true) {
    // The validator says broken; recorded reality says this exact content ran to success.
    classification = "possible-validator-defect";
  } else if (blocking.length > 0) {
    classification = "immediately-blocked";
  } else {
    classification = "temporarily-compatible";
  }

  return {
    flowId: profile.id,
    flowName: profile.name,
    classification,
    contentHash: flowContentHash(profile),
    errorCount: errors.length,
    blockingCount: blocking.length,
    offPathErrorCount: offPath.length,
    warningCount: warnings,
    issueCodes: [...new Set(report.issues.map((issue) => issue.code))]
  };
}

export interface GrantPlan {
  /** New grants to persist (flows newly eligible, no usable prior grant). */
  readonly issue: readonly CompatibilityGrant[];
  /** Existing grants to mark revoked because the flow was repaired (now valid). */
  readonly revokeRepaired: readonly CompatibilityGrant[];
}

/**
 * Decide which grants an inventory scan should issue, given what already exists. Pure. Rules:
 *
 *  - Only `temporarily-compatible` flows are eligible. `possible-validator-defect` flows are NOT
 *    silently granted — they are for human review (their off-path-only subset would be eligible on
 *    the next scan after review; their blocked subset never is).
 *  - One grant per flow, ever, per content: an existing grant for the same content is kept as-is
 *    (never extended — the deadline is the deadline). An expired or edited-content grant is not
 *    replaced; the flow is in the modern regime.
 *  - A grant whose flow is now `valid` is revoked as "repaired" (audit trail, not deletion).
 */
export function planGrants(
  entries: readonly InventoryEntry[],
  existingGrants: ReadonlyMap<string, CompatibilityGrant>,
  nowIso: string
): GrantPlan {
  const issue: CompatibilityGrant[] = [];
  const revokeRepaired: CompatibilityGrant[] = [];
  const expires = new Date(new Date(nowIso).getTime() + LEGACY_COMPATIBILITY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  for (const entry of entries) {
    const existing = existingGrants.get(entry.flowId);

    if (entry.classification === "temporarily-compatible") {
      if (existing) continue; // Keep the original grant and deadline — standing is evaluated at gate time.
      issue.push({
        id: entry.flowId,
        contentHash: entry.contentHash,
        grantedAt: nowIso,
        expiresAt: expires,
        validatorVersion: FLOW_VALIDATOR_VERSION,
        issueCodes: [...entry.issueCodes],
        runsUnderCompatibility: 0
      });
      continue;
    }

    if (entry.classification === "valid" && existing && !existing.revokedAt) {
      revokeRepaired.push({ ...existing, revokedAt: nowIso, revokedReason: "repaired" });
    }
  }

  return { issue, revokeRepaired };
}
