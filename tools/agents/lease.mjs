/**
 * The write lease — one writer at a time, enforced rather than described.
 *
 * AWKIT develops directly on `main`, so "only one implementation agent may hold the repository write
 * lease" is not a stylistic preference; it is the only thing standing between two concurrent
 * specialists and a working tree neither of them can reason about. A lease that lives only in a
 * document is a suggestion. This module makes it state, and `lease-guard.mjs` makes it a gate.
 *
 * Three levels of scope change, in descending order of preference:
 *
 *   1. Normal lease      granted from the routed writer sequence with the narrowest correct scope.
 *   2. Lease amendment   the PREFERRED way to grow. Logged with a reason, and — critically — it
 *                        RE-RUNS ROUTING. If the added paths flip a classification, the lease is
 *                        released and the next one goes to the specialist who actually owns them.
 *                        Permissions never creep outward from one agent's original grant.
 *   3. Emergency override rare recovery only. Narrow, logged, and it forces QC review.
 *
 * The lease is mirrored into `tools/roadmap/assignments.json` rather than kept as a second truth.
 * That file is already the only source the Program Status dashboard treats as authoritative for who
 * is working on what, complete with a 24h expiry and struck-through rendering for stale claims.
 * Duplicating it would recreate exactly the drift this architecture exists to prevent.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  WATCHED_IGNORED_PATHS,
  agent,
  pathInScope,
  protectedPathFor,
  sharedWritePathFor
} from "./routing-matrix.mjs";
import { deriveClassification, normalizeClassification } from "./classify.mjs";
import { route } from "./route.mjs";

/** tools/agents -> tools -> repo root */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The single active lease. One file, because there is one writer. */
export const LEASE_PATH = join(REPO_ROOT, "docs", "ai", "contracts", "active-lease.json");

/** The dashboard's claims file, mirrored — never duplicated. */
export const ASSIGNMENTS_PATH = join(REPO_ROOT, "tools", "roadmap", "assignments.json");

/**
 * @typedef {Object} Lease
 * @property {string} task
 * @property {string} contract_path repo-relative in the real repository; absolute only in isolated fixtures
 * @property {string} holder
 * @property {"active"|"released"|"revoked"|"blocked"} status
 * @property {string[]} allowed_paths
 * @property {string} acquired_at
 * @property {string} acquired_at_commit
 * @property {Array<Object>} amendments
 * @property {Array<Object>} overrides
 */

/**
 * Read the active lease.
 *
 * The three outcomes are deliberately distinct. `null` means no lease exists, which is a normal
 * state — ordinary tasks that predate this system still have to work. A thrown error means the file
 * exists but is unreadable, which the guard treats as a BLOCK rather than an allow: a corrupt lease
 * is loud, actionable, and trivially fixed, whereas silently allowing on a parse error would let
 * anyone defeat the gate by damaging one file.
 *
 * @param {string} [path]
 * @returns {Lease|null}
 */
