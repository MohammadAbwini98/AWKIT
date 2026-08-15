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
 * ── Two limitations, stated rather than hidden ────────────────────────────────────────────────
 *
 * 1. NO ACTIVE LEASE MEANS ALLOW. Failing closed would block every ordinary task in a repository
 *    where most work does not yet go through a contract, so the honest scope of this gate is
 *    "while a lease is held, it is real". The gap is closed at the other end: `completionBlockers`
 *    refuses to complete a task that changed product code without a contract, and
 *    `deriveClassification` reports what was actually touched regardless of what was declared.
 *
 * 2. BASH WRITES BYPASS IT. A shell redirect or `git checkout` never reaches a PreToolUse matcher
 *    for Edit or Write. Widening the matcher to `Bash` would mean parsing arbitrary shell to guess
 *    at write intent — unreliable in both directions. The derived-classification comparison is the
 *    backstop that catches this after the fact, which is the correct place for a check that cannot
 *    be made precise up front.
 *
 * Neither limitation is a reason to skip the gate. Both are reasons not to describe it as airtight.
 */

import { leaseAllows, readLease, toRepoRelative } from "./lease.mjs";

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

  if (!lease) process.exit(ALLOW);

  const target = targetPathOf(payload);
  if (!target) process.exit(ALLOW);

  const relativePath = toRepoRelative(target);
  if (!relativePath) process.exit(ALLOW); // outside the repository entirely

  if (leaseAllows(lease, relativePath)) process.exit(ALLOW);

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

main();
