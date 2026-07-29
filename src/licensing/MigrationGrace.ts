/**
 * One-time migration grace for installations upgraded from a pre-enforcement build (owner decision
 * 2026-07-29, bd `awkit-1cc`).
 *
 * Enforcement shipping ON by default would otherwise block every existing unlicensed install the
 * moment it updates. A bounded, one-time 14-day window from the FIRST launch of an enforcing build
 * lets those users keep working while they obtain a license. A **fresh** installation gets no grace
 * at all — grace exists to protect continuity, not to hand every new install a free fortnight.
 *
 * Grace never applies to an integrity failure. `INVALID_SIGNATURE` / `MACHINE_MISMATCH` /
 * `CORRUPTED` mean the license material cannot be trusted, and a trust failure is not a migration
 * inconvenience. That exclusion lives in `RunGatePolicy`; this module answers only "is the window
 * currently open?".
 *
 * Electron-free and clock-injected so the whole window — including rollback and expiry — is
 * unit-drivable without touching the system clock.
 *
 * **Honest limitation.** This is an offline, file-backed anchor. It is written to both the per-user
 * and (when writable) the machine-wide licensing directory, the EARLIEST anchor wins, and a
 * consumed window can never reopen. That defeats casual tampering — deleting one copy, or moving
 * the clock forward to "finish" the grace early, both fail. It does NOT defeat a user with full
 * filesystem access who deletes every copy: with no server and no trusted time source there is no
 * offline construction that can. Treat grace as a courtesy window, not as a security control; the
 * security control is the signed license itself.
 */

/** Length of the one-time migration window. */
export const MIGRATION_GRACE_DAYS = 14;
export const MIGRATION_GRACE_MS = MIGRATION_GRACE_DAYS * 24 * 60 * 60 * 1000;

/** Bump when the on-disk anchor shape changes incompatibly. */
export const MIGRATION_GRACE_SCHEMA_VERSION = 1 as const;

/**
 * Whether this profile existed before the first enforcing launch. Decided ONCE, when the anchor is
 * created, and never recomputed — otherwise later profile changes could flip an install back into
 * eligibility.
 */
export type InstallationKind = "upgraded" | "fresh";

export interface MigrationGraceAnchor {
  readonly schemaVersion: number;
  readonly installationKind: InstallationKind;
  /** First launch of an enforcing build against this profile. */
  readonly firstEnforcedLaunchUtc: string;
  readonly graceEndsAtUtc: string;
  /** Highest wall-clock time ever observed here; detects a backwards clock move. */
  readonly clockHighWaterUtc: string;
  /** Terminal. Once true the window can never reopen, on any clock. */
  readonly consumed: boolean;
}

export type MigrationGraceReason =
  | "NO_ANCHOR"
  | "FRESH_INSTALL_NOT_ELIGIBLE"
  | "IN_GRACE"
  | "GRACE_EXPIRED"
  | "GRACE_CONSUMED"
  | "CLOCK_ROLLBACK";

export interface MigrationGraceEvaluation {
  readonly inGrace: boolean;
  readonly graceEndsAtUtc: string | null;
  /** Milliseconds left in the window; 0 whenever `inGrace` is false. */
  readonly remainingMs: number;
  readonly reason: MigrationGraceReason;
  /** True when the caller should persist `consumed: true` — the window has closed for good. */
  readonly shouldMarkConsumed: boolean;
}

/** Tolerated backwards clock movement before the anchor is treated as tampered with. */
export const DEFAULT_GRACE_CLOCK_TOLERANCE_MS = 6 * 60 * 60 * 1000;

