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
 * Content digest
 *
 * A grant changes EXECUTION ELIGIBILITY, so its binding to a flow's content must be
 * collision-resistant: anything weaker means a crafted flow could inherit another's exemption.
 * The digest is therefore SHA-256 — but `src/` may not import Node built-ins (`src/AGENTS.md`), so
 * this module owns only the *deterministic canonical form*, and the digest itself is computed at a
 * trusted boundary (`app/main/validation/contentDigest.ts`) and passed back in.
 * ------------------------------------------------------------------ */

/** Recursively sort object keys so semantically identical JSON canonicalizes identically. */
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
 * The exact byte string a flow's digest is taken over: its **executable** content — schema version,
 * nodes and edges. Deliberately excludes name, description and timestamps, which cannot change what
 * runs, so renaming a flow or editing its description keeps a grant alive.
 *
 * Deterministic: object keys are sorted recursively and `undefined` properties are dropped, so two
 * semantically identical profiles always produce identical bytes regardless of key order or how
 * they were deserialized. **Array order is preserved** — node and connector order is meaningful.
 */
export function canonicalFlowContent(profile: FlowProfile): string {
  return JSON.stringify(
    canonicalize({
      version: profile.version,
      nodes: Array.isArray(profile.nodes) ? profile.nodes : [],
      edges: Array.isArray(profile.edges) ? profile.edges : []
    })
  );
}

/** Computes a flow's content digest. Supplied by the trusted boundary that owns SHA-256. */
export type FlowContentDigest = (profile: FlowProfile) => string;

/** Algorithm tag every current digest carries, so an older format is self-identifying. */
export const DIGEST_PREFIX = "sha256:";

const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

/**
 * Whether a stored digest is in the current, collision-resistant format.
 *
 * Records written before this hardening carry an unprefixed 64-bit FNV-1a value. Those are treated
 * as `legacyDigest` — never honored, never migrated to a new digest, and never replaced by an
 * automatically-issued grant (which would silently restart the compatibility window).
 */
export function isCurrentDigest(value: string | undefined): boolean {
  return typeof value === "string" && SHA256_DIGEST_PATTERN.test(value);
}

/* ------------------------------------------------------------------ *
 * Grants
 * ------------------------------------------------------------------ */

/** A persisted Legacy Compatibility grant. `id` doubles as the flow id (one grant per flow). */
export interface CompatibilityGrant {
  /** Flow id (record key). */
  id: string;
  /**
   * `sha256:<64 hex>` digest of the flow's executable content at grant time — a mismatch means the
   * flow was edited. A value not in this format is a pre-hardening record: see {@link isCurrentDigest}.
   */
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
  /**
   * The grant predates the SHA-256 binding and is bound by a non-collision-resistant digest.
   * Never honored. Not an error state the user caused — reported distinctly so the UI can explain
   * that the flow must be repaired or re-assessed rather than implying it was edited.
   */
  | "legacyDigest"
  /** No grant exists for this flow. */
  | "none";

/**
 * Evaluate a grant against the flow's CURRENT content digest at a given moment. Pure.
 *
 * Order matters: the digest-format check comes FIRST, so a pre-hardening record can never be
 * compared byte-wise against a SHA-256 digest and reported as a mere "edit".
 *
 * `currentDigest` must be a current-format digest. An empty/absent digest (a caller that could not
 * compute one) fails closed: nothing is granted.
 */
export function compatibilityStanding(
  grant: CompatibilityGrant | undefined,
  currentDigest: string,
  nowIso: string
): CompatibilityStanding {
  if (!grant) return "none";
  if (grant.revokedAt) return "revoked";
  if (!isCurrentDigest(grant.contentHash)) return "legacyDigest";
  if (!isCurrentDigest(currentDigest)) return "legacyDigest"; // fail closed, never "granted"
  if (grant.contentHash !== currentDigest) return "edited";
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
  currentDigest: string,
  nowIso: string
): EffectiveValidationVerdict {
  const floor = report.issues.filter(isExecutionBlocking);
  const offPathErrors = errorsOf(report).filter((issue) => !isExecutionBlocking(issue));
  const standing = compatibilityStanding(grant, currentDigest, nowIso);
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
  /** Current-format (`sha256:…`) digest of the flow's executable content. */
  readonly contentDigest: string;
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

/**
 * Classify one flow for the inventory report. Pure — the SHA-256 digest is computed by the trusted
 * boundary and passed in.
 */
export function classifyForInventory(
  profile: FlowProfile,
  report: FlowValidationReport,
  contentDigest: string,
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
    contentDigest,
    errorCount: errors.length,
    blockingCount: blocking.length,
    offPathErrorCount: offPath.length,
    warningCount: warnings,
    issueCodes: [...new Set(report.issues.map((issue) => issue.code))]
  };
}

export interface GrantPlan {
  /** New grants to persist (flows newly eligible, no prior grant record at all). */
  readonly issue: readonly CompatibilityGrant[];
  /** Existing grants to mark revoked because the flow was repaired (now valid). */
  readonly revokeRepaired: readonly CompatibilityGrant[];
  /**
   * Pre-hardening grants to mark revoked because their digest format is no longer trusted. These
   * are **retired, not replaced**: no new grant is issued in their place, so a flow that relied on
   * one blocks until it is repaired or an operator makes a deliberate decision. Retiring rather
   * than deleting keeps the audit trail (who was tolerated, for what, until when).
   */
  readonly revokeLegacyDigest: readonly CompatibilityGrant[];
}

/**
 * Decide which grants an inventory scan should issue, given what already exists. Pure. Rules:
 *
 *  - Only `temporarily-compatible` flows are eligible. `possible-validator-defect` flows are NOT
 *    silently granted — they are for human review (their off-path-only subset would be eligible on
 *    the next scan after review; their blocked subset never is).
 *  - **One grant per flow, ever.** Any existing record — valid, expired, edited, revoked, or
 *    legacy-format — suppresses issuance. A deadline is set once and never extended, and a retired
 *    record can never be "refreshed" by re-running the scan.
 *  - A grant whose flow is now `valid` is revoked as `repaired`.
 *  - A grant in a pre-hardening digest format is revoked as `digestFormatRetired` and **not**
 *    replaced. Encountering an old format must never, by itself, produce a grant.
 */
export function planGrants(
  entries: readonly InventoryEntry[],
  existingGrants: ReadonlyMap<string, CompatibilityGrant>,
  nowIso: string
): GrantPlan {
  const issue: CompatibilityGrant[] = [];
  const revokeRepaired: CompatibilityGrant[] = [];
  const revokeLegacyDigest: CompatibilityGrant[] = [];
  const expires = new Date(new Date(nowIso).getTime() + LEGACY_COMPATIBILITY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  for (const entry of entries) {
    const existing = existingGrants.get(entry.flowId);

    // Retire an untrusted-format record wherever it is found, regardless of classification.
    if (existing && !existing.revokedAt && !isCurrentDigest(existing.contentHash)) {
      revokeLegacyDigest.push({ ...existing, revokedAt: nowIso, revokedReason: "digestFormatRetired" });
      continue; // deliberately no replacement grant
    }

    if (entry.classification === "temporarily-compatible") {
      // A digest we cannot trust must never be written into a new grant.
      if (existing || !isCurrentDigest(entry.contentDigest)) continue;
      issue.push({
        id: entry.flowId,
        contentHash: entry.contentDigest,
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

  return { issue, revokeRepaired, revokeLegacyDigest };
}
