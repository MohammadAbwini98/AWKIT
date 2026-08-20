#!/usr/bin/env node
/**
 * Ephemeral, non-authoritative state checkpoint for Claude compaction.
 *
 * Only repository/task facts needed to resume are allowlisted. Conversation content is never read
 * or serialized. Durable truth remains in Beads and docs/ai; this file merely bridges a compact
 * event and lives beneath LOCALAPPDATA, outside the repository.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { LEASE_PATH, REPO_ROOT, dirtyPaths, readLease } from "./lease.mjs";

const STATUS_KEYS = Object.freeze([
  ["objective", "objective"],
  ["acceptanceCriteria", "acceptance_criteria"],
  ["acceptance_criteria", "acceptance_criteria"],
  ["architectureDecisions", "architecture_decisions"],
  ["architecture_decisions", "architecture_decisions"],
  ["filesChanged", "files_changed"],
  ["files_changed", "files_changed"],
  ["commits", "commits"],
  ["completed", "completed"],
  ["unresolved", "unresolved"],
  ["defects", "defects"],
  ["checks", "checks"],
  ["securityConstraints", "security_constraints"],
  ["security_constraints", "security_constraints"],
  ["blockers", "blockers"],
  ["nextAction", "next_action"],
  ["next_action", "next_action"]
]);

/** @param {unknown} value @param {number} [depth] */
function conciseValue(value, depth = 0) {
  if (depth > 3) return undefined;
  if (typeof value === "string") return value.slice(0, 4_000);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => conciseValue(item, depth + 1)).filter((item) => item !== undefined);
  }
  if (!value || typeof value !== "object") return undefined;

  const out = {};
  for (const [key, child] of Object.entries(value).slice(0, 50)) {
    if (/transcript|compact.?summary|messages?|conversation|session.?state/i.test(key)) continue;
    const sanitized = conciseValue(child, depth + 1);
    if (sanitized !== undefined) out[key] = sanitized;
  }
  return out;
}

/** @param {unknown} value */
function strings(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string").slice(0, 200)
    : [];
}

/** @param {string} taskId */
function safeTaskId(taskId) {
  const safe = String(taskId || "unassigned").toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  return safe.replace(/^-+|-+$/g, "").slice(0, 96) || "unassigned";
}

/**
 * @param {{taskId?:string, localAppData?:string}} [input]
 * @returns {string}
 */
export function checkpointPathFor({ taskId = "unassigned", localAppData } = {}) {
  const base = resolve(localAppData || process.env.LOCALAPPDATA || join(tmpdir(), "AWKIT-local"));
  return resolve(base, "AWKIT", "claude-context", `${safeTaskId(taskId)}.json`);
}

/**
 * Build a sanitized checkpoint. Extra caller properties are intentionally ignored.
 *
 * @param {{taskId?:string, repository?:Record<string,any>, status?:Record<string,any>}} [input]
 */
export function buildCheckpoint({ taskId = "unassigned", repository = {}, status = {} } = {}) {
  const repo = repository && typeof repository === "object" ? repository : {};
  const state = status && typeof status === "object" ? status : {};
  const cleanStatus = {};
  for (const [source, target] of STATUS_KEYS) {
    if (!(source in state) || target in cleanStatus) continue;
    const value = conciseValue(state[source]);
    if (value !== undefined) cleanStatus[target] = value;
  }

  const lease = repo.activeLease ?? repo.active_lease;
  const cleanLease = lease && typeof lease === "object"
    ? {
        task: typeof lease.task === "string" ? lease.task : undefined,
        holder: typeof lease.holder === "string" ? lease.holder : undefined,
        status: typeof lease.status === "string" ? lease.status : undefined,
        allowed_paths: strings(lease.allowed_paths),
        violations: Array.isArray(lease.violations)
          ? lease.violations
              .filter((item) => item && item.resolved !== true)
              .slice(0, 50)
              .map((item) => ({ path: String(item.path ?? ""), resolved: false }))
          : []
      }
    : null;

  return {
    version: 1,
    kind: "awkit-ephemeral-context-checkpoint",
    authoritative: false,
    task_id: safeTaskId(taskId),
    captured_at: new Date().toISOString(),
    repository: {
      root: typeof repo.root === "string" ? repo.root : undefined,
      branch: typeof repo.branch === "string" ? repo.branch : undefined,
      head: typeof repo.head === "string" ? repo.head : undefined,
      changed_paths: strings(repo.changed_paths ?? repo.changed ?? repo.dirty),
      active_lease: cleanLease
    },
    status: cleanStatus
  };
}

/**
 * @param {{taskId?:string, localAppData?:string, repository?:Record<string,any>, status?:Record<string,any>}} input
 * @returns {{path:string, checkpoint:ReturnType<typeof buildCheckpoint>}}
 */