function parse(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Create the anchor for the first enforcing launch. `installationKind` is the caller's observation
 * of whether the profile already held user data, captured before this launch writes any of its own.
 */
export function createMigrationGraceAnchor(input: {
  readonly installationKind: InstallationKind;
  readonly nowMs: number;
  readonly graceMs?: number;
}): MigrationGraceAnchor {
  const nowIso = new Date(input.nowMs).toISOString();
  return {
    schemaVersion: MIGRATION_GRACE_SCHEMA_VERSION,
    installationKind: input.installationKind,
    firstEnforcedLaunchUtc: nowIso,
    graceEndsAtUtc: new Date(input.nowMs + (input.graceMs ?? MIGRATION_GRACE_MS)).toISOString(),
    clockHighWaterUtc: nowIso,
    // A fresh install has no window to open, so its anchor is born consumed. Recording it (rather
    // than writing nothing) is what stops a later launch from re-deciding the install is "upgraded"
    // once the profile has data in it.
    consumed: input.installationKind === "fresh"
  };
}

/**
 * Is the migration window currently open?
 *
 * Ordering matters and is deliberate: `consumed` is checked before expiry so a consumed anchor stays
 * closed even if the clock later reads earlier, and the rollback check precedes the expiry check so
 * moving the clock backwards cannot buy time.
 */
export function evaluateMigrationGrace(input: {
  readonly anchor: MigrationGraceAnchor | null;
  readonly nowMs: number;
  readonly clockToleranceMs?: number;
}): MigrationGraceEvaluation {
  const closed = (reason: MigrationGraceReason, shouldMarkConsumed = false): MigrationGraceEvaluation => ({
    inGrace: false,
    graceEndsAtUtc: input.anchor?.graceEndsAtUtc ?? null,
    remainingMs: 0,
    reason,
    shouldMarkConsumed
  });

  const { anchor } = input;
  if (!anchor) return closed("NO_ANCHOR");
  if (anchor.installationKind === "fresh") return closed("FRESH_INSTALL_NOT_ELIGIBLE");
  if (anchor.consumed) return closed("GRACE_CONSUMED");

  const endsAt = parse(anchor.graceEndsAtUtc);
  const highWater = parse(anchor.clockHighWaterUtc);
  // An unparseable anchor is corrupt, not permissive. Fail closed and burn the window rather than
  // letting a malformed file act as an unbounded grace.
  if (endsAt === null || highWater === null) return closed("GRACE_CONSUMED", true);

  const tolerance = input.clockToleranceMs ?? DEFAULT_GRACE_CLOCK_TOLERANCE_MS;
  if (input.nowMs < highWater - tolerance) return closed("CLOCK_ROLLBACK");

  if (input.nowMs >= endsAt) return closed("GRACE_EXPIRED", true);

  return {
    inGrace: true,
    graceEndsAtUtc: anchor.graceEndsAtUtc,
    remainingMs: endsAt - input.nowMs,
    reason: "IN_GRACE",
    shouldMarkConsumed: false
  };
}

/** Advance the observed-time high-water mark. Never moves backwards. */
export function touchGraceClock(anchor: MigrationGraceAnchor, nowMs: number): MigrationGraceAnchor {
  const highWater = parse(anchor.clockHighWaterUtc) ?? nowMs;
  if (nowMs <= highWater) return anchor;
  return { ...anchor, clockHighWaterUtc: new Date(nowMs).toISOString() };
}

export function markGraceConsumed(anchor: MigrationGraceAnchor): MigrationGraceAnchor {
  return anchor.consumed ? anchor : { ...anchor, consumed: true };
}

/**
 * Reconcile the per-user and machine-wide copies. The EARLIEST first-launch wins, `consumed` is
 * sticky across both, and the clock high-water is the maximum ever seen anywhere — so deleting one
 * copy cannot restart or extend the window, and neither can a clock moved backwards between them.
 */
export function mergeGraceAnchors(
  a: MigrationGraceAnchor | null,
  b: MigrationGraceAnchor | null
): MigrationGraceAnchor | null {
  if (!a) return b;
  if (!b) return a;

  const aStart = parse(a.firstEnforcedLaunchUtc);
  const bStart = parse(b.firstEnforcedLaunchUtc);
  // An unparseable timestamp must not win by comparing as "earlier"; prefer the parseable side.
  const earliest = aStart === null ? b : bStart === null ? a : aStart <= bStart ? a : b;

  const aHigh = parse(a.clockHighWaterUtc);
  const bHigh = parse(b.clockHighWaterUtc);
  const highWaterMs = Math.max(aHigh ?? 0, bHigh ?? 0);

  return {
    ...earliest,
    // "fresh" is the more restrictive classification, so it wins a disagreement.
    installationKind: a.installationKind === "fresh" || b.installationKind === "fresh" ? "fresh" : "upgraded",
    clockHighWaterUtc: highWaterMs > 0 ? new Date(highWaterMs).toISOString() : earliest.clockHighWaterUtc,
    consumed: a.consumed || b.consumed
  };
}

/** Whole days left, rounded up — what the UI shows. 0 once the window has closed. */
export function graceDaysRemaining(evaluation: MigrationGraceEvaluation): number {
  if (!evaluation.inGrace || evaluation.remainingMs <= 0) return 0;
  return Math.ceil(evaluation.remainingMs / (24 * 60 * 60 * 1000));
}
