#!/usr/bin/env node
/**
 * PreToolUse guard — the point at which the write lease stops being a document.
 *
 * Wired in `.claude/settings.json` for Edit/Write/NotebookEdit and Bash/PowerShell. Exit 0 allows;
 * exit 2 blocks and returns stderr to the agent, which is how a Claude Code hook denies a call.
 *
 * Runs on EVERY edit, so it is plain `.mjs` executed by `node` with no transpiler in the path. A
 * `tsx` entry point would add roughly a second to every file write in the repository, and a guard
 * people are motivated to switch off protects nothing.
 *
 * ── With no active lease ──────────────────────────────────────────────────────────────────────
 *
 * Every repository write is blocked until deterministic routing grants a lease. The sole bootstrap
 * exception is one exact task-contract JSON file under docs/ai/contracts; the grant CLI validates
 * it before creating the lease. With no lease, shell is limited to an intentionally tiny command
 * grammar whose operations are read-only, plus the validated lease-grant control-plane command.
 * Shell metacharacters and write-like flags fail closed. With a lease, PostToolUse still observes
 * actual working-tree, committed and watched-ignored changes rather than trusting command text.
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

/** Only task-contract bootstrap writes are permitted before a lease exists. */
export function isContractControlPath(relativePath) {
  return /^docs\/ai\/contracts\/[a-z0-9][a-z0-9._-]*\.json$/i.test(relativePath) &&
    !relativePath.endsWith("/active-lease.json") &&
    !relativePath.endsWith("/TASK_CONTRACT.schema.json");
}

/**
 * A deliberately small no-lease shell grammar. It recognizes complete safe command families, not
 * arbitrary shell intent; uncertainty blocks. The precondition rejects chaining/redirection first.
 */
export function isReadOnlyShellCommand(command) {
  if (typeof command !== "string") return false;
  const value = command.trim();
  if (!value || /[;&|><`\r\n]/.test(value) || /\$\(|\$\{|\^/.test(value)) return false;
  if (/--(?:output|out|write|save|update|install|delete|remove|force|exec-path)\b/i.test(value)) return false;
  if (/^git\s+(?:status|diff|log|show|rev-parse|ls-files)(?:\s|$)/i.test(value)) {
    return !/--(?:ext-diff|textconv)\b|\s-[cC]\s/i.test(value);
  }
  if (/^graphify\s+(?:query|explain|path|affected|god-nodes|benchmark)(?:\s|$)/i.test(value)) return true;
  if (/^graphify\s+(?:diagnose\s+multigraph|hook\s+status|global\s+(?:list|path))(?:\s|$)/i.test(value)) return true;
  if (/^bd\s+(?:show|list|stats|ready|blocked)(?:\s|$)/i.test(value)) return true;
  if (/^claude\s+(?:--version|--help|mcp\s+list)\s*$/i.test(value)) return true;
  if (/^npm\s+run\s+agent:lease(?:\s+--\s*)?$/i.test(value)) return true;
  if (/^npm\s+run\s+agent:lease-grant\s+--\s+--task\s+\S+\s+--holder\s+\S+\s+--paths\s+.+$/i.test(value)) return true;
  if (/^node\s+tools\/agents\/task-gate\.mjs\s+\S+\s*$/i.test(value.replace(/\\/g, "/"))) return true;
  return false;
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
 * @returns {{allow: boolean, reason: "contract-control-plane"|"lease-required"|"in-scope"|"out-of-scope"}}
 */
export function decideWrite(lease, relativePath) {
  if (!lease) {
    return isContractControlPath(relativePath)
      ? { allow: true, reason: "contract-control-plane" }
      : { allow: false, reason: "lease-required" };
  }
  return leaseAllows(lease, relativePath)
    ? { allow: true, reason: "in-scope" }
    : { allow: false, reason: "out-of-scope" };
}

async function main() {
  let payload;
  try {
    const raw = await readStdin();
    if (!raw.trim()) throw new Error("empty hook payload");
    payload = JSON.parse(raw);
  } catch (error) {
    process.stderr.write(
      `[write-lease] BLOCKED: malformed PreToolUse payload (${error instanceof Error ? error.message : String(error)}).\n`
    );
    process.exit(BLOCK);
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

  const toolName = String(payload?.tool_name ?? "");
  if (/^(?:Bash|PowerShell)$/i.test(toolName)) {
    if (lease) process.exit(ALLOW);
    const command = payload?.tool_input?.command;
    if (isReadOnlyShellCommand(command)) process.exit(ALLOW);
    process.stderr.write(
      "[write-lease] BLOCKED: no active lease permits only bounded read-only shell discovery or\n" +
        "[write-lease] the validated agent:lease-grant command. Grant the routed writer lease first.\n"
    );
    process.exit(BLOCK);
  }

  const target = targetPathOf(payload);
  if (!target) {
    process.stderr.write("[write-lease] BLOCKED: write-capable hook payload has no resolvable target path.\n");
    process.exit(BLOCK);
  }

  const relativePath = toRepoRelative(target);
  if (!relativePath) {
    process.stderr.write("[write-lease] BLOCKED: target is outside or cannot be resolved within AWKIT.\n");
    process.exit(BLOCK);
  }

  const decision = decideWrite(lease, relativePath);
  if (decision.allow) process.exit(ALLOW);

  if (decision.reason === "lease-required") {
    process.stderr.write(
      `[write-lease] BLOCKED: ${relativePath}\n` +
        "[write-lease] No writer holds the repository lease. Create/validate the task contract,\n" +
        "[write-lease] then grant its deterministically routed writer before changing repository files.\n"
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
