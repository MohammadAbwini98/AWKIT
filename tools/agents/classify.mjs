/**
 * Classification — declared and derived.
 *
 * This module is the fix for the single biggest weakness in the reviewed architecture: it called
 * itself "deterministic" while its classification booleans were produced by a model reading a prose
 * request BEFORE any code was written. That is a prediction. Two managers given the same task could
 * produce two different classifications, route to two different specialists, and nothing in the
 * system would notice.
 *
 * So there are two classifications, and they answer different questions:
 *
 *   declared  what the Manager expects this task to touch. Produced before implementation, it is
 *             the only input allowed to drive routing — routing has to happen before the work.
 *
 *   derived   what the task ACTUALLY touched, computed from `git diff --name-only` through the
 *             PATH_DOMAINS map. It is a measurement, not an opinion, and it is available only
 *             afterwards.
 *
 * The check that matters is the comparison. When `derived` contains a domain or a flag that
 * `declared` did not, the task escaped its declared scope — which is exactly the event the
 * escalation rules exist to catch and which, until now, depended entirely on an agent volunteering
 * that it had happened.
 *
 * This is the same discipline the Program Status dashboard already runs on: derive the fact from
 * the repository, never accept a hand-recorded number for it.
 */

import { execFileSync } from "node:child_process";

import {
  CLASSIFICATION_FLAGS,
  PATH_DOMAINS,
  agent,
  domainForPath
} from "./routing-matrix.mjs";

/**
 * @typedef {Object} DerivedClassification
 * @property {string[]} files            every changed path, POSIX-separated
 * @property {string[]} domains          owning agent ids for those paths
 * @property {string[]} flags            classification flags the paths soundly imply
 * @property {string[]} unmappedFiles    paths with no declared owner
 * @property {number} crossLayerCount    distinct owning domains touched
 */

/**
 * Every path changed relative to a baseline, including untracked files.
 *
 * Untracked files are included deliberately. A brand-new module under `src/licensing/` is a
 * licensing change whether or not it has been staged yet, and a derivation that only looked at
 * tracked modifications would report "nothing touched" for an entire new feature — a check that
 * passes hardest exactly when the most code was written.
 *
 * @param {Object} [options]
 * @param {string} [options.baseline]  commit-ish to diff against. Defaults to HEAD.
 * @param {string} [options.cwd]
 * @returns {string[]}
 */
export function changedFiles({ baseline = "HEAD", cwd = process.cwd() } = {}) {
  const run = (args) => {
    try {
      return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      return "";
    }
  };

  const tracked = run(["diff", "--name-only", baseline]);
  const untracked = run(["ls-files", "--others", "--exclude-standard"]);

  const all = `${tracked}\n${untracked}`
    .split("\n")
    .map((line) => line.trim().replace(/\\/g, "/"))
    .filter((line) => line.length > 0);

  return [...new Set(all)].sort();
}

/**
 * Measure what a set of changed paths actually implies.
 *
 * @param {readonly string[]} files
 * @returns {DerivedClassification}
 */
export function deriveClassification(files) {
  /** @type {Set<string>} */
  const domains = new Set();
  /** @type {Set<string>} */
  const flags = new Set();
  /** @type {string[]} */
  const unmappedFiles = [];

  for (const file of files) {
    const entry = domainForPath(file);
    if (!entry) {
      unmappedFiles.push(file);
      continue;
    }
    domains.add(entry.owner);
    for (const flag of entry.impliesFlags) flags.add(flag);
  }

  return {
    files: [...files],
    domains: [...domains].sort(),
    flags: [...flags].sort(),
    unmappedFiles,
    crossLayerCount: domains.size
  };
}

/**
 * @typedef {Object} ScopeEscape
 * @property {"domain"|"flag"|"unmapped"} kind
 * @property {string} subject
 * @property {string} detail
 */

