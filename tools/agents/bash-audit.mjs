#!/usr/bin/env node
/**
 * PostToolUse audit for `Bash` — closing the shell bypass without pretending to parse shell.
 *
 * The `PreToolUse` lease guard matches `Edit|Write|NotebookEdit`, so a redirect, `sed -i`, `mv`, a
 * python one-liner, or `git checkout` never reaches it. That was a documented hole.
 *
 * ── Why this does NOT inspect the command ─────────────────────────────────────────────────────
 *
 * The obvious fix is to match `Bash` in PreToolUse and look for `>` or `sed -i`. It is the wrong
 * fix, and wrong in both directions: it would miss `python -c "open('x','w')..."`, a script that
 * writes, `tee`, `cp`, or anything indirect — while blocking `echo "a > b"`, a grep for a literal
 * redirect, or a commit message containing an angle bracket. A guard with both false negatives and
 * false positives trains people to work around it, which is worse than no guard.
 *
 * So this observes the FILESYSTEM instead of the intent. After a Bash command runs, it asks git
 * what is actually dirty and subtracts three things: the lease scope, shared write paths, and the
 * set of files that were already dirty when the lease was granted. Whatever remains was written by
 * that command, outside the lease, whatever syntax produced it.
 *
 * ── What this is and is not ───────────────────────────────────────────────────────────────────
 *
 * It is DETECTION, not prevention — PostToolUse runs after the write. It cannot undo anything. What
 * it converts is an invisible bypass into an immediate, attributable one: the violation is named at
 * the moment it happens and recorded onto the lease, where `completionBlockers()` reads it back.
 *
 * Its blind spot is gitignored paths. `out/`, `dist/`, `graphify-out/` are invisible to
 * `git status` by definition. Those are derived artifacts rather than the source a lease protects,
 * so the gap is acceptable — but it is a real gap and is stated rather than glossed.
 *
 * ── Cost ──────────────────────────────────────────────────────────────────────────────────────
 *
 * With no active lease this exits after reading one small JSON file and never invokes git, which is
 * the overwhelmingly common case. While a lease is held it adds roughly 100ms per Bash call. Paying
 * that only when someone has explicitly claimed a write scope is the right trade.
 */

import {
  changedWatchedIgnored,
  committedPathsSince,
  dirtyPaths,
  fingerprintWatchedIgnored,
  leaseAllows,
  outOfLeaseWrites,
  readLease,
  recordViolations,
  trackedPathFingerprints,
  unclaimedProtectedWrites
} from "./lease.mjs";

const OK = 0;
const REPORT = 2;

/** @returns {Promise<string>} */
function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(""));
  });
}

async function main() {
  // Drain stdin so the caller never blocks on an unread pipe, but nothing here depends on it — the
  // command text is deliberately not consulted.
  await readStdin();

  let lease;
  try {
    lease = readLease();
  } catch {
    // A damaged lease is already reported loudly by the PreToolUse guard. Do not double-report from
    // an audit that runs after every shell command.
    process.exit(OK);
  }

  if (!lease) {
    // No lease. Ordinary shell writes are unrestricted, matching the edit guard — but a protected
    // path that is dirty and unclaimed leaves nobody answerable for a Risk 3 change, so it is
    // reported. There is no lease to record it on; being loud is the whole remedy here.
    const unclaimed = unclaimedProtectedWrites(dirtyPaths());
    if (unclaimed.length === 0) process.exit(OK);

    process.stderr.write(
      "[write-lease] UNCLAIMED PROTECTED WRITE.\n" +
        "[write-lease] No lease is held, and these protected files are modified:\n" +
        unclaimed.map((p) => `[write-lease]   ! ${p}\n`).join("") +
        "[write-lease]\n" +
        "[write-lease] Licensing, auth, secret, authorization and offline-boundary changes must\n" +
        "[write-lease] have someone answerable for them. Take a lease, or commit/revert these.\n"
    );
    process.exit(REPORT);
  }

  // Two sources, because git can only see one of them. Tracked paths come from `git status`;
  // gitignored-but-consequential paths come from a fingerprint comparison, since enumerating every
  // ignored file would mean walking node_modules.
  const currentDirty = dirtyPaths();
  const tracked = outOfLeaseWrites(lease, currentDirty, {
    committedPaths: committedPathsSince(lease.acquired_at_commit),
    currentFingerprints: trackedPathFingerprints(lease.baseline_dirty ?? [])
  });
  const ignored = changedWatchedIgnored(
    lease.baseline_watched_ignored,
    fingerprintWatchedIgnored()
  ).filter((path) => !leaseAllows(lease, path));

  const written = [...new Set([...tracked, ...ignored])].sort();
  if (written.length === 0) process.exit(OK);

  const unresolved = recordViolations(written);

  process.stderr.write(
    `[write-lease] OUT-OF-LEASE WRITE detected after a Bash command.\n` +
      `[write-lease] "${lease.holder}" holds the lease for ${lease.task}, scoped to:\n` +
      lease.allowed_paths.map((p) => `[write-lease]   - ${p}\n`).join("") +
      "[write-lease] but these files changed outside it:\n" +
      written.map((p) => `[write-lease]   ! ${p}\n`).join("") +
      "[write-lease]\n" +
      "[write-lease] A shell command reaches past the edit guard, so this is caught after the\n" +
      "[write-lease] fact rather than prevented. It is recorded on the lease and will block\n" +
      `[write-lease] completion (${unresolved} unresolved). Either revert these paths, or amend\n` +
      "[write-lease] the lease so the scope is honest:\n" +
      "[write-lease]\n" +
      `[write-lease]   npm run agent:lease-amend -- --add "${written[0]}" --reason "<why>"\n`
  );
  process.exit(REPORT);
}

if (process.argv[1]?.endsWith("bash-audit.mjs")) main();
