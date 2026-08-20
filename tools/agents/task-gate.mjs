#!/usr/bin/env node
/** Operational completion gate for an AWKIT task contract. */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  changedFiles as changedFilesSince,
  deriveClassification,
  deriveGuardedFieldChanges,
  findGuardedFieldEscapes,
  findScopeEscapes,
  normalizeClassification,
  validateBaseline
} from "./classify.mjs";
import { REPO_ROOT, readLease } from "./lease.mjs";
import { pathInScope } from "./routing-matrix.mjs";
import { completionBlockers, isExactRepoRelativePath } from "./validate-contract.mjs";

/** @param {readonly string[]} values */
function unique(values) {
  return [...new Set(values)];
}

/** Capture the current status/content identity of one exact repository file. */
export function preservedFileState(path, cwd = REPO_ROOT) {
  if (!isExactRepoRelativePath(path)) throw new Error(`unsafe preserved path ${JSON.stringify(path)}`);
  const absolute = join(cwd, ...path.split("/"));
  const info = lstatSync(absolute);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`preserved path "${path}" must be an existing regular file, not a directory or symlink`);
  }
  const output = execFileSync(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching", "--", path],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  const record = output.split("\0").find(Boolean) ?? "";
  return {
    path,
    git_status: record.slice(0, 2),
    sha256: createHash("sha256").update(readFileSync(absolute)).digest("hex")
  };
}

/** Verify preserved user work still has exactly its contract-creation fingerprint. */
export function verifyPreservedPaths(entries, { cwd = REPO_ROOT, states } = {}) {
  const unchanged = [];
  const escapes = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry !== "object" || !isExactRepoRelativePath(entry.path)) {
      escapes.push({
        kind: "preserved",
        subject: String(entry?.path ?? "<invalid>"),
        detail: "preserved_paths accepts only exact repository-relative fingerprint objects"
      });
      continue;
    }
    try {
      const current = states?.[entry.path] ?? preservedFileState(entry.path, cwd);
      if (current.git_status === entry.git_status && current.sha256 === entry.sha256) {
        unchanged.push(entry.path);
      } else {
        escapes.push({
          kind: "preserved",
          subject: entry.path,
          detail:
            `preserved user file changed after contract creation (expected ${entry.git_status}/` +
            `${entry.sha256}, observed ${current.git_status}/${current.sha256})`
        });
      }
    } catch (error) {
      escapes.push({
        kind: "preserved",
        subject: entry.path,
        detail: `preserved file cannot be verified: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }
  return { unchanged, escapes };
}

/**
 * @param {Record<string, any>} contract
 * @param {{lease?:Record<string,any>|null, changedFiles?:string[], guardedFieldChanges?:any[], preservedStates?:Record<string,any>, infrastructureBlockers?:string[], cwd?:string}} [options]
 */
export function evaluateTaskGate(contract, options = {}) {
  const cwd = options.cwd ?? REPO_ROOT;
  const baseline = contract?.repository?.baseline_commit ?? "HEAD";
  const preserved = Array.isArray(contract?.repository?.preserved_paths)
    ? contract.repository.preserved_paths
    : [];
  const expected = Array.isArray(contract?.routing?.expected_paths)
    ? contract.routing.expected_paths
    : [];
  const blockers = [...(options.infrastructureBlockers ?? [])];
  try {
    validateBaseline(baseline, cwd);
  } catch (error) {
    blockers.push(
      `repository baseline is invalid or unavailable: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  let observed = [];
  try {
    observed = Array.isArray(options.changedFiles)
      ? options.changedFiles
      : changedFilesSince({ baseline, cwd });
  } catch (error) {
    blockers.push(
      `changed-file derivation failed closed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const preservedCheck = verifyPreservedPaths(preserved, {
    cwd,
    states: options.preservedStates
  });
  const preservedSet = new Set(preservedCheck.unchanged);
  const relevant = unique(observed.map((path) => path.replace(/\\/g, "/")))
    .filter((path) => !preservedSet.has(path));

  const { classification } = normalizeClassification(contract?.classification ?? {});
  const activated = Array.isArray(contract?.routing?.activated_agents)
    ? contract.routing.activated_agents
    : [];
  const derived = deriveClassification(relevant);
  const derivedEscapes = findScopeEscapes(classification, derived, activated);
  const pathEscapes = relevant
    .filter((path) => !pathInScope(path, expected))
    .map((path) => ({
      kind: "path",
      subject: path,
      detail: `changed path "${path}" is outside routing.expected_paths`
    }));

  const guardedChanges = Array.isArray(options.guardedFieldChanges)
    ? options.guardedFieldChanges
    : deriveGuardedFieldChanges({ baseline });
  const guardedEscapes = findGuardedFieldEscapes(activated, { changes: guardedChanges });
  const recordedEscapes = (Array.isArray(contract?.scope_escapes) ? contract.scope_escapes : [])
    .filter((escape) => escape?.resolved !== true);

  const scopeEscapes = [
    ...derivedEscapes,
    ...pathEscapes,
    ...guardedEscapes,
    ...preservedCheck.escapes,
    ...recordedEscapes
  ]
    .filter((escape, index, all) =>
      all.findIndex((candidate) =>
        candidate.kind === escape.kind && candidate.subject === escape.subject
      ) === index
    );
  blockers.push(...completionBlockers(contract, { lease: options.lease ?? null }));
  if (scopeEscapes.length > 0) {
    blockers.push(`${scopeEscapes.length} unresolved derived scope escape(s)`);
  }

  return {
    ok: blockers.length === 0,
    canComplete: blockers.length === 0,
    blockers,
    scopeEscapes,
    changedFiles: relevant,
    preservedPaths: preservedCheck.unchanged
  };
}

if (process.argv[1]?.endsWith("task-gate.mjs")) {
  const contractPath = process.argv[2];
  try {
    if (!contractPath) throw new Error("Usage: node tools/agents/task-gate.mjs <task-contract.json>");
    const contract = JSON.parse(readFileSync(resolve(contractPath), "utf8"));
    let lease = null;
    const infrastructureBlockers = [];
    try {
      const current = readLease();
      if (current?.task === contract.task?.id) lease = current;
    } catch (error) {
      infrastructureBlockers.push(
        `active lease is unreadable: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    const result = evaluateTaskGate(contract, { lease, infrastructureBlockers });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`Task gate blocked: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
