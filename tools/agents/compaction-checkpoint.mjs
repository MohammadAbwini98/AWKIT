#!/usr/bin/env node
/**
 * Ephemeral, non-authoritative state checkpoint for Claude compaction.
 *
 * Only repository/task facts needed to resume are allowlisted. Conversation content is never read
 * or serialized. Durable truth remains in Beads and docs/ai; this file merely bridges a compact
 * event and lives beneath LOCALAPPDATA, outside the repository.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { LEASE_PATH, REPO_ROOT, dirtyPaths, readLease } from "./lease.mjs";
import { completionBlockers } from "./validate-contract.mjs";

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
  ["dataConstraints", "data_constraints"],
  ["data_constraints", "data_constraints"],
  ["offlineConstraints", "offline_constraints"],
  ["offline_constraints", "offline_constraints"],
  ["compatibilityConstraints", "compatibility_constraints"],
  ["compatibility_constraints", "compatibility_constraints"],
  ["blockers", "blockers"],
  ["nextAction", "next_action"],
  ["next_action", "next_action"]
]);

const SENSITIVE_KEY = /(?:pass(?:word|phrase)?|secret|token|cookie|credential|authorization|api[_-]?key|private[_-]?key|connection[_-]?string|session[_-]?(?:id|state|token)|compact.?summary|transcript|messages?|conversation)/i;
const SENSITIVE_TEXT = /(?:pass(?:word|phrase)?|secret|token|cookie|credential|authorization|bearer|api[_-]?key|private[_-]?key|connection[_-]?string|BEGIN [A-Z ]*PRIVATE KEY|(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|mssql|oracle):\/\/)/i;

/** @param {unknown} value @param {number} [depth] */
function conciseValue(value, depth = 0) {
  if (depth > 3) return undefined;
  if (typeof value === "string") {
    const bounded = value.slice(0, 4_000);
    return SENSITIVE_TEXT.test(bounded) ? "[REDACTED SENSITIVE TEXT]" : bounded;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => conciseValue(item, depth + 1)).filter((item) => item !== undefined);
  }
  if (!value || typeof value !== "object") return undefined;

  const out = {};
  for (const [key, child] of Object.entries(value).slice(0, 50)) {
    if (SENSITIVE_KEY.test(key)) continue;
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
 * A live hook supplies `session_id`, but it must never be persisted. Hashing it lets PreCompact and
 * the following compact SessionStart find the same ephemeral file without exposing the identifier.
 * Direct callers may omit it and retain the task-id path used by verifier fixtures.
 *
 * @param {{taskId?:string, sessionId?:string, localAppData?:string}} [input]
 * @returns {string}
 */
export function checkpointPathFor({ taskId = "unassigned", sessionId, localAppData } = {}) {
  const base = resolve(localAppData || process.env.LOCALAPPDATA || join(tmpdir(), "AWKIT-local"));
  const filename = sessionId
    ? `session-${createHash("sha256").update(String(sessionId)).digest("hex").slice(0, 24)}.json`
    : `${safeTaskId(taskId)}.json`;
  return resolve(base, "AWKIT", "claude-context", filename);
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
 * @param {{taskId?:string, sessionId?:string, localAppData?:string, repository?:Record<string,any>, status?:Record<string,any>}} input
 * @returns {{path:string, checkpoint:ReturnType<typeof buildCheckpoint>}}
 */
export function captureCheckpoint(input = {}) {
  const checkpoint = buildCheckpoint(input);
  const path = checkpointPathFor({
    taskId: checkpoint.task_id,
    sessionId: input.sessionId,
    localAppData: input.localAppData
  });
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
  const show = (label, value) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value) && value.length === 0) return;
    if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) return;
    lines.push(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  };

  show("Actual changed paths", repo.changed_paths);
  if (repo.active_lease) {
    show("Active write lease", {
      holder: repo.active_lease.holder,
      status: repo.active_lease.status,
      allowed_paths: repo.active_lease.allowed_paths,
      unresolved_violations: repo.active_lease.violations
    });
  }
  show("Objective", status.objective);
  show("Acceptance criteria", status.acceptance_criteria);
  show("Architecture decisions", status.architecture_decisions);
  show("Commits", status.commits);
  show("Completed work", status.completed);
  show("Unresolved work", status.unresolved);
  show("Defects", status.defects);
  show("Checks", status.checks);
  show("Security constraints", status.security_constraints);
  show("Data constraints", status.data_constraints);
  show("Offline constraints", status.offline_constraints);
  show("Compatibility constraints", status.compatibility_constraints);
  show("Blockers", status.blockers);
  show("Next action", status.next_action);
  return lines.join("\n");
}

function git(args, cwd = REPO_ROOT) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

