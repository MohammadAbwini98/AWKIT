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
 * Ordinary repository work is allowed directly. Risk-3 paths still require deterministic routing
 * and a lease; this guard derives those paths from the routing matrix. With a lease, PostToolUse
 * still observes actual working-tree, committed and watched-ignored changes rather than trusting
 * command text.
 */

import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import {
  REPO_ROOT,
  SYSTEM_BOOKKEEPING_PATHS,
  leaseAllows,
  readLease,
  resolveContractPath,
  toRepoRelative
} from "./lease.mjs";
import { DENIAL_TERMINAL_THRESHOLD, recordDenial } from "./guard-denials.mjs";
import { CONCURRENCY_POLICY } from "./context-policy.mjs";
import { AGENTS, agent, protectedPathFor } from "./routing-matrix.mjs";
import { evaluateTaskGate } from "./task-gate.mjs";

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
 * assuming one shape. An unrecognised payload yields null and fails closed in `main()`; a new
 * write-capable tool must declare how its target is resolved before the project enables it.
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
  return /^docs\/ai\/contracts\/[a-z0-9][a-z0-9._-]*\.json$/.test(relativePath) &&
    !relativePath.endsWith("/active-lease.json") &&
    !relativePath.endsWith("/task_contract.schema.json");
}

/**
 * A deliberately small no-lease shell grammar. It recognizes complete safe command families, not
 * arbitrary shell intent; uncertainty blocks. The precondition rejects chaining/redirection first.
 */
