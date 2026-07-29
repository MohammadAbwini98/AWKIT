/**
 * Durable, dual-location store for the one-time migration grace anchor (owner decision 2026-07-29,
 * bd `awkit-1cc`). The pure window logic lives in `@src/licensing/MigrationGrace`; this file owns
 * only where the anchor is kept and how the two copies are reconciled.
 *
 * Two locations, mirroring the license store's own layout:
 *   PRIMARY  %LOCALAPPDATA%\SpecterStudio\Licensing\migration-grace.json  (always written)
 *   MIRROR   %PROGRAMDATA%\SpecterStudio\Licensing\migration-grace.json   (best-effort)
 *
 * The mirror is what makes "delete the file to restart the grace" fail for an unprivileged user, and
 * `mergeGraceAnchors` makes the EARLIEST anchor and a sticky `consumed` flag win — so restoring an
 * older copy cannot extend the window either. Writing the mirror is best-effort by design: it needs
 * privileges the app deliberately never elevates for, and a missing mirror must degrade to
 * per-user-only durability rather than break licensing. See the honest-limitation note in
 * `MigrationGrace.ts`: this defeats casual tampering, not a determined local user.
 *
 * The anchor holds no license material, no secret, and no machine identifier — only two timestamps,
 * an install classification, and a boolean.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getRuntimePaths } from "../appPaths";
import {
  createMigrationGraceAnchor,
  evaluateMigrationGrace,
  markGraceConsumed,
  mergeGraceAnchors,
  touchGraceClock,
  type InstallationKind,
  type MigrationGraceAnchor,
  type MigrationGraceEvaluation
} from "@src/licensing/MigrationGrace";

export const MIGRATION_GRACE_FILE_NAME = "migration-grace.json";

/**
 * Same directory pair the license store uses, so the two travel together — but the machine-wide
 * mirror is namespaced PER PROFILE.
 *
 * A single shared filename would make the first profile to launch decide for every other user on the
 * machine: `mergeGraceAnchors` lets `fresh` win a disagreement, so one fresh install would
 * permanently deny the migration window to a genuinely upgraded second user. Whether an installation
 * was upgraded is a per-profile fact, so the mirror is keyed by a hash of the profile root.
 *
 * The key is a SHA-256 prefix, never the readable path — the path contains the Windows username, and
 * this file has no business recording that (same reasoning as `MachineFingerprint`).
 */
function resolveAnchorPaths(): { localPath: string; sharedPath: string | null } {
  const root = getRuntimePaths().root;
  const localPath = join(root, "Licensing", MIGRATION_GRACE_FILE_NAME);
  const programData = process.env.PROGRAMDATA;
  if (!programData) return { localPath, sharedPath: null };

  const profileKey = createHash("sha256").update(root.toLowerCase()).digest("hex").slice(0, 16);
  const sharedPath = join(
    programData,
    "SpecterStudio",
    "Licensing",
    `migration-grace-${profileKey}.json`
  );
  return { localPath, sharedPath };
}

/** Untrusted input: a malformed or foreign-shaped file reads as "no anchor", never as a valid one. */
function readAnchor(path: string | null): MigrationGraceAnchor | null {
  if (!path || !existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<MigrationGraceAnchor>;
    if (
      typeof parsed.firstEnforcedLaunchUtc !== "string" ||
      typeof parsed.graceEndsAtUtc !== "string" ||
      typeof parsed.clockHighWaterUtc !== "string" ||
      typeof parsed.consumed !== "boolean" ||
      (parsed.installationKind !== "upgraded" && parsed.installationKind !== "fresh")
    ) {
      return null;
    }
    return {
      schemaVersion: typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : 1,
      installationKind: parsed.installationKind,
      firstEnforcedLaunchUtc: parsed.firstEnforcedLaunchUtc,
      graceEndsAtUtc: parsed.graceEndsAtUtc,
      clockHighWaterUtc: parsed.clockHighWaterUtc,
      consumed: parsed.consumed
    };
  } catch {
    return null;
  }
}

/** Atomic write; failure is swallowed so a read-only location can never break a launch. */
function writeAnchor(path: string | null, anchor: MigrationGraceAnchor): boolean {
  if (!path) return false;
  try {
    mkdirSync(join(path, ".."), { recursive: true });
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(anchor, null, 2)}\n`, "utf8");
    renameSync(temporary, path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Did this profile hold user data before the first enforcing launch?
 *
 * Called ONCE, at anchor creation, and only from `initializeMigrationGrace()` — which bootstrap runs
 * before it writes anything of its own. Recomputing it later would let an install that has since
 * accumulated data re-classify itself as an upgrade and earn a second window.
 */
function detectInstallationKind(): InstallationKind {
  const paths = getRuntimePaths();
  const settingsFile = join(paths.folders.storage, "ui-settings.json");
  if (existsSync(settingsFile)) return "upgraded";

  // A profile with saved flows or workflows predates this launch even if settings were never written.
  for (const folder of [paths.folders.flows, paths.folders.workflows] as const) {
    try {
      if (existsSync(folder) && readdirSync(folder).some((name) => name.endsWith(".json"))) return "upgraded";
    } catch {
      // Unreadable folder tells us nothing; fall through to the more restrictive classification.
    }
  }
  return "fresh";
}

let cached: MigrationGraceAnchor | null | undefined;

function loadMerged(): MigrationGraceAnchor | null {
  const { localPath, sharedPath } = resolveAnchorPaths();
  return mergeGraceAnchors(readAnchor(localPath), readAnchor(sharedPath));
}

function persist(anchor: MigrationGraceAnchor): void {
  const { localPath, sharedPath } = resolveAnchorPaths();
  writeAnchor(localPath, anchor);
  writeAnchor(sharedPath, anchor); // best-effort mirror; see module note
  cached = anchor;
}

/**
 * Establish the anchor on first enforcing launch. Must run BEFORE bootstrap writes any profile data,
 * because that write is what would otherwise make a fresh install look upgraded.
 *
 * Idempotent: once an anchor exists in either location, its classification stands forever.
 */
export function initializeMigrationGrace(nowMs: number = Date.now()): MigrationGraceAnchor {
  const existing = loadMerged();
  if (existing) {
    const touched = touchGraceClock(existing, nowMs);
    if (touched !== existing) persist(touched);
    else cached = existing;
    return touched;
  }
  const created = createMigrationGraceAnchor({ installationKind: detectInstallationKind(), nowMs });
  persist(created);
  return created;
}

/**
 * Current window state. Advances the clock high-water mark and burns the window the first time it is
 * observed closed, so expiry is recorded rather than re-derived from a clock that could later move.
 */
export function evaluateMigrationGraceWindow(nowMs: number = Date.now()): MigrationGraceEvaluation {
  const anchor = cached !== undefined ? cached : loadMerged();
  cached = anchor;

  const evaluation = evaluateMigrationGrace({ anchor, nowMs });
  if (!anchor) return evaluation;

  let next = touchGraceClock(anchor, nowMs);
  if (evaluation.shouldMarkConsumed) next = markGraceConsumed(next);
  if (next !== anchor) persist(next);

  return evaluation;
}

/** Test/diagnostic accessor. Never used to make a gate decision. */
export function peekMigrationGraceAnchor(): MigrationGraceAnchor | null {
  return cached !== undefined ? cached : loadMerged();
}

/** Drops the in-process cache so a test can re-read what it just wrote to disk. */
export function resetMigrationGraceCache(): void {
  cached = undefined;
}