export function captureCheckpoint(input = {}) {
  const checkpoint = buildCheckpoint(input);
  const path = checkpointPathFor({ taskId: checkpoint.task_id, localAppData: input.localAppData });
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
  return { path, checkpoint };
}

/** @param {ReturnType<typeof buildCheckpoint>|null|undefined} checkpoint */
export function renderCheckpoint(checkpoint) {
  const value = checkpoint && typeof checkpoint === "object"
    ? checkpoint
    : buildCheckpoint({ taskId: "unassigned" });
  const repo = value.repository ?? {};
  const status = value.status ?? {};
  const lines = [
    "AWKIT EPHEMERAL, NON-AUTHORITATIVE COMPACTION CHECKPOINT",
    "Durable truth remains in Beads and docs/ai; verify live repository state before acting.",
    `Task: ${value.task_id ?? "unassigned"}`,
    `Repository: ${repo.branch ?? "unknown branch"} @ ${repo.head ?? "unknown head"}`
  ];
  if (repo.changed_paths?.length) lines.push(`Changed paths: ${repo.changed_paths.join(", ")}`);
  if (status.objective) lines.push(`Objective: ${status.objective}`);
  if (status.blockers?.length) lines.push(`Blockers: ${status.blockers.join("; ")}`);
  if (status.next_action) lines.push(`Next action: ${status.next_action}`);
  return lines.join("\n");
}

function git(args, cwd = REPO_ROOT) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

function contractStatus(taskId, cwd) {
  const path = join(cwd, "docs", "ai", "contracts", `${safeTaskId(taskId)}.json`);
  try {
    const contract = JSON.parse(readFileSync(path, "utf8"));
    return {
      objective: contract.task?.objective,
      acceptanceCriteria: (contract.acceptance ?? []).map((item) => item.description).filter(Boolean),
      architectureDecisions: contract.constraints?.architecture ?? [],
      filesChanged: contract.routing?.expected_paths ?? [],
      checks: (contract.evidence ?? []).map((item) => ({
        id: item.id,
        result: item.result,
        command: item.command
      })),
      securityConstraints: contract.constraints?.security ?? [],
      blockers: [],
      nextAction: contract.completion?.status === "complete" ? "No remaining task action." : "Re-read live task contract and continue the next unresolved acceptance criterion."
    };
  } catch {
    return { nextAction: "Inspect live Git, Beads, CURRENT_STATE and HANDOFF before continuing." };
  }
}

function liveInput(payload) {
  const cwd = typeof payload?.cwd === "string" ? resolve(payload.cwd) : REPO_ROOT;
  let lease = null;
  try {
    lease = cwd === REPO_ROOT ? readLease(LEASE_PATH) : null;
  } catch {
    lease = null;
  }
  const taskId = payload?.taskId ?? payload?.task_id ?? lease?.task ?? "unassigned";
  return {
    taskId,
    localAppData: payload?.localAppData,
    repository: {
      root: cwd,
      branch: git(["branch", "--show-current"], cwd),
      head: git(["rev-parse", "--short", "HEAD"], cwd),
      dirty: cwd === REPO_ROOT ? dirtyPaths(cwd) : [],
      activeLease: lease
    },
    status: contractStatus(taskId, cwd)
  };
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

if (process.argv[1]?.endsWith("compaction-checkpoint.mjs")) {
  const mode = process.argv[2] ?? "capture";
  try {
    const text = await readStdin();
    const payload = text.trim() ? JSON.parse(text) : {};
    const input = liveInput(payload);
    if (mode === "capture") {
      const result = captureCheckpoint(input);
      process.stdout.write(`${JSON.stringify({
        systemMessage: `AWKIT ephemeral checkpoint captured at ${result.path}`
      })}\n`);
    } else if (mode === "restore") {
      const path = checkpointPathFor({ taskId: input.taskId, localAppData: input.localAppData });
      const stored = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : buildCheckpoint(input);
      const additionalContext = renderCheckpoint(stored);
      process.stdout.write(`${JSON.stringify({
        systemMessage: "AWKIT ephemeral non-authoritative checkpoint restored.",
        hookSpecificOutput: { hookEventName: "PostCompact", additionalContext }
      })}\n`);
    } else {
      process.stdout.write("AWKIT checkpoint mode must be capture or restore.\n");
    }
  } catch (error) {
    // Compaction must never be blocked by checkpoint failure.
    process.stdout.write(`${JSON.stringify({
      systemMessage: `AWKIT ephemeral checkpoint unavailable: ${error instanceof Error ? error.message : String(error)}`
    })}\n`);
  }
}
