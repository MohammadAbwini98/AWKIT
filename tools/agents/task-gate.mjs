#!/usr/bin/env node
/** Operational completion gate for an AWKIT task contract. */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  changedFiles as changedFilesSince,
  deriveClassification,
  deriveGuardedFieldChanges,
  findGuardedFieldEscapes,
  findScopeEscapes,
  normalizeClassification
} from "./classify.mjs";
import { readLease } from "./lease.mjs";
import { pathInScope } from "./routing-matrix.mjs";
import { completionBlockers } from "./validate-contract.mjs";

/** @param {readonly string[]} values */
function unique(values) {
  return [...new Set(values)];
}

/**
 * @param {Record<string, any>} contract
 * @param {{lease?:Record<string,any>|null, changedFiles?:string[], guardedFieldChanges?:any[]}} [options]
 */
export function evaluateTaskGate(contract, options = {}) {
  const baseline = contract?.repository?.baseline_commit ?? "HEAD";
  const preserved = Array.isArray(contract?.repository?.preserved_paths)
    ? contract.repository.preserved_paths
    : [];
  const expected = Array.isArray(contract?.routing?.expected_paths)
    ? contract.routing.expected_paths
    : [];
  const observed = Array.isArray(options.changedFiles)
    ? options.changedFiles
    : changedFilesSince({ baseline });
  const relevant = unique(observed.map((path) => path.replace(/\\/g, "/")))
    .filter((path) => !pathInScope(path, preserved));

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

  const scopeEscapes = [...derivedEscapes, ...pathEscapes, ...guardedEscapes, ...recordedEscapes]
    .filter((escape, index, all) =>
      all.findIndex((candidate) =>
        candidate.kind === escape.kind && candidate.subject === escape.subject
      ) === index
    );
  const blockers = completionBlockers(contract, { lease: options.lease ?? null });
  if (scopeEscapes.length > 0) {
    blockers.push(`${scopeEscapes.length} unresolved derived scope escape(s)`);
  }

  return {
    ok: blockers.length === 0,
    canComplete: blockers.length === 0,
    blockers,
    scopeEscapes,
    changedFiles: relevant,
    preservedPaths: preserved
  };
}

if (process.argv[1]?.endsWith("task-gate.mjs")) {
  const contractPath = process.argv[2];
  try {
    if (!contractPath) throw new Error("Usage: node tools/agents/task-gate.mjs <task-contract.json>");
    const contract = JSON.parse(readFileSync(resolve(contractPath), "utf8"));
    let lease = null;
    try {
      const current = readLease();
      if (current?.task === contract.task?.id) lease = current;
    } catch {
      // The validator will still report the contract; a corrupt lease is surfaced by its own guard.
    }
    const result = evaluateTaskGate(contract, { lease });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`Task gate blocked: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