export function readLeaseRecord(path = LEASE_PATH) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw new Error(
      `cannot read active lease at ${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `active-lease.json is not valid JSON (${err instanceof Error ? err.message : String(err)}). ` +
        "Repair or delete it — a damaged lease is never treated as an absent one."
    );
  }

  if (typeof parsed?.status !== "string") {
    throw new Error("active-lease.json is missing status");
  }
  if (parsed.status === "active" && (typeof parsed.holder !== "string" || !Array.isArray(parsed.allowed_paths))) {
    throw new Error("active-lease.json is missing holder or allowed_paths");
  }

  return parsed;
}

export function readLease(path = LEASE_PATH) {
  const parsed = readLeaseRecord(path);
  return parsed?.status === "active" ? parsed : null;
}

/**
 * @param {Lease} lease
 * @param {string} [path]
 */
export function writeLease(lease, path = LEASE_PATH) {
  writeFileSync(path, `${JSON.stringify(lease, null, 2)}\n`, "utf8");
}

/**
 * Every path git currently reports as modified, added, deleted or untracked.
 *
 * This is the basis of the Bash audit: rather than parsing a shell command to guess whether it
 * writes — unreliable in both directions, and it would miss `python -c "open(...)"` while flagging
 * `echo "a > b"` — the audit observes what actually changed on disk.
 *
 * Its blind spot is gitignored paths, which git will never report here. Most of that is genuinely
 * fine — `out/`, `dist/`, `graphify-out/` and the logs are derived artifacts. The ignored paths that
 * DO carry consequence (secrets, captured auth, local permission overrides, and the ignored subtrees
 * inside the protected offline boundary) are covered separately by `fingerprintWatchedIgnored()`,
 * because enumerating every ignored file would mean walking `node_modules/`.
 *
 * @returns {string[]}
 */
export function dirtyPaths(cwd = REPO_ROOT) {
  return execFileSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  })
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    // Renames arrive as "old -> new"; the destination is the write that matters.
    .map((path) => (path.includes(" -> ") ? path.split(" -> ")[1] : path))
    .map((path) => path.replace(/^"|"$/g, "").replace(/\\/g, "/"))
    .sort();
}

/** Paths committed after the lease's acquired_at_commit, including a clean post-commit tree. */
export function committedPathsSince(commit, cwd = REPO_ROOT) {
  if (!commit || commit === "unknown") {
    throw new Error("lease has no valid acquired_at_commit baseline");
  }
  execFileSync("git", ["rev-parse", "--verify", `${commit}^{commit}`], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return execFileSync("git", ["diff", "--name-only", `${commit}..HEAD`], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  })
    .split("\n")
    .map((path) => path.trim().replace(/\\/g, "/"))
    .filter(Boolean)
    .sort();
}

/** Content fingerprints for tracked/untracked baseline-dirty files. */
export function trackedPathFingerprints(paths, cwd = REPO_ROOT) {
  const out = {};
  for (const path of [...new Set(paths ?? [])].sort()) {
    try {
      const data = readFileSync(join(cwd, path));
      out[path] = createHash("sha256").update(data).digest("hex");
    } catch {
      out[path] = "absent";
    }
  }
  return out;
}

/** @returns {string} current full HEAD. Throws outside a valid Git checkout. */
function headCommit() {
  return execFileSync("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

/**
 * Convert any path the tooling might hand us — absolute, Windows-separated, or already relative —
 * into a repo-relative POSIX path.
 *
 * @param {string} candidate
 * @returns {string|null} null when the path lies outside the repository
 */
export function toRepoRelative(candidate) {
  if (!candidate) return null;
  const absolute = resolve(REPO_ROOT, candidate);
  const rel = relative(REPO_ROOT, absolute).replace(/\\/g, "/");
  if (rel === "" || rel.startsWith("../")) return null;
  return rel;
}

/**
 * Is this path writable under the given lease?
 *
 * A shared-write path is allowed to ANY lease holder. That is not a hole — it is the relaxed half
 * of a deliberate split. `package.json` is release-owned because it carries the dependency graph,
 * but it also carries the npm script inventory, and this guard runs BEFORE an edit, so it cannot
 * tell which of the two is about to change. Blocking on that ambiguity forced a full lease handoff
 * to add a one-line script — measured ceremony that bought nothing.
 *
 * The enforcement moved rather than disappeared: `deriveGuardedFieldChanges()` compares the
 * committed file against the working tree and reports a change to any non-shared field as a scope
 * escape, which blocks completion. Permissive at edit time, strict where content is actually
 * visible.
 *
 * @param {Lease} lease
 * @param {string} repoRelativePath
 * @returns {boolean}
 */
export function leaseAllows(lease, repoRelativePath) {
  if (pathInScope(repoRelativePath, lease.allowed_paths)) return true;
  return sharedWritePathFor(repoRelativePath) !== null;
}

/** @param {string} task */
export function contractPathFor(task) {
  return join(REPO_ROOT, "docs", "ai", "contracts", `${task}.json`);
}

/** Resolve a persisted repo-relative task-contract path (and isolated absolute test fixtures). */
export function resolveContractPath(path, task) {
  const candidate = path ?? contractPathFor(task);
  return isAbsolute(candidate) ? candidate : resolve(REPO_ROOT, candidate);
}

/** Avoid committing a developer-specific absolute repository path into active-lease.json. */
export function storedContractPath(path) {
  return toRepoRelative(path) ?? path;
}

/** Read the task contract used to authorize a lease lifecycle transition. */
function readTaskContract(path, task) {
  const resolvedPath = resolveContractPath(path, task);
  let contract;
  try {
    contract = JSON.parse(readFileSync(resolvedPath, "utf8"));
  } catch (error) {
    throw new Error(
      `cannot preserve write-lease history without readable task contract ${resolvedPath}: ` +
        `${error instanceof Error ? error.message : String(error)}`
    );
  }
  return contract;
}

function approvedOverridePaths(contract) {
  if (contract.completion?.qc_status !== "APPROVED") return new Set();
  return new Set(
    (contract.write_lease?.overrides ?? [])
      .filter((override) => override?.qc_required === true && override?.reason)
      .flatMap((override) => override?.affected_paths ?? [])
  );
}

/** Append a bounded immutable snapshot to the task contract before the active record is replaceable. */
export function archiveLease(lease, contractPath = lease.contract_path ?? contractPathFor(lease.task)) {
  const resolvedPath = resolveContractPath(contractPath, lease.task);
  const contract = readTaskContract(resolvedPath, lease.task);
  if (contract.task?.id !== lease.task) {
    throw new Error(`lease task "${lease.task}" does not match contract task "${contract.task?.id ?? "missing"}"`);
  }
  contract.write_lease ??= {};
  contract.write_lease.history ??= [];
  if (!Array.isArray(contract.write_lease.history)) {
    throw new Error("contract.write_lease.history is not an array");
  }
  const archiveId = `${lease.task}:${lease.holder}:${lease.acquired_at}`;
  if (!contract.write_lease.history.some((entry) => entry?.id === archiveId)) {
    contract.write_lease.history.push({
      id: archiveId,
      task: lease.task,
      holder: lease.holder,
      status: lease.status,
      allowed_paths: [...(lease.allowed_paths ?? [])],
      acquired_at: lease.acquired_at,
      acquired_at_commit: lease.acquired_at_commit,
      released_at: lease.released_at,
      released_reason: lease.released_reason,
      amendments: [...(lease.amendments ?? [])],
      overrides: [...(lease.overrides ?? [])],
      violations: [...(lease.violations ?? [])]
    });
    writeFileSync(resolvedPath, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
  }
  lease.archived_at = new Date().toISOString();
  return lease;
}

function finalizeLease(
  lease,
  { reason, status = "released", path, assignmentsPath, contractPath }
) {
  const contract = readTaskContract(contractPath, lease.task);
  const approved = approvedOverridePaths(contract);
  const unresolved = (lease.violations ?? []).filter(
    (violation) => violation?.resolved !== true && !approved.has(violation?.path)
  );
  if (unresolved.length > 0) {
    throw new Error(
      `cannot release lease with ${unresolved.length} unresolved violation(s): ` +
        `${unresolved.map((violation) => violation.path).join(", ")}. Resolve them or record a ` +
        "QC-approved emergency override in the task contract."
    );
  }
  lease.status = status;
  lease.released_at = new Date().toISOString();
  lease.released_reason = reason;
  archiveLease(lease, contractPath);
  writeLease(lease, path);
  clearAssignment(lease.task, assignmentsPath);
  return lease;
}

/**
 * Grant a lease.
 *
 * `path` and `assignmentsPath` exist so the verifier can drive this against fixtures. Without them
 * every lease assertion would have to mutate the repository's own lease file, which makes the tests
 * destructive and — worse — makes them pass trivially whenever that file happens to be absent.
 *
 * @param {Object} params
 * @param {string} params.task
 * @param {string} params.holder
 * @param {readonly string[]} params.allowedPaths
 * @param {{writerSequence:string[], expectedPaths?:string[]}} params.routing validated route result
 * @param {string} [params.path]
 * @param {string} [params.assignmentsPath]
 * @param {string} [params.contractPath]
 * @param {string} [params.contractPath]
 * @returns {Lease}
 */
export function grantLease({
  task,
  holder,
  allowedPaths,
  routing,
  path = LEASE_PATH,
  assignmentsPath = ASSIGNMENTS_PATH,
  contractPath = contractPathFor(task)
}) {
  agent(holder); // throws on an unknown id rather than granting a lease to a typo

  if (!Array.isArray(allowedPaths) || allowedPaths.length === 0) {
    throw new Error("a lease with no allowed_paths grants nothing and blocks everything");
  }

  const existingRecord = readLeaseRecord(path);
  if (existingRecord?.status === "active") {
    throw new Error(
      `"${existingRecord.holder}" already holds the lease for ${existingRecord.task}. One writer at a time — ` +
        "release it before granting another."
    );
  }
  if (existingRecord && !existingRecord.archived_at) {
    archiveLease(existingRecord, existingRecord.contract_path ?? contractPathFor(existingRecord.task));
    writeLease(existingRecord, path);
  }

  if (!routing || !Array.isArray(routing.writerSequence)) {
    throw new Error("grantLease requires the validated deterministic routing result");
  }
  if (!routing.writerSequence.includes(holder)) {
    throw new Error(
      `"${holder}" is not in routing.writerSequence [${routing.writerSequence.join(", ")}]`
    );
  }

  const expectedPaths = Array.isArray(routing.expectedPaths) ? routing.expectedPaths : [];
  const owned = agent(holder).ownsPaths;
  const probe = (pattern) => pattern.replace(/\*\*/g, "__lease__").replace(/\*/g, "__lease__");
  for (const allowedPath of allowedPaths) {
    if (
      typeof allowedPath !== "string" ||
      !allowedPath.trim() ||
      isAbsolute(allowedPath) ||
      toRepoRelative(allowedPath) === null ||
      ["*", "**", ".", "./"].includes(allowedPath.trim())
    ) {
      throw new Error(`unsafe lease path ${JSON.stringify(allowedPath)}; use a repo-relative bounded path`);
    }
    if (!owned.includes(allowedPath) && !pathInScope(probe(allowedPath), owned)) {
      throw new Error(`lease path "${allowedPath}" is outside ${holder}'s ownership [${owned.join(", ")}]`);
    }
    if (!expectedPaths.includes(allowedPath) && !pathInScope(probe(allowedPath), expectedPaths)) {
      throw new Error(
        `lease path "${allowedPath}" is outside routed expected paths [${expectedPaths.join(", ")}]`
      );
    }
  }

  const baselineDirty = dirtyPaths();

  /** @type {Lease} */
  const lease = {
    task,
    contract_path: storedContractPath(contractPath),
    holder,
    status: "active",
    allowed_paths: [...allowedPaths].sort(),
    acquired_at: new Date().toISOString(),
    acquired_at_commit: headCommit(),
    // Files already modified when the lease was granted. Without this the Bash audit would report
    // every pre-existing edit as an out-of-lease write the moment the first shell command ran.
    baseline_dirty: baselineDirty,
    baseline_dirty_fingerprints: trackedPathFingerprints(baselineDirty),
    // Gitignored paths git will never report. Fingerprinted here so a shell write into a secret,
    // a captured session, or the bundled-browser tree is still comparable afterwards.
    baseline_watched_ignored: fingerprintWatchedIgnored(),
    amendments: [],
    overrides: [],
    violations: []
  };

  writeLease(lease, path);
  mirrorToAssignments(lease, assignmentsPath);
  return lease;
}

