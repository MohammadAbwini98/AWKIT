#!/usr/bin/env node
/**
 * Authorized retention cleanup for CLOSED task contracts.
 *
 * `docs/ai/contracts/README.md` § Retention says a contract is DELETED when its task closes,
 * because its durable record is three places that already outlive it: the Beads issue, the
 * `TASK_LOG.md` entry, and the commits. Nothing implemented that rule, so ~70 contracts for
 * long-closed tasks accumulated in the directory.
 *
 * The reason is not an authorization level. The lease guard's shell grammar is a closed allowlist
 * of command FORMS, and it has no deletion verb anywhere: `rm`, `Remove-Item` and `git rm` are
 * refused as forms, so NO lease grants deletion and none ever will. `agent:lease-finalize` is not
 * the answer despite its name — its terminal paths REQUIRE the contract file to exist, because
 * final release archives lease history INTO it. Finalize writes the contract; it never removes it.
 *
 * So the missing capability is exactly one thing: remove an eligible contract from the working
 * tree. The rest of the lifecycle already works — `docs/ai/contracts/**` is not a Risk-3 domain, so
 * the guard's existing `git add --` / `git commit -m` forms already stage and commit a deletion.
 * This module is therefore deliberately narrow: it deletes contracts and nothing else, and it is
 * reached through ONE exact command form, exactly as `render-platform-agents.mjs --write` is.
 *
 * Eligibility is derived from trusted repository state — the on-disk contract, the active lease and
 * git history. The caller supplies only a task id; there is no flag that asserts completion, so a
 * client cannot manufacture eligibility by passing one.
 *
 * Fails closed: anything unverifiable is a REFUSAL, which is why a contract whose closure cannot be
 * confirmed is kept rather than removed.
 */

import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT, readLease } from "./lease.mjs";
import { evaluateTaskGate } from "./task-gate.mjs";

/** The one directory this module may ever delete from. */
export const CONTRACTS_DIR = "docs/ai/contracts";

/**
 * Control-plane files that live in the contracts directory but are NOT task contracts.
 *
 * `active-lease.json` is explicitly "never deleted" by the same README section, and the schema is
 * the contract format itself. Both are excluded by name before any other check runs.
 */
export const NEVER_CLEANED = Object.freeze(["active-lease.json", "task_contract.schema.json"]);

/**
 * The task-id shape the guard's own `isContractControlPath` accepts.
 *
 * It cannot contain `/`, `\` or a drive prefix, and must START with an alphanumeric, so `..` and
 * `.hidden` are rejected. Combined with building the path ourselves rather than accepting one, a
 * caller cannot reach outside the contracts directory at all.
 */
const TASK_ID = /^[a-z0-9][a-z0-9._-]*$/;

/** A closed task's durable record is its commits, so the closing commit must be a real full id. */
const FULL_COMMIT = /^[0-9a-f]{40}$/i;

/**
 * Resolve a task id to the one path it is allowed to name.
 *
 * Deliberately takes an ID, never a path: there is no caller-supplied path to sanitize, so
 * traversal, globs, absolute paths and alternate directories are unrepresentable rather than
 * filtered.
 *
 * @param {string} task
 * @param {string} [cwd]
 * @returns {{task: string, relative: string, absolute: string}}
 */
export function resolveContractTarget(task, cwd = REPO_ROOT) {
  if (typeof task !== "string" || !TASK_ID.test(task)) {
    throw new Error(
      `refusing an unsafe task id ${JSON.stringify(task)}: cleanup accepts only a bare task id ` +
        "matching /^[a-z0-9][a-z0-9._-]*$/, never a path"
    );
  }
  const name = `${task}.json`;
  if (NEVER_CLEANED.includes(name)) {
    throw new Error(`${CONTRACTS_DIR}/${name} is control-plane state, not a task contract`);
  }
  return {
    task,
    relative: `${CONTRACTS_DIR}/${name}`,
    absolute: join(cwd, ...CONTRACTS_DIR.split("/"), name)
  };
}