function contractStatus(taskId, cwd, { changedPaths = [], lease = null } = {}) {
  const path = join(cwd, "docs", "ai", "contracts", `${safeTaskId(taskId)}.json`);
  try {
    const contract = JSON.parse(readFileSync(path, "utf8"));
    const evidence = Array.isArray(contract.evidence) ? contract.evidence : [];
    const acceptance = Array.isArray(contract.acceptance) ? contract.acceptance : [];
    const evidenceById = new Map(evidence.map((item) => [item?.id, item]));
    const baseline = contract.repository?.baseline_commit;
    const commitText = baseline
      ? git(["log", "--format=%h %s", `${baseline}..HEAD`], cwd)
      : "unknown";
    const history = Array.isArray(contract.write_lease?.history)
      ? contract.write_lease.history
      : [];
    const historicalViolations = history.flatMap((entry) => entry?.violations ?? []);
    const liveViolations = lease?.violations ?? [];
    const unresolvedViolations = [...historicalViolations, ...liveViolations]
      .filter((item) => item?.resolved !== true)
      .map((item) => `out-of-lease write: ${item.path ?? "unknown path"}`);
    const unresolvedEscapes = (contract.scope_escapes ?? [])
      .filter((item) => item?.resolved !== true)
      .map((item) => `${item.kind ?? "scope"}: ${item.subject ?? item.detail ?? "unknown"}`);
    const unresolvedAcceptance = acceptance
      .filter((criterion) => !(criterion.evidence_required ?? []).every(
        (id) => evidenceById.get(id)?.result === "PASS"
      ))
      .map((criterion) => `${criterion.id}: ${criterion.description}`);

    return {
      objective: contract.task?.objective,
      acceptanceCriteria: acceptance.map((item) => ({
        id: item.id,
        description: item.description,
        evidence_required: item.evidence_required
      })),
      architectureDecisions: contract.constraints?.architecture ?? [],
      filesChanged: changedPaths,
      commits: commitText === "unknown" || !commitText ? [] : commitText.split("\n"),
      completed: evidence
        .filter((item) => item?.result === "PASS")
        .map((item) => `${item.id}: ${item.command ?? item.type ?? "evidence"}`),
      unresolved: [
        ...evidence
          .filter((item) => item?.result !== "PASS")
          .map((item) => `${item.id}: ${item.result ?? "pending"}`),
        ...unresolvedAcceptance
      ],
      defects: [...unresolvedEscapes, ...unresolvedViolations],
      checks: evidence.map((item) => ({
        id: item.id,
        result: item.result,
        command: item.command
      })),
      securityConstraints: contract.constraints?.security ?? [],
      dataConstraints: contract.constraints?.data ?? [],
      offlineConstraints: contract.constraints?.offline ?? [],
      compatibilityConstraints: contract.constraints?.compatibility ?? [],
      blockers: completionBlockers(contract, { lease }),
      nextAction: contract.completion?.status === "complete"
        ? "No remaining task action. Verify live repository state before declaring closure."
        : "Re-read the live task contract, verify repository state, and continue its next unresolved acceptance criterion."
    };
  } catch {
    return { nextAction: "Inspect live Git, Beads, CURRENT_STATE and HANDOFF before continuing." };
  }
}

function pendingContractTask(cwd) {
  const directory = join(cwd, "docs", "ai", "contracts");
  try {
    const candidates = readdirSync(directory)
      .filter((name) => name.endsWith(".json") && !["active-lease.json", "TASK_CONTRACT.schema.json"].includes(name))
      .map((name) => join(directory, name))
      .filter((path) => statSync(path).isFile())
      .map((path) => {
        try {
          return JSON.parse(readFileSync(path, "utf8"));
        } catch {
          return null;
        }
      })
      .filter((contract) =>
        contract?.repository?.branch === "main" && contract?.completion?.status !== "complete"
      );
    return candidates.length === 1 ? candidates[0].task?.id ?? null : null;
  } catch {
    return null;
  }
}

function storedTaskId({ sessionId, localAppData }) {
  if (!sessionId) return null;
  const path = checkpointPathFor({ sessionId, localAppData });
  try {
    const checkpoint = JSON.parse(readFileSync(path, "utf8"));
    return typeof checkpoint?.task_id === "string" ? checkpoint.task_id : null;
  } catch {
    return null;
  }
}

function liveInput(payload) {
  const cwd = typeof payload?.cwd === "string" ? resolve(payload.cwd) : REPO_ROOT;
  const sessionId = payload?.session_id ?? payload?.sessionId;
  const localAppData = payload?.localAppData;
  let lease = null;
  try {
    lease = cwd === REPO_ROOT ? readLease(LEASE_PATH) : null;
  } catch {
    lease = null;
  }
  const taskId = payload?.taskId ?? payload?.task_id ?? lease?.task ??
    storedTaskId({ sessionId, localAppData }) ?? pendingContractTask(cwd) ?? "unassigned";
  const changed = cwd === REPO_ROOT ? dirtyPaths(cwd) : [];
  return {
    taskId,
    sessionId,
    localAppData,
    repository: {
      root: cwd,
      branch: git(["branch", "--show-current"], cwd),
      head: git(["rev-parse", "--short", "HEAD"], cwd),
      dirty: changed,
      activeLease: lease
    },
    status: contractStatus(taskId, cwd, { changedPaths: changed, lease })
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
      const path = checkpointPathFor({
        taskId: input.taskId,
        sessionId: input.sessionId,
        localAppData: input.localAppData
      });
      const stored = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : buildCheckpoint(input);
      const additionalContext = renderCheckpoint(stored);
      process.stdout.write(`${JSON.stringify({
        systemMessage: "AWKIT ephemeral non-authoritative checkpoint restored.",
        hookSpecificOutput: { hookEventName: "SessionStart", additionalContext }
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