/**
 * Amend a lease — the preferred response to discovering the work is bigger than declared.
 *
 * The routing re-run is the whole point. Adding `src/storage/**` to a `frontend` lease does not
 * simply widen frontend's permissions; it makes the change a persistence change, which makes the
 * Persistence specialist mandatory. In that case this returns `reroute`, the current lease is
 * released, and the next lease belongs to someone else. Specialization survives contact with
 * surprise.
 *
 * @param {Object} params
 * @param {readonly string[]} params.addPaths
 * @param {string} params.reason
 * @param {string} [params.path]
 * @param {string} [params.assignmentsPath]
 * @returns {{outcome: "extended"|"reroute", lease: Lease, requiredAgents: string[], addedFlags: string[]}}
 */
export function amendLease({
  addPaths,
  reason,
  path = LEASE_PATH,
  assignmentsPath = ASSIGNMENTS_PATH,
  contractPath
}) {
  if (!reason || reason.trim().length === 0) {
    throw new Error("an amendment without a reason is an undocumented scope expansion");
  }

  const lease = readLease(path);
  if (!lease) throw new Error("no active lease to amend");
  const taskContractPath = contractPath ?? lease.contract_path ?? contractPathFor(lease.task);

  const added = [...addPaths];
  const derived = deriveClassification(added);

  // Re-run routing over what the widened scope actually implies.
  const { classification } = normalizeClassification({});
  for (const flag of derived.flags) classification[flag] = true;
  classification.cross_layer_count = Math.max(1, derived.crossLayerCount);
  const routing = route(classification, { expectedPaths: added });

  const owned = agent(lease.holder).ownsPaths;
  const outsideOwnership = added.filter((path) => !pathInScope(path, owned));

  const amendment = {
    timestamp: new Date().toISOString(),
    added,
    reason,
    triggered_escalation: routing.activated.filter((id) => id !== "manager" && id !== lease.holder),
    approved_by: "manager"
  };

  lease.amendments.push(amendment);

  if (outsideOwnership.length > 0) {
    // The added paths belong to someone else. Release rather than widen.
    finalizeLease(lease, {
      reason:
        `amendment added paths outside ${lease.holder}'s ownership (${outsideOwnership.join(", ")}) — ` +
        "routing re-run requires a different specialist",
      path,
      assignmentsPath,
      contractPath: taskContractPath
    });

    return {
      outcome: "reroute",
      lease,
      requiredAgents: routing.writerSequence,
      addedFlags: derived.flags
    };
  }

  lease.allowed_paths = [...new Set([...lease.allowed_paths, ...added])].sort();
  writeLease(lease, path);
  mirrorToAssignments(lease, assignmentsPath);

  return { outcome: "extended", lease, requiredAgents: [], addedFlags: derived.flags };
}