/** True when `commit` is reachable from HEAD, i.e. the durable record really is in this history. */
function isAncestorOfHead(commit, cwd) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", commit, "HEAD"], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Every reason this contract may NOT be removed, or `[]` when it is eligible.
 *
 * `absent: true` is returned for a contract that is already gone. That is the idempotency contract:
 * a repeated cleanup is a no-op, never an error and never a second "deletion".
 *
 * @param {{task: string, relative: string, absolute: string}} target
 * @param {{cwd?: string, lease?: Record<string, any>|null}} [options]
 *   `lease` defaults to reading the real active lease; pass it explicitly (including `null`) to
 *   drive a disposable fixture without touching repository state.
 * @returns {{blockers: string[], absent: boolean}}
 */
export function cleanupBlockers(target, options = {}) {
  const cwd = options.cwd ?? REPO_ROOT;
  /** @type {string[]} */
  const blockers = [];

  let info;
  try {
    info = lstatSync(target.absolute);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return { blockers: [], absent: true };
    }
    return {
      blockers: [`contract is unreadable: ${error instanceof Error ? error.message : String(error)}`],
      absent: false
    };
  }

  // lstat, not stat: a symlink must be refused rather than followed to whatever it points at.
  if (info.isSymbolicLink() || !info.isFile()) {
    return {
      blockers: [`${target.relative} is not a regular file — a symlink or directory is never cleaned`],
      absent: false
    };
  }

  let contract;
  try {
    contract = JSON.parse(readFileSync(target.absolute, "utf8"));
  } catch (error) {
    return {
      blockers: [`contract is not parseable JSON: ${error instanceof Error ? error.message : String(error)}`],
      absent: false
    };
  }

  // The file NAME does not establish which task this is; the contract's own id does. Without this,
  // renaming any contract to an eligible task's filename would make it deletable.
  if (contract?.task?.id !== target.task) {
    blockers.push(
      `contract declares task id ${JSON.stringify(contract?.task?.id ?? null)}, but the file is ` +
        `${target.relative}`
    );
  }

  if (contract?.completion?.status !== "complete") {
    blockers.push(
      `completion.status is ${JSON.stringify(contract?.completion?.status ?? null)}, not "complete" ` +
        "— an open task keeps its contract"
    );
  }

  let active = null;
  if (options.lease === undefined) {
    try {
      active = readLease();
    } catch (error) {
      blockers.push(
        `active lease is unreadable, so lease state cannot be cleared: ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
    }
  } else {
    active = options.lease;
  }
  if (active && active.task === target.task) {
    blockers.push(`an active ${active.holder} lease still names this task`);
  }

  // The closing commit is the durable record the retention rule trades the file for. task-gate
  // validates its SHAPE only when it is present, so absence and unreachability are checked here:
  // without this, a contract with no closed_at_commit would reach the gate with no boundary at all.
  const closedAt = contract?.completion?.closed_at_commit;
  if (!FULL_COMMIT.test(String(closedAt ?? ""))) {
    blockers.push(
      `completion.closed_at_commit is ${JSON.stringify(closedAt ?? null)}, not a full 40-character ` +
        "commit id — the durable record of this closure is not recorded"
    );
  } else if (!isAncestorOfHead(closedAt, cwd)) {
    blockers.push(
      `completion.closed_at_commit ${closedAt} is not an ancestor of HEAD — the commits that are ` +
        "supposed to outlive this contract are not in this history"
    );
  }

  // The full completion gate: required evidence PASS, acceptance proven, qa PASS, qc APPROVED when
  // qc is a reviewer, no unresolved scope escapes, no unresolved out-of-lease writes, preserved user
  // work intact. Reused rather than restated so cleanup can never drift from the gate the task
  // itself had to satisfy.
  try {
    const gate = evaluateTaskGate(contract, { cwd, lease: null });
    if (!gate.ok) blockers.push(...gate.blockers.map((reason) => `task gate: ${reason}`));
  } catch (error) {
    blockers.push(
      `task gate could not be evaluated: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return { blockers, absent: false };
}

/**
 * Remove every eligible contract named, and report each refusal with its reasons.
 *
 * @param {{tasks?: string[], all?: boolean, dryRun?: boolean, cwd?: string, lease?: Record<string, any>|null}} options
 * @returns {{removed: Array<{task: string, path: string}>, absent: string[], refused: Array<{task: string, path: string|null, reasons: string[]}>, dryRun: boolean}}
 */
export function cleanupContracts(options = {}) {
  const cwd = options.cwd ?? REPO_ROOT;
  const dryRun = options.dryRun === true;
  const removed = [];
  const absent = [];
  const refused = [];

  let tasks = Array.isArray(options.tasks) ? [...options.tasks] : [];
  if (options.all === true) {
    const dir = join(cwd, ...CONTRACTS_DIR.split("/"));
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.name.endsWith(".json") || NEVER_CLEANED.includes(entry.name)) continue;
      // A directory or symlink named *.json is reported as a refusal rather than silently skipped.
      if (!entry.isFile()) {
        refused.push({
          task: entry.name.replace(/\.json$/, ""),
          path: `${CONTRACTS_DIR}/${entry.name}`,
          reasons: [`${CONTRACTS_DIR}/${entry.name} is not a regular file`]
        });
        continue;
      }
      tasks.push(entry.name.replace(/\.json$/, ""));
    }
  }
  tasks = [...new Set(tasks)];

  for (const task of tasks) {
    let target;
    try {
      target = resolveContractTarget(task, cwd);
    } catch (error) {
      refused.push({
        task: String(task),
        path: null,
        reasons: [error instanceof Error ? error.message : String(error)]
      });
      continue;
    }

    const { blockers, absent: missing } = cleanupBlockers(target, { cwd, lease: options.lease });
    if (missing) {
      absent.push(target.relative);
      continue;
    }
    if (blockers.length > 0) {
      refused.push({ task, path: target.relative, reasons: blockers });
      continue;
    }
    if (!dryRun) unlinkSync(target.absolute);
    removed.push({ task, path: target.relative });
  }

  return { removed, absent, refused, dryRun };
}

