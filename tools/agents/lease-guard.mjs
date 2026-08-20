#!/usr/bin/env node
/**
 * PreToolUse guard — the point at which the write lease stops being a document.
 *
 * Wired in `.claude/settings.json` on the `Edit|Write|NotebookEdit` matcher, beside the graphify
 * guards that already run there. Exit 0 allows the edit; exit 2 blocks it and returns stderr to the
 * agent, which is how a Claude Code hook denies a tool call.
 *
 * Runs on EVERY edit, so it is plain `.mjs` executed by `node` with no transpiler in the path. A
 * `tsx` entry point would add roughly a second to every file write in the repository, and a guard
 * people are motivated to switch off protects nothing.
 *
 * ── With no active lease ──────────────────────────────────────────────────────────────────────
 *
 * Ordinary paths are allowed. Failing closed everywhere would block every task in a repository
 * where most work does not go through a contract, and a gate that stops all work gets removed
 * rather than obeyed.
 *
 * PROTECTED paths are not. Those are derived from the risk model — anything whose implied
 * classification is already Risk 3: licensing, auth, secrets, authorization, and the offline
 * boundary. An unclaimed edit there is precisely the event this system exists to catch, so it is
 * refused until someone takes a lease and is therefore answerable for it.
 *
 * ── Remaining limitation, stated rather than hidden ───────────────────────────────────────────
 *
 * BASH WRITES DO NOT REACH THIS HOOK. A shell redirect or `git checkout` never matches Edit or
 * Write, and widening the matcher to `Bash` would mean parsing arbitrary shell to guess at write
 * intent — unreliable in both directions. `bash-audit.mjs` covers that after the fact by observing
 * the filesystem, including the same protected paths when no lease is held.
 */

import { leaseAllows, readLease, toRepoRelative } from "./lease.mjs";
import { protectedPathFor } from "./routing-matrix.mjs";

const ALLOW = 0;
const BLOCK = 2;

/** @returns {Promise<string>} */
function readStdin() {
  return new Promise((resolvePromise) => {
    let data = "";
    if (process.stdin.isTTY) {
      resolvePromise("");
      return;
    }
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolvePromise(data));
    process.stdin.on("error", () => resolvePromise(""));
  });
}

/**
 * Pull the target path out of a PreToolUse payload.
 *
 * Every write-capable tool names its target differently, so this reads all of them rather than
 * assuming one shape. An unrecognised payload yields null and the guard allows — a guard that
 * blocked on tool inputs it did not understand would break the moment a new tool appeared.
 *
 * @param {Record<string, any>} payload
 * @returns {string|null}
 */
export function targetPathOf(payload) {
  const input = payload?.tool_input ?? {};
  return input.file_path ?? input.notebook_path ?? input.path ?? null;
}

/**
 * The whole decision, as a pure function.
 *
 * Extracted from `main()` so the verifier can drive every branch without spawning a process or
 * writing a lease file. A guard whose only tested part is its payload parser is a guard whose
 * actual judgement is untested — mutation testing showed exactly that, since flipping the
 * protected-path branch changed no assertion.
 *
 * @param {import("./lease.mjs").Lease|null} lease
 * @param {string} relativePath repo-relative, POSIX
 * @returns {{allow: boolean, reason: "no-lease-ordinary"|"in-scope"|"protected-unclaimed"|"out-of-scope", guarded?: object}}
 */
export function decideWrite(lease, relativePath) {
  if (!lease) {
    const guarded = protectedPathFor(relativePath);
    return guarded
      ? { allow: false, reason: "protected-unclaimed", guarded }
      : { allow: true, reason: "no-lease-ordinary" };
  }
  return leaseAllows(lease, relativePath)
    ? { allow: true, reason: "in-scope" }
    : { allow: false, reason: "out-of-scope" };
}

async function main() {
  let payload;
  try {
    const raw = await readStdin();
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    // An unreadable payload is an infrastructure problem, not a policy violation.
    process.exit(ALLOW);
  }

  let lease;
  try {
    lease = readLease();
  } catch (err) {
    // A DAMAGED lease blocks. It is loud, actionable, and one file away from fixed — and treating
    // it as "no lease" would let the gate be defeated by corrupting a single file.
    process.stderr.write(
      `[write-lease] ${err instanceof Error ? err.message : String(err)}\n` +
        "[write-lease] Edits are blocked until the lease file is valid or removed.\n"
    );
    process.exit(BLOCK);
  }

  const target = targetPathOf(payload);
  if (!target) process.exit(ALLOW);

  const relativePath = toRepoRelative(target);
  if (!relativePath) process.exit(ALLOW); // outside the repository entirely

  const decision = decideWrite(lease, relativePath);
  if (decision.allow) process.exit(ALLOW);

  if (decision.reason === "protected-unclaimed") {
    const guarded = decision.guarded;
    process.stderr.write(
      `[write-lease] BLOCKED: ${relativePath}\n` +
        `[write-lease] This path is PROTECTED (${guarded.glob}, owned by "${guarded.owner}") because\n` +
        `[write-lease] touching it implies ${guarded.impliesFlags.join(", ")} — already Risk 3.\n` +
        "[write-lease]\n" +
        "[write-lease] Most paths are writable with no lease held. These are not: an unclaimed edit\n" +
        "[write-lease] here would leave no one answerable for a licensing, auth, secret,\n" +
        "[write-lease] authorization or offline-boundary change. Take a lease first:\n" +
        "[write-lease]\n" +
        `[write-lease]   npm run agent:lease-grant -- --task <id> --holder ${guarded.owner} --paths "${guarded.glob}"\n`
    );
    process.exit(BLOCK);
  }

  process.stderr.write(
    `[write-lease] BLOCKED: ${relativePath}\n` +
      `[write-lease] "${lease.holder}" holds the lease for ${lease.task}, scoped to:\n` +
      lease.allowed_paths.map((p) => `[write-lease]   - ${p}\n`).join("") +
      "[write-lease]\n" +
      "[write-lease] This is scope expansion. Do not work around it — amend the lease, which\n" +
      "[write-lease] re-runs routing and may hand the work to the specialist who owns this path:\n" +
      "[write-lease]\n" +
      `[write-lease]   npm run agent:lease-amend -- --add "${relativePath}" --reason "<why>"\n`
  );
  process.exit(BLOCK);
}

if (process.argv[1]?.endsWith("lease-guard.mjs")) main();