/**
 * Release the lease so the next writer in the sequence can take it.
 * @param {string} [reason]
 * @param {string} [path]
 * @param {string} [assignmentsPath]
 * @param {string} [contractPath]
 * @returns {Lease|null}
 */
export function releaseLease(
  reason = "work complete",
  path = LEASE_PATH,
  assignmentsPath = ASSIGNMENTS_PATH,
  contractPath
) {
  const lease = readLease(path);
  if (!lease) return null;
  return finalizeLease(lease, {
    reason,
    path,
    assignmentsPath,
    contractPath: contractPath ?? lease.contract_path ?? contractPathFor(lease.task)
  });
}

/**
 * The routing system's own bookkeeping, which can never be a lease violation.
 *
 * `grantLease` writes the lease file and mirrors the holder into `assignments.json` AFTER it
 * snapshots the dirty set, so without this exclusion the very act of taking a lease reports itself
 * as an out-of-lease write on the next shell command. Found by running the audit for the first time
 * against a real lease.
 * @type {readonly string[]}
 */
export const SYSTEM_BOOKKEEPING_PATHS = Object.freeze([
  "docs/ai/contracts/active-lease.json",
  "tools/roadmap/assignments.json"
]);

/**
 * Which currently-dirty paths were written outside the lease?
 *
 * Kept as a pure function of its inputs so the verifier can drive every case without a shell, a
 * repository, or a real lease. The hook is a thin wrapper that supplies real git output.
 *
 * A lease with NO recorded baseline (granted before the field existed) is treated as though nothing
 * was dirty, which over-reports rather than under-reports. That direction is deliberate: a noisy
 * audit is annoying, a silent one is useless.
 *
 * @param {Lease} lease
 * @param {readonly string[]} currentDirty
 * @param {{committedPaths?:readonly string[], currentFingerprints?:Record<string,string>}} [evidence]
 * @returns {string[]}
 */