export function isReadOnlyShellCommand(command) {
  if (typeof command !== "string") return false;
  const value = command.trim();
  if (!value || /[;&|><`\r\n]/.test(value) || /\$\(|\$\{|\^/.test(value)) return false;
  if (/--(?:output|out|write|save|update|install|delete|remove|force|exec-path|graph|extract-path)\b/i.test(value)) return false;
  if (/^git\s+(?:status|diff|log|show|rev-parse|ls-files)(?:\s|$)/i.test(value)) {
    return !/--(?:ext-diff|textconv)\b|\s-[cC]\s/i.test(value);
  }
  if (/^graphify\s+(?:query|explain|path|affected|god-nodes|benchmark)(?:\s|$)/i.test(value)) return true;
  if (/^graphify\s+(?:diagnose\s+multigraph|hook\s+status|global\s+(?:list|path))(?:\s|$)/i.test(value)) return true;
  if (/^bd\s+(?:show|list|stats|ready|blocked)(?:\s|$)/i.test(value)) {
    return !hasForbiddenBdOptions(value, false);
  }
  if (/^claude\s+(?:--version|--help|mcp\s+list)\s*$/i.test(value)) return true;
  if (/^npm\s+run\s+agent:lease(?:\s+--\s*)?$/i.test(value)) return true;
  if (
    /^node\s+tools\/agents\/task-gate\.mjs\s+docs\/ai\/contracts\/[a-z0-9][a-z0-9._-]*\.json\s*$/.test(
      value.replace(/\\/g, "/")
    )
  ) return true;
  const check = value.replace(/\\/g, "/").match(/^node\s+--check\s+([A-Za-z0-9_./-]+\.(?:[cm]?[jt]sx?))\s*$/i);
  if (check && !check[1].split("/").includes("..") && !check[1].startsWith("/")) return true;
  return false;
}

/** Map a Claude hook `agent_type` to the canonical routing id. Root calls have no type and are Manager. */
export function canonicalActorId(agentType, agentId) {
  if (agentType === undefined || agentType === null || agentType === "") {
    // Official hooks populate both fields inside a subagent. `agent_id` without a usable type is
    // degraded identity evidence, not proof that the call came from the root Manager.
    return agentId ? null : "manager";
  }
  const value = String(agentType);
  return AGENTS.find((entry) => entry.claudeName === value)?.id ?? null;
}

/**
 * True only for the ROOT primary agent.
 *
 * Deliberately stricter than "canonicalizes to manager": a real spawned Manager subagent carries
 * `agent_type: "awkit-manager"` and also canonicalizes to "manager", but it is a subagent and must
 * never be treated as the root. An `agent_id` with no usable type stays degraded identity evidence
 * and is not a root call either.
 */
export function isRootPrimaryIdentity(agentType, agentId) {
  return (agentType === undefined || agentType === null || agentType === "") && !agentId;
}

/**
 * Which routing identity may exercise `lease` for this call.
 *
 * Single-agent mode (`CONCURRENCY_POLICY.defaultMode`) is the operating model: one primary agent
 * does the whole task, and a routed role names who is accountable rather than instructing a spawn.
 * Without this the model is unusable — the root call always canonicalizes to "manager", every lease
 * decision demands `actor === lease.holder`, and the contract validator refuses to name manager as
 * writer for a path manager does not own. The intersection is empty, so the primary agent could
 * write only manager-owned paths.
 *
 * The relaxation is EXACTLY ONE THING: which process identity may exercise an already-granted
 * routed lease. It grants no paths and widens no ownership. `decideWrite`/`leaseAllows` still bound
 * every write to that lease's own allowed_paths, deterministic routing and the contract validator
 * still decide who may hold a lease over which paths at all, and the shell allowlist still returns
 * only the command set of the role whose lease is held. Outside single-agent mode, and for every
 * real subagent, the actor is returned unchanged.
 */
export function effectiveActorFor(lease, agentType, agentId, policy = CONCURRENCY_POLICY) {
  const actor = canonicalActorId(agentType, agentId);
  // Unknown/degraded identity stays null and fails closed; a real subagent stays itself.
  if (actor !== "manager") return actor;
  if (!isRootPrimaryIdentity(agentType, agentId)) return actor;
  if (policy?.defaultMode !== "single-agent") return actor;
  const holder = lease?.holder;
  // An injected or unknown holder must never become an identity — `agent()` throws on unknown ids.
  if (!holder || !AGENTS.some((entry) => entry.id === holder)) return actor;
  return holder;
}

/** Resolve existing targets (or their nearest existing parent) so NTFS junctions cannot escape. */
export function isPhysicallyWithinRepo(candidate, repoRoot = REPO_ROOT) {
  if (typeof candidate !== "string" || !candidate) return false;
  const rootReal = realpathSync(repoRoot);
  const absolute = resolve(repoRoot, candidate);
  let probe = absolute;
  while (true) {
    try {
      lstatSync(probe);
    } catch (error) {
      if (!error || typeof error !== "object" || error.code !== "ENOENT") return false;
      const parent = dirname(probe);
      if (parent === probe) return false;
      probe = parent;
      continue;
    }
    try {
      const probeReal = realpathSync(probe);
      const rel = relative(rootReal, probeReal).replace(/\\/g, "/");
      return rel === "" || (rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel));
    } catch {
      // A dangling symlink/junction or unreadable reparse point is enforcement uncertainty.
      return false;
    }
  }
}

/** Shell characters that could make an allowed prefix execute a second, hidden operation. */
export function hasUnsafeShellSyntax(command) {
  if (typeof command !== "string") return true;
  const value = command.trim();
  return !value || /[;&|><`\r\n]/.test(value) || /\$\(|\$\{|\^/.test(value);
}

/** Exact lease bootstrap command. The CLI performs contract/routing/path validation before writing. */
export function isLeaseGrantCommand(command) {
  if (hasUnsafeShellSyntax(command)) return false;
  return /^npm\s+run\s+agent:lease-grant\s+--\s+--task\s+[a-z0-9][a-z0-9._-]*\s+--holder\s+[a-z0-9-]+\s+--paths\s+[^\s]+\s*$/i.test(
    command.trim()
  );
}

/** Manager-only lease transitions while another specialist holds the serialized writer slot. */
export function isLeaseLifecycleCommand(command) {
  if (hasUnsafeShellSyntax(command)) return false;
  const value = command.trim();
  if (/^npm\s+run\s+agent:lease-release\s+--\s+--reason\s+.+$/i.test(value)) return true;
  if (/^npm\s+run\s+agent:lease-amend\s+--\s+--add\s+[^\s]+\s+--reason\s+.+$/i.test(value)) return true;
  if (isLeaseHandoffCommand(value)) return true;
  if (isLeaseFinalizeCommand(value)) return true;
  return false;
}

/** Exact direct CLI handoff; it advances one routed lease and has no no-lease mode. */
export function isLeaseHandoffCommand(command) {
  if (hasUnsafeShellSyntax(command)) return false;
  const tokens = shellTokens(command.trim());
  if (!tokens || tokens.length < 9) return false;
  if (tokens[0] !== "node" || tokens[1] !== "tools/agents/lease-cli.mjs" || tokens[2] !== "handoff") return false;
  if (tokens[3] !== "--holder" || !/^[a-z0-9-]+$/i.test(tokens[4] ?? "")) return false;
  if (tokens[5] !== "--paths" || !/^[^\s,]+(?:,[^\s,]+)*$/.test(tokens[6] ?? "")) return false;
  return tokens[7] === "--reason" && tokens.slice(8).every((token) => token.length > 0 && !token.startsWith("--"));
}

/** Exact terminal control-plane command; final state validation lives in lease.mjs. */
export function isLeaseFinalizeCommand(command) {
  if (hasUnsafeShellSyntax(command)) return false;
  const tokens = shellTokens(command.trim());
  if (!tokens) return false;
  const start =
    tokens[0] === "npm" && tokens[1] === "run" && tokens[2] === "agent:lease-finalize" && tokens[3] === "--"
      ? 4
      : tokens[0] === "node" && tokens[1] === "tools/agents/lease-cli.mjs" && tokens[2] === "finalize"
        ? 3
        : null;
  if (start === null || tokens.length < start + 6) return false;
  if (tokens[start] !== "--task" || !/^[a-z0-9][a-z0-9._-]*$/i.test(tokens[start + 1] ?? "")) return false;
  if (tokens[start + 2] !== "--lease-id" || !/^[a-z0-9][a-z0-9._:-]*$/i.test(tokens[start + 3] ?? "")) return false;
  return tokens[start + 4] === "--reason" && tokens.slice(start + 5).every((token) => token.length > 0 && !token.startsWith("--"));
}

/** Minimal shell tokenization for exact Git lifecycle commands; uncertainty returns null. */
export function shellTokens(command) {
  if (typeof command !== "string") return null;
  const tokens = [];
  const expression = /\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))/gy;
  let cursor = 0;
  while (cursor < command.length) {
    expression.lastIndex = cursor;
    const match = expression.exec(command);
    if (!match || match.index !== cursor) return null;
    tokens.push(match[1] ?? match[2] ?? match[3]);
    cursor = expression.lastIndex;
  }
  return tokens;
}

/** Inspect parsed argv, not raw text, so quoted Cobra flags cannot evade the boundary. */
export function hasForbiddenBdOptions(command, writeMode) {
  const tokens = shellTokens(command);
  if (!tokens) return true;
  const forbidden = new Set([
    "--db",
    "--directory",
    "--global",
    "--profile",
    ...(writeMode
      ? [
          "--body-file",
          "--design-file",
          "--reason-file",
          "--file",
          "--stdin",
          "--metadata",
          "--set-metadata",
          "--include-memories",
          "--include-infra",
          "--all",
          "--force",
          "--repo",
          "--graph"
        ]
      : [])
  ]);
  return tokens.some((token) => {
    const value = token.toLowerCase();
    if (value === "-c" || value.startsWith("-c") && !value.startsWith("--")) return true;
    if (writeMode && (value === "-f" || value.startsWith("-f") && !value.startsWith("--"))) return true;
    for (const flag of forbidden) {
      if (value === flag || value.startsWith(`${flag}=`)) return true;
    }
    return false;
  });
}

function boundedStagePath(lease, candidate) {
  if (!candidate || candidate.startsWith("-") || /[*?\[\]{}!]/.test(candidate)) return false;
  const relative = toRepoRelative(candidate);
  if (!relative) return false;
  if (!isPhysicallyWithinRepo(relative)) return false;
  return (
    leaseAllows(lease, relative) ||
    SYSTEM_BOOKKEEPING_PATHS.includes(relative) ||
    relative === `docs/ai/contracts/${lease.task}.json`
  );
}

/** Exact, scoped Git commands reserved for the root Manager. */
export function isManagerGitCommand(
  command,
  lease,
  { stagedPaths = [], pushAuthorized = false } = {}
) {
  if (!lease || hasUnsafeShellSyntax(command)) return false;
  const tokens = shellTokens(command.trim());
  if (!tokens) return false;

  if (tokens.length === 3 && tokens[0] === "git" && tokens[1] === "fetch" && tokens[2] === "origin") {
    return true;
  }
  if (
    tokens.length === 4 &&
    tokens[0] === "git" &&
    tokens[1] === "push" &&
    tokens[2] === "origin" &&
    tokens[3] === "main"
  ) {
    return pushAuthorized;
  }
  if (tokens[0] === "git" && tokens[1] === "add" && tokens[2] === "--" && tokens.length > 3) {
    return tokens.slice(3).every((path) => boundedStagePath(lease, path));
  }
  if (tokens[0] === "git" && tokens[1] === "commit" && tokens[2] === "-m" && tokens.length === 4) {
    return stagedPaths.every((path) => boundedStagePath(lease, path));
  }
  return false;
}

function isUnleasedStagePath(path) {
  const normalized = String(path ?? "").replace(/\\/g, "/");
  return (
    normalized.length > 0 &&
    !normalized.startsWith("/") &&
    !normalized.split("/").some((part) => !part || part === "." || part === "..") &&
    !/[*?[\]{}]/.test(normalized) &&
    isPhysicallyWithinRepo(normalized) &&
    protectedPathFor(normalized) === null
  );
}

/** Direct-main Git is available for ordinary, unleased work; Risk-3 paths remain lease-only. */
export function isUnleasedGitCommand(command, { stagedPaths = [] } = {}) {
  if (hasUnsafeShellSyntax(command)) return false;
  const tokens = shellTokens(command.trim());
  if (!tokens) return false;
  if (tokens.length === 3 && tokens[0] === "git" && tokens[1] === "fetch" && tokens[2] === "origin") return true;
  if (tokens.length === 4 && tokens[0] === "git" && tokens[1] === "push" && tokens[2] === "origin" && tokens[3] === "main") return true;
  if (tokens[0] === "git" && tokens[1] === "add" && tokens[2] === "--" && tokens.length > 3) {
    return tokens.slice(3).every(isUnleasedStagePath);
  }
  if (tokens[0] === "git" && tokens[1] === "commit" && tokens[2] === "-m" && tokens.length === 4) {
    return stagedPaths.length > 0 && stagedPaths.every(isUnleasedStagePath);
  }
  return false;
}

function isCommonWriterCommand(command) {
  if (hasUnsafeShellSyntax(command)) return false;
  const value = command.trim().replace(/\\/g, "/");
  if (/^npm\s+run\s+(?:build|typecheck|typecheck:scripts)\s*$/i.test(value)) return true;
  if (/^npm\s+run\s+(?:verify|validate|benchmark):[a-z0-9:_-]+\s*$/i.test(value)) return true;
  if (value === "npm run validate:offline -- -Strict") return true;
  if (value === "graphify update .") return true;
  const check = value.match(/^node\s+--check\s+([A-Za-z0-9_./-]+\.(?:[cm]?[jt]sx?))\s*$/i);
  return Boolean(check && !check[1].split("/").includes("..") && !check[1].startsWith("/"));
}

function isReleaseCommand(command) {
  if (hasUnsafeShellSyntax(command)) return false;
  const value = command.trim();
  return (
    /^npm\s+run\s+package:[a-z0-9:_-]+\s*$/i.test(value) ||
    value === "npm run icon:generate"
  );
}

function isProjectStateCommand(command) {
  if (hasUnsafeShellSyntax(command)) return false;
  const value = command.trim().replace(/\\/g, "/");
  if (hasForbiddenBdOptions(value, true)) return false;
  if (value === "bd export -o .beads/issues.jsonl") return true;
  if (/^bd\s+(?:create|update|close)(?:\s|$)/i.test(value)) return true;
  if (/^bd\s+dep\s+add\s+[a-z0-9._:-]+\s+[a-z0-9._:-]+(?:\s+--type\s+[a-z-]+)?\s*$/i.test(value)) return true;
  if (/^npm\s+run\s+(?:ai:memory(?::check)?|verify:roadmap-dashboard)\s*$/i.test(value)) return true;
  return value === "node tools/agents/render-docs.mjs --write";
}

function isManagerWriterCommand(command) {
  if (hasUnsafeShellSyntax(command)) return false;
  const value = command.trim().replace(/\\/g, "/");
  return (
    value === "node tools/agents/render-platform-agents.mjs --write" ||
    /^npm\s+run\s+agent:check-agents\s*$/i.test(value)
  );
}

/**
 * Role-aware active-lease shell decision. Read-only discovery is available to every activated
 * specialist; commands that can change repository state belong only to the active holder. The root
 * Manager may serialize lease transitions and a tightly scoped Git lifecycle, but it cannot run a
 * different specialist's implementation/build commands.
 */
export function isAllowedActiveShellCommand(
  command,
  lease,
  {
    agentType,
    agentId,
    stagedPaths = [],
    pushAuthorized = false,
    runInBackground = false,
    policy = CONCURRENCY_POLICY
  } = {}
) {
  if (!lease || runInBackground || hasUnsafeShellSyntax(command)) return false;
  if (isReadOnlyShellCommand(command)) return true;

  const actor = canonicalActorId(agentType, agentId);
  if (!actor) return false;
  if (actor === "manager") {
    if (isLeaseLifecycleCommand(command)) return true;
    if (isManagerGitCommand(command, lease, { stagedPaths, pushAuthorized })) return true;
  }
  // Same relaxation as the write path, so shell and write decisions cannot disagree. The role
  // command sets below stay keyed on `lease.holder`, so the relaxed actor gets only the commands
  // already permitted to this lease's holder — no new command becomes runnable.
  if (effectiveActorFor(lease, agentType, agentId, policy) !== lease.holder) return false;

  // Validates the holder id and keeps an injected/unknown lease fail-closed.
  const holder = agent(lease.holder);
  if (holder.defaultMode !== "writer") return false;
  if (isCommonWriterCommand(command)) return true;
  if (lease.holder === "release" && isReleaseCommand(command)) return true;
  if (lease.holder === "project-state" && isProjectStateCommand(command)) return true;
  if (lease.holder === "manager" && isManagerWriterCommand(command)) return true;
  return false;
}

/** Commands for the direct loop when no critical-path lease is active. */
export function isAllowedUnleasedShellCommand(command, { stagedPaths = [], agentType, agentId } = {}) {
  if (!isRootPrimaryIdentity(agentType, agentId)) return false;
  return (
    isReadOnlyShellCommand(command) ||
    isCommonWriterCommand(command) ||
    isManagerWriterCommand(command) ||
    isUnleasedGitCommand(command, { stagedPaths }) ||
    isLeaseGrantCommand(command) ||
    isLeaseFinalizeCommand(command)
  );
}

/**
 * The whole decision, as a pure function.
 *
 * Extracted from `main()` so the verifier can drive every branch without spawning a process or
 * writing a lease file. A guard whose only tested part is its payload parser is a guard whose
 * actual judgement is untested — mutation testing showed exactly that, since flipping the
 * protected-path branch changed no assertion.
 *
 * Required closeout bookkeeping (`SYSTEM_BOOKKEEPING_PATHS`) is writable under ANY active lease:
 * the end-of-task checklist obliges the holder to update those files, so blocking them by scope
 * manufactured amendment loops (2026-09 diagnostic). An active lease is still required — only
 * the scope check is waived, and only for this exact list. Without a lease, routine paths stay
 * directly writable while paths derived as Risk 3 remain protected.
 *
 * @param {import("./lease.mjs").Lease|null} lease
 * @param {string} relativePath repo-relative, POSIX
 * @returns {{allow: boolean, reason: "contract-control-plane"|"lease-required"|"unleased-routine"|"system-bookkeeping"|"in-scope"|"out-of-scope"}}
 */
export function decideWrite(lease, relativePath) {
  if (
    isContractControlPath(relativePath) &&
    (!lease || relativePath === `docs/ai/contracts/${lease.task}.json`)
  ) {
    return { allow: true, reason: "contract-control-plane" };
  }
  if (!lease) {
    return protectedPathFor(relativePath)
      ? { allow: false, reason: "lease-required" }
      : { allow: true, reason: "unleased-routine" };
  }
  if (SYSTEM_BOOKKEEPING_PATHS.includes(relativePath)) {
    return { allow: true, reason: "system-bookkeeping" };
  }
  return leaseAllows(lease, relativePath)
    ? { allow: true, reason: "in-scope" }
    : { allow: false, reason: "out-of-scope" };
}

/**
 * Add actor identity to the pure write decision. Unknown/non-holder subagents never borrow a lease.
 *
 * `decideWrite` runs FIRST and is untouched, so lease path scope is decided before identity is even
 * consulted: an out-of-scope path is refused for the root primary exactly as for anyone else, and
 * the single-agent relaxation can only ever change WHO exercises the lease, never WHAT it covers.
 */
export function decideActorWrite(lease, relativePath, agentType, agentId, policy = CONCURRENCY_POLICY) {
  const base = decideWrite(lease, relativePath);
  if (!base.allow) return base;
  if (base.reason === "unleased-routine") {
    return isRootPrimaryIdentity(agentType, agentId)
      ? base
      : { allow: false, reason: "non-holder" };
  }
  const actor = canonicalActorId(agentType, agentId);
  if (!actor) return { allow: false, reason: "unknown-actor" };
  if (base.reason === "contract-control-plane") {
    return actor === "manager" ? base : { allow: false, reason: "non-holder" };
  }
  if (effectiveActorFor(lease, agentType, agentId, policy) !== lease?.holder) {
    return { allow: false, reason: "non-holder" };
  }
  return base;
}

function stagedPaths() {
  return execFileSync("git", ["diff", "--cached", "--name-only"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  })
    .split("\n")
    .map((path) => path.trim().replace(/\\/g, "/"))
    .filter(Boolean);
}

/** Push is an external state change, so the task contract must authorize it after QA/QC. */
export function pushAuthorizedForLease(lease) {
  try {
    const contract = JSON.parse(
      readFileSync(resolveContractPath(lease?.contract_path, lease?.task), "utf8")
    );
    if (
      contract.task?.id !== lease?.task ||
      contract.git?.direct_main !== true ||
      contract.git?.push_authorized !== true
    ) return false;

    const pushEvidenceId = contract.git?.push_evidence_id;
    const evidence = Array.isArray(contract.evidence)
      ? contract.evidence.find((item) => item?.id === pushEvidenceId)
      : null;
    if (
      !evidence ||
      evidence.required !== true ||
      !["pending", "PASS"].includes(evidence.result) ||
      typeof evidence.command !== "string" ||
      !/(?:^|\s)git\s+push\s+origin\s+main(?:\s|$)/.test(evidence.command)
    ) return false;

    // The push is the only evidence that cannot be PASS before it happens. Evaluate a prospective
    // copy with that one item satisfied; every other evidence, preserved-path, scope, QA/QC and
    // lease-history blocker remains live and must already pass.
    const prospective = JSON.parse(JSON.stringify(contract));
    prospective.evidence.find((item) => item?.id === pushEvidenceId).result = "PASS";
    return evaluateTaskGate(prospective, { lease }).ok;
  } catch {
    return false;
  }
}

/**
 * Classify a denial and, once the SAME operation has been denied DENIAL_TERMINAL_THRESHOLD
 * times in one Claude session, mark it TERMINAL instead of returning another open-ended
 * remediation instruction. The 2026-09 diagnostic measured 158 such denials in one session
 * before this existed. Counting is best-effort: any ledger failure degrades to the plain
 * correctable classification and never changes the allow/block decision.
 *
 * @param {string} intent stable identity of the denied operation (e.g. "write:src/x.ts")
 * @param {Record<string, any>} payload the PreToolUse hook payload (session_id)
 * @returns {string}
 */
function denialNotice(intent, payload) {
  let recorded = { count: 1, terminal: false };
  try {
    recorded = recordDenial({
      intent,
      sessionId: payload?.session_id,
      localAppData: payload?.localAppData
    });
  } catch {
    // Fail open to the uncounted classification.
  }
  if (recorded.terminal) {
    return (
      `[write-lease] Classification: TERMINAL for this gate — identical denial #${recorded.count} this session.\n` +
      "[write-lease] Do not attempt another variant. Report this gate as BLOCKED with the reason above\n" +
      "[write-lease] and continue independent work (AGENTS.md > Stopping semantics).\n"
    );
  }
  return (
    `[write-lease] Classification: correctable — bounded remediation (denial ${recorded.count} of ` +
    `${DENIAL_TERMINAL_THRESHOLD} for this operation this session).\n`
  );
}

/** Stable intent identity for a shell denial: the first two command tokens. */
function shellIntent(command) {
  const tokens = String(command ?? "").trim().split(/\s+/).filter(Boolean);
  return `shell:${tokens.slice(0, 2).join(" ")}`;
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
    const command = payload?.tool_input?.command;
    if (payload?.tool_input?.run_in_background === true) {
      process.stderr.write(
        "[write-lease] BLOCKED: background shell commands can outlive their holder's lease.\n"
      );
      process.exit(BLOCK);
    }
    if (!lease) {
      let cachedPaths = [];
      if (/^git\s+commit\s/i.test(String(command ?? "").trim())) {
        try {
          cachedPaths = stagedPaths();
        } catch (error) {
          process.stderr.write(
            `[write-lease] BLOCKED: cannot verify staged paths before commit (${error instanceof Error ? error.message : String(error)}).\n`
          );
          process.exit(BLOCK);
        }
      }
      if (isAllowedUnleasedShellCommand(command, {
        stagedPaths: cachedPaths,
        agentType: payload?.agent_type,
        agentId: payload?.agent_id
      })) {
        process.exit(ALLOW);
      }
      process.stderr.write(
        "[write-lease] BLOCKED: direct work permits only bounded routine commands and direct-main Git.\n" +
          "[write-lease] Risk-3 paths and unsupported shell operations still require a routed lease.\n" +
          denialNotice(shellIntent(command), payload)
      );
      process.exit(BLOCK);
    }

    let cachedPaths = [];
    if (/^git\s+commit\s/i.test(String(command ?? "").trim())) {
      try {
        cachedPaths = stagedPaths();
      } catch (error) {
        process.stderr.write(
          `[write-lease] BLOCKED: cannot verify staged paths before commit (${error instanceof Error ? error.message : String(error)}).\n`
        );
        process.exit(BLOCK);
      }
    }
    if (
      isAllowedActiveShellCommand(command, lease, {
        agentType: payload?.agent_type,
        agentId: payload?.agent_id,
        stagedPaths: cachedPaths,
        pushAuthorized: pushAuthorizedForLease(lease),
        runInBackground: payload?.tool_input?.run_in_background === true
      })
    ) {
      process.exit(ALLOW);
    }
    process.stderr.write(
      "[write-lease] BLOCKED: shell command is outside the active " + lease.holder + " lease or the actor's role.\n" +
        "[write-lease] Use one bounded command per call (no chaining), or amend/reroute the lease once —\n" +
        "[write-lease] a second denial for the same operation should be reported as BLOCKED, not retried.\n" +
        denialNotice(shellIntent(command), payload)
    );
    process.exit(BLOCK);
  }

  const target = targetPathOf(payload);
  if (!target) {
    process.stderr.write("[write-lease] BLOCKED: write-capable hook payload has no resolvable target path.\n");
    process.exit(BLOCK);
  }

  if (!isPhysicallyWithinRepo(target)) {
    process.stderr.write(
      "[write-lease] BLOCKED: target or its nearest existing parent resolves outside AWKIT.\n"
    );
    process.exit(BLOCK);
  }

  const relativePath = toRepoRelative(target);
  if (!relativePath) {
    process.stderr.write("[write-lease] BLOCKED: target is outside or cannot be resolved within AWKIT.\n");
    process.exit(BLOCK);
  }

  const decision = decideActorWrite(lease, relativePath, payload?.agent_type, payload?.agent_id);
  if (decision.allow) process.exit(ALLOW);

  if (decision.reason === "lease-required") {
    process.stderr.write(
      `[write-lease] BLOCKED: ${relativePath}\n` +
        "[write-lease] No writer holds the repository lease. Create/validate the task contract,\n" +
        "[write-lease] then grant its deterministically routed writer before changing repository files.\n" +
        denialNotice(`write:${relativePath}`, payload)
    );
    process.exit(BLOCK);
  }

  if (decision.reason === "unknown-actor" || decision.reason === "non-holder") {
    process.stderr.write(
      `[write-lease] BLOCKED: ${relativePath}\n` +
        `[write-lease] hook actor ${JSON.stringify(payload?.agent_type ?? "awkit-manager")} does not hold ` +
        `the active ${lease?.holder ?? "missing"} lease.\n` +
        "[write-lease] Classification: authorization — terminal for this actor. Report it as BLOCKED; do not\n" +
        "[write-lease] retry variants of the same write.\n"
    );
    process.exit(BLOCK);
  }

  process.stderr.write(
    `[write-lease] BLOCKED: ${relativePath}\n` +
      `[write-lease] "${lease.holder}" holds the lease for ${lease.task}, scoped to:\n` +
      lease.allowed_paths.map((p) => `[write-lease]   - ${p}\n`).join("") +
      "[write-lease]\n" +
      "[write-lease] This is scope expansion. ONE amendment may fix it; repeated amendments for one task are a\n" +
      "[write-lease] scope-planning defect to report, not to keep amending:\n" +
      "[write-lease]\n" +
      `[write-lease]   npm run agent:lease-amend -- --add "${relativePath}" --reason "<why>"\n` +
      denialNotice(`write:${relativePath}`, payload)
  );
  process.exit(BLOCK);
}

if (process.argv[1]?.endsWith("lease-guard.mjs")) main();