/**
 * Compare what actually happened against what was declared.
 *
 * Only one direction is a violation. Declaring MORE than was touched is ordinary caution — a
 * Manager who declared `migration_required` and then found the migration unnecessary has over-routed,
 * which costs a review and harms nothing. Touching more than was declared is scope escape.
 *
 * @param {Record<string, boolean|number>} declared
 * @param {DerivedClassification} derived
 * @param {readonly string[]} activatedAgents  agent ids the contract activated
 * @returns {ScopeEscape[]}
 */
export function findScopeEscapes(declared, derived, activatedAgents) {
  /** @type {ScopeEscape[]} */
  const escapes = [];
  const activated = new Set(activatedAgents);

  for (const domain of derived.domains) {
    if (!activated.has(domain)) {
      escapes.push({
        kind: "domain",
        subject: domain,
        detail:
          `the diff touches paths owned by "${domain}" (${agent(domain).role}), ` +
          "which this contract never activated"
      });
    }
  }

  for (const flag of derived.flags) {
    if (declared[flag] !== true) {
      escapes.push({
        kind: "flag",
        subject: flag,
        detail: `the changed paths imply ${flag}, but the contract declared it false or omitted it`
      });
    }
  }

  for (const file of derived.unmappedFiles) {
    escapes.push({
      kind: "unmapped",
      subject: file,
      detail: "no PATH_DOMAINS entry owns this path, so no specialist is answerable for it"
    });
  }

  return escapes;
}

/**
 * Normalize a declared classification into every known flag, so a missing key and an explicit
 * `false` behave identically downstream.
 *
 * Unknown keys are REJECTED rather than ignored. A contract carrying `persistance_change` (sic)
 * would otherwise route as though persistence were untouched while reading, to a human, as though
 * it had been declared.
 *
 * @param {Record<string, unknown>} raw
 * @returns {{classification: Record<string, boolean|number>, errors: string[]}}
 */
export function normalizeClassification(raw) {
  /** @type {string[]} */
  const errors = [];
  /** @type {Record<string, boolean|number>} */
  const classification = {};

  for (const flag of CLASSIFICATION_FLAGS) classification[flag] = false;
  classification.cross_layer_count = 1;

  for (const [key, value] of Object.entries(raw ?? {})) {
    if (key === "cross_layer_count") {
      if (!Number.isInteger(value) || Number(value) < 1) {
        errors.push(`cross_layer_count must be an integer >= 1, got ${JSON.stringify(value)}`);
        continue;
      }
      classification.cross_layer_count = Number(value);
      continue;
    }

    if (!CLASSIFICATION_FLAGS.includes(key)) {
      errors.push(
        `unknown classification flag "${key}" — it would be silently ignored by routing. ` +
          `Known flags: ${CLASSIFICATION_FLAGS.join(", ")}`
      );
      continue;
    }

    if (typeof value !== "boolean") {
      errors.push(`classification flag "${key}" must be a boolean, got ${JSON.stringify(value)}`);
      continue;
    }

    classification[key] = value;
  }

  return { classification, errors };
}

/**
 * Suggest a declared classification from a set of paths a task is EXPECTED to touch.
 *
 * This is an aid for the Manager, never a substitute for declaring intent: it can only produce the
 * soundly path-implied flags, so `renderer_visual_change` and friends still have to be stated by
 * whoever understands the request.
 *
 * @param {readonly string[]} expectedPaths
 * @returns {Record<string, boolean|number>}
 */
export function suggestClassification(expectedPaths) {
  const derived = deriveClassification(expectedPaths);
  const { classification } = normalizeClassification({});
  for (const flag of derived.flags) classification[flag] = true;
  classification.cross_layer_count = Math.max(1, derived.crossLayerCount);
  return classification;
}

/** Every domain a path map can produce — used by the verifier to prove the map covers each agent. */
export const MAPPED_OWNERS = [...new Set(PATH_DOMAINS.map((d) => d.owner))].sort();