export function outOfLeaseWrites(
  lease,
  currentDirty,
  { committedPaths = [], currentFingerprints = {} } = {}
) {
  const baseline = new Set(lease.baseline_dirty ?? []);
  const baselineFingerprints = lease.baseline_dirty_fingerprints;
  const dirtyAfterGrant = currentDirty.filter((path) => {
    if (!baseline.has(path)) return true;
    if (!baselineFingerprints) return false; // backward compatibility for leases predating hashes
    return baselineFingerprints[path] !== currentFingerprints[path];
  });
  return [...new Set([...dirtyAfterGrant, ...committedPaths])]
    .filter((path) => !SYSTEM_BOOKKEEPING_PATHS.includes(path))
    .filter((path) => path !== `docs/ai/contracts/${lease.task}.json`)
    .filter((path) => !leaseAllows(lease, path))
    .sort();
}

/**
 * Fingerprint the watched ignored paths.
 *
 * A file is `size:mtimeMs`. A directory is its DIRECT entries' names and mtimes — enough to notice
 * a bundled Chromium being swapped or a jar dropped in, without walking thousands of files. Absent
 * paths fingerprint as `"absent"`, so creation and deletion are both changes rather than silence.
 *
 * @param {string} [cwd]
 * @returns {Record<string, string>}
 */