if (process.argv[1]?.endsWith("contract-cleanup.mjs")) {
  const argv = process.argv.slice(2);
  const tasks = [];
  let all = false;
  let dryRun = false;
  let bad = null;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--all") all = true;
    else if (token === "--dry-run") dryRun = true;
    else if (token === "--task") {
      index += 1;
      if (argv[index] === undefined) bad ??= "--task requires a task id";
      else tasks.push(argv[index]);
    } else bad ??= `unknown argument ${JSON.stringify(token)}`;
  }

  try {
    if (bad) throw new Error(bad);
    if (all && tasks.length > 0) throw new Error("--all and --task are mutually exclusive");
    if (!all && tasks.length === 0) {
      throw new Error("Usage: node tools/agents/contract-cleanup.mjs (--task <id> | --all) [--dry-run]");
    }
    const result = cleanupContracts({ tasks, all, dryRun });
    const verb = result.dryRun ? "WOULD REMOVE" : "REMOVED";
    for (const entry of result.removed) console.log(`${verb} ${entry.path}`);
    for (const path of result.absent) console.log(`ALREADY ABSENT ${path}`);
    for (const entry of result.refused) {
      console.log(`REFUSED ${entry.path ?? entry.task}`);
      for (const reason of entry.reasons) console.log(`  - ${reason}`);
    }
    console.log(
      `\n${result.removed.length} ${result.dryRun ? "eligible" : "removed"}, ` +
        `${result.absent.length} already absent, ${result.refused.length} refused.`
    );
    if (!result.dryRun && result.removed.length > 0) {
      console.log("Stage the deletion with: git add -- <path>   (then commit it)");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