export function fingerprintWatchedIgnored(cwd = REPO_ROOT) {
  /** @type {Record<string, string>} */
  const out = {};

  for (const entry of WATCHED_IGNORED_PATHS) {
    const absolute = join(cwd, entry.path);
    try {
      const info = statSync(absolute);
      if (entry.kind === "dir" && info.isDirectory()) {
        const children = readdirSync(absolute, { withFileTypes: true })
          .map((child) => {
            try {
              return `${child.name}:${statSync(join(absolute, child.name)).mtimeMs}`;
            } catch {
              return `${child.name}:?`;
            }
          })
          .sort();
        out[entry.path] = `dir(${children.length}):${children.join("|")}`;
      } else {
        out[entry.path] = `${info.size}:${info.mtimeMs}`;
      }
    } catch {
      out[entry.path] = "absent";
    }
  }

  return out;
}

/**
 * Which watched ignored paths changed since the lease was granted?
 *
 * Pure, so the verifier drives it with two plain objects rather than a filesystem. A path missing
 * from the baseline is treated as CHANGED, not as unchanged — a lease granted before this field
 * existed must not read as proof that nothing happened.
 *
 * @param {Record<string, string>|undefined} baseline
 * @param {Record<string, string>} current
 * @returns {string[]}
 */
export function changedWatchedIgnored(baseline, current) {
  if (!baseline) return Object.keys(current).sort();
  return Object.keys(current)
    .filter((path) => baseline[path] !== current[path])
    .sort();
}

/**
 * Protected paths modified while NO lease is held.
 *
 * The symmetric half of the guard's protected-path rule. With no lease there is no baseline to
 * subtract, so this compares against the committed state instead: a protected file that is dirty
 * and unclaimed is reported. That will repeat on every shell command until the file is committed or
 * a lease is taken, which is the correct nuisance — "licensing is modified and nobody is
 * answerable" is a state worth being loud about, and protected files are rarely dirty in passing.
 *
 * @param {readonly string[]} currentDirty
 * @returns {string[]}
 */
export function unclaimedProtectedWrites(currentDirty) {
  return currentDirty.filter((path) => protectedPathFor(path) !== null).sort();
}

/**
 * Record out-of-lease writes onto the lease so they survive the shell command that caused them.
 *
 * A warning printed to stderr can be scrolled past; a violation written into the lease file is read
 * back by the completion gate. Deduplicated, because a long shell session would otherwise record
 * the same file on every subsequent command.
 *
 * @param {readonly string[]} paths
 * @param {string} [path]
 * @returns {number} total unresolved violations after recording
 */
export function recordViolations(paths, path = LEASE_PATH) {
  const lease = readLease(path);
  if (!lease || paths.length === 0) return lease?.violations?.length ?? 0;

  lease.violations ??= [];
  const known = new Set(lease.violations.filter((v) => v.resolved !== true).map((v) => v.path));
  const timestamp = new Date().toISOString();

  for (const p of paths) {
    if (known.has(p)) continue;
    lease.violations.push({ path: p, detectedAt: timestamp, via: "bash", resolved: false });
  }

  writeLease(lease, path);
  return lease.violations.filter((v) => !v.resolved).length;
}

/**
 * Mirror the holder into the dashboard's claims file.
 *
 * Deliberately additive and tolerant: a failure to mirror must never prevent a lease from being
 * granted. The lease is the enforcement mechanism; the claim is a display convenience.
 *
 * @param {Lease} lease
 * @param {string} [assignmentsPath]
 */
export function mirrorToAssignments(lease, assignmentsPath = ASSIGNMENTS_PATH) {
  try {
    const raw = JSON.parse(readFileSync(assignmentsPath, "utf8"));
    const claims = Array.isArray(raw.claims) ? raw.claims : [];
    const itemId = `bead:${lease.task}`;

    const next = claims.filter((claim) => claim?.itemId !== itemId);
    next.push({
      itemId,
      agent: agent(lease.holder).role,
      state: "in-progress",
      claimedAt: lease.acquired_at,
      note: `write lease: ${lease.allowed_paths.join(", ")}`
    });

    raw.claims = next;
    writeFileSync(assignmentsPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  } catch {
    // Non-fatal by design — see the doc comment.
  }
}

/**
 * Remove a mirrored claim when its lease ends. A stale claim is worse than no claim.
 * @param {string} task
 * @param {string} [assignmentsPath]
 */
export function clearAssignment(task, assignmentsPath = ASSIGNMENTS_PATH) {
  try {
    const raw = JSON.parse(readFileSync(assignmentsPath, "utf8"));
    raw.claims = (Array.isArray(raw.claims) ? raw.claims : []).filter(
      (claim) => claim?.itemId !== `bead:${task}`
    );
    writeFileSync(assignmentsPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  } catch {
    // Non-fatal by design.
  }
}
