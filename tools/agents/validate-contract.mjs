/**
 * Contract validation and the completion gate.
 *
 * Two guards in here exist because of specific ways this class of check has failed before in this
 * repository, and both are worth stating plainly:
 *
 *  1. `.every()` over an empty collection returns TRUE. A completion gate written as
 *     `evidence.every(e => e.result === "PASS")` therefore passes hardest when there is no evidence
 *     at all. The reviewed proposal caught half of this — it rejected an EMPTY evidence list — but
 *     not the other half: a contract may list ten evidence items and mark every one
 *     `required: false`, at which point the filtered array is empty again and the gate passes with
 *     nothing proven. `requireCardinality` closes it by asserting the count BEFORE the predicate.
 *
 *  2. A guard can be satisfied by its own failure path. So the override rule does not check that an
 *     override "has evidence" — it checks that the override recorded a reason, listed the paths it
 *     touched, and forced `qc_required: true`, and that QC then actually returned APPROVED. An
 *     override that quietly sets `qc_required: false` is the exact abuse the rule is for.
 */

import { AGENT_IDS, EVIDENCE_STATUSES, agent, pathInScope } from "./routing-matrix.mjs";
import { normalizeClassification } from "./classify.mjs";
import { route } from "./route.mjs";

/**
 * @typedef {Object} Violation
 * @property {string} rule    stable id, so a failure message can be grepped
 * @property {string} message
 */

/**
 * Assert a collection has at least `min` members before any predicate is applied to it.
 *
 * Every `.every()` in this file goes through here. That is the whole point: the vacuous-truth bug
 * is not a mistake anyone makes deliberately, it is one that survives review because the code reads
 * correctly. Making the cardinality assertion structurally unavoidable is cheaper than remembering.
 *
 * @param {readonly unknown[]} items
 * @param {number} min
 * @param {string} what
 * @returns {Violation|null}
 */
export function requireCardinality(items, min, what) {
  if (items.length >= min) return null;
  return {
    rule: "cardinality",
    message: `${what}: expected at least ${min}, found ${items.length} — a predicate over this ` +
      "collection would pass vacuously"
  };
}

/** Exact repository-relative file path: no traversal, absolute prefix, glob, or directory suffix. */
export function isExactRepoRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\")) return false;
  if (/^(?:[A-Za-z]:|\/)/.test(value) || /[*?\[\]{}!\u0000-\u001f]/.test(value)) return false;
  if (value.endsWith("/") || value.split("/").some((part) => !part || part === "." || part === "..")) {
    return false;
  }
  return true;
}

/**
 * Validate a task contract against the canonical registry.
 *
 * @param {Record<string, any>} contract
 * @returns {{ok: boolean, violations: Violation[], routing: ReturnType<typeof route>|null}}
 */
export function validateContract(contract) {
  /** @type {Violation[]} */
  const violations = [];
  const fail = (rule, message) => violations.push({ rule, message });

  if (!contract || typeof contract !== "object") {
    return { ok: false, violations: [{ rule: "shape", message: "contract is not an object" }], routing: null };
  }

  const nonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
  const sameArray = (left, right) =>
    Array.isArray(left) && JSON.stringify(left) === JSON.stringify(right);
  const object = (value) => value && typeof value === "object" && !Array.isArray(value);
  const requireObject = (value, name) => {
    if (!object(value)) fail(name, `${name} must be an object`);
  };
  const requireArray = (value, name) => {
    if (!Array.isArray(value)) fail(name, `${name} must be an array`);
  };

  requireObject(contract.task, "task");
  requireObject(contract.repository, "repository");
  requireObject(contract.classification, "classification");
  requireObject(contract.routing, "routing");
  requireArray(contract.acceptance, "acceptance");
  requireArray(contract.evidence, "evidence");
  requireObject(contract.git, "git");
  requireObject(contract.completion, "completion");

  if (contract.version !== 1) fail("version", "contract.version must be exactly 1");

  // ── Identity ────────────────────────────────────────────────────────────────────────────────
  if (!nonEmptyString(contract.task?.id)) fail("task.id", "contract has no non-empty task.id");
  if (!nonEmptyString(contract.task?.title)) fail("task.title", "contract has no non-empty task.title");
  if (!nonEmptyString(contract.task?.objective)) fail("task.objective", "contract has no non-empty task.objective");
  const taskMode = contract.task?.mode;
  if (!["inspect", "change"].includes(taskMode)) {
    fail("task.mode", `task.mode must be "inspect" or "change", got ${JSON.stringify(taskMode)}`);
  }
  if (!Number.isInteger(contract.task?.risk_level) || contract.task.risk_level < 0 || contract.task.risk_level > 3) {
    fail("task.risk_level", "task.risk_level must be an integer from 0 through 3");
  }
  if (contract.repository?.branch !== "main") {
    fail("repository.branch", "repository.branch must be main");
  }
  if (!nonEmptyString(contract.repository?.baseline_commit)) {
    fail("repository.baseline_commit", "repository.baseline_commit must be a non-empty commit-ish");
  }
  if (!['clean', 'preserved_changes'].includes(contract.repository?.working_tree_expected)) {
    fail(
      "repository.working_tree_expected",
      'repository.working_tree_expected must be "clean" or "preserved_changes"'
    );
  }
  if (!Array.isArray(contract.repository?.preserved_paths)) {
    fail("repository.preserved_paths", "repository.preserved_paths must be an array");
  } else {
    const preserved = contract.repository.preserved_paths;
    for (const entry of preserved) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        fail("repository.preserved_entry", "each preserved path must be a fingerprint object");
        continue;
      }
      if (!isExactRepoRelativePath(entry.path)) {
        fail(
          "repository.preserved_path",
          `preserved path ${JSON.stringify(entry.path)} must be one exact repo-relative file (no glob, directory, absolute path or traversal)`
        );
      }
      if (typeof entry.git_status !== "string" || !/^(?:\?\?|!!|[ MADRCUTU][ MADRCUTU])$/.test(entry.git_status)) {
        fail("repository.preserved_status", `preserved path ${JSON.stringify(entry.path)} needs its two-character git_status`);
      }
      if (typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(entry.sha256)) {
        fail("repository.preserved_sha256", `preserved path ${JSON.stringify(entry.path)} needs a SHA-256 baseline fingerprint`);
      }
    }
    const names = preserved.map((entry) => entry?.path).filter(Boolean);
    if (new Set(names).size !== names.length) {
      fail("repository.preserved_duplicate", "repository.preserved_paths contains duplicate files");
    }
  }

  // ── Classification ──────────────────────────────────────────────────────────────────────────
  const { classification, errors } = normalizeClassification(contract.classification ?? {});
  for (const message of errors) fail("classification", message);

  const routing = route(classification, {
    expectedPaths: contract.routing?.expected_paths ?? [],
    taskMode: taskMode === "inspect" ? "inspect" : "change"
  });

  // The contract may declare a HIGHER risk than computed (caution is allowed); never a lower one.
  const declaredRisk = contract.task?.risk_level;
  if (typeof declaredRisk === "number" && declaredRisk < routing.riskLevel) {
    fail(
      "risk.understated",
      `contract declares risk_level ${declaredRisk} but its classification computes to ` +
        `${routing.riskLevel}. Risk may be raised, never lowered.`
    );
  }

  // ── Routing ─────────────────────────────────────────────────────────────────────────────────
  if (contract.routing?.manager !== "manager") {
    fail("routing.manager", 'routing.manager must be exactly "manager"');
  }
  requireArray(contract.routing?.activated_agents, "routing.activated_agents");
  requireArray(contract.routing?.expected_paths, "routing.expected_paths");
  requireArray(contract.routing?.consultants, "routing.consultants");
  requireArray(contract.routing?.reviewers, "routing.reviewers");
  for (const path of Array.isArray(contract.routing?.expected_paths) ? contract.routing.expected_paths : []) {
    if (
      !nonEmptyString(path) ||
      /^(?:[A-Za-z]:|\/|\\)/.test(path) ||
      path.includes("\\") ||
      path.split("/").some((part) => !part || part === "." || part === "..") ||
      ["*", "**"].includes(path)
    ) {
      fail("routing.expected_path", `unsafe or unbounded expected path ${JSON.stringify(path)}`);
    }
  }
  const activated = Array.isArray(contract.routing?.activated_agents)
    ? contract.routing.activated_agents
    : [];

  if (!activated.includes("manager")) fail("manager.absent", "no manager is assigned");

  for (const id of activated) {
    if (!AGENT_IDS.includes(id)) fail("activation.unknown", `activated agent "${id}" is unknown`);
  }

  for (const required of routing.activated) {
    if (!activated.includes(required)) {
      const reason = routing.rationale.find((r) => r.agent === required);
      fail(
        "activation.missing",
        `"${required}" (${agent(required).role}) is mandatory here — ${reason?.trigger ?? "routing rule"} — but is not activated`
      );
    }
  }

  for (const extra of activated.filter((id) => !routing.activated.includes(id))) {
    fail("activation.extra", `"${extra}" is activated but deterministic routing does not require it`);
  }
  if (new Set(activated).size !== activated.length) {
    fail("activation.duplicate", "routing.activated_agents contains duplicates");
  }
  if (activated.length === routing.activated.length && !sameArray(activated, routing.activated)) {
    fail("activation.order", `activated_agents must use canonical order [${routing.activated.join(", ")}]`);
  }

  const consultants = Array.isArray(contract.routing?.consultants) ? contract.routing.consultants : [];
  for (const missing of routing.consultants.filter((id) => !consultants.includes(id))) {
    fail("consultant.missing", `routed consultant "${missing}" is absent`);
  }
  for (const extra of consultants.filter((id) => !routing.consultants.includes(id))) {
    fail("consultant.extra", `consultant "${extra}" is not routed`);
  }
  if (consultants.length === routing.consultants.length && !sameArray(consultants, routing.consultants)) {
    fail("consultant.order", `consultants must use canonical order [${routing.consultants.join(", ")}]`);
  }

  const reviewers = Array.isArray(contract.routing?.reviewers) ? contract.routing.reviewers : [];
  for (const missing of routing.reviewers.filter((id) => !reviewers.includes(id))) {
    fail("reviewer.missing", `routed reviewer "${missing}" is absent`);
  }
  for (const extra of reviewers.filter((id) => !routing.reviewers.includes(id))) {
    fail("reviewer.extra", `reviewer "${extra}" is not routed`);
  }
  if (reviewers.length === routing.reviewers.length && !sameArray(reviewers, routing.reviewers)) {
    fail("reviewer.order", `reviewers must use canonical order [${routing.reviewers.join(", ")}]`);
  }

  // ── Writer ──────────────────────────────────────────────────────────────────────────────────
  const writer = contract.routing?.writer;

  // "Does this task change product code?" is answered by the routed writer sequence. That is only
  // sound because `route()` guarantees the sequence is non-empty whenever ANY writer-mode agent is
  // activated — when narrowing to path owners would empty it, it falls back to the full list.
  // If that fallback is ever removed, this line silently stops requiring a writer on exactly the
  // tasks with mis-declared paths. Change both together or neither.
  const touchesProductCode = routing.writerSequence.length > 0;

  if (Array.isArray(writer)) {
    fail("writer.multiple", "routing.writer must be a single agent — one write lease at a time");
  } else if (taskMode === "inspect" && writer?.agent_id) {
    fail("writer.inspect", "an inspect task cannot declare a writer or write lease");
  } else if (!writer?.agent_id) {
    if (touchesProductCode) fail("writer.absent", "the task changes owned paths but names no writer");
  } else {
    if (!routing.writerSequence.includes(writer.agent_id)) {
      fail(
        "writer.unrouted",
        `writer "${writer.agent_id}" is not in the routed writer sequence ` +
          `[${routing.writerSequence.join(", ")}]`
      );
    }

    const allowed = Array.isArray(writer.allowed_paths) ? writer.allowed_paths : [];
    const noPaths = requireCardinality(allowed, 1, `writer "${writer.agent_id}" allowed_paths`);
    if (noPaths) fail("writer.no_paths", noPaths.message);

    // A lease may never exceed what its holder owns. This is what stops an amendment from quietly
    // widening one agent into the whole repository.
    const owned = agent(writer.agent_id)?.ownsPaths ?? [];
    const expectedPaths = Array.isArray(contract.routing?.expected_paths)
      ? contract.routing.expected_paths
      : [];
    for (const glob of allowed) {
      if (!pathInScope(glob.replace(/\*+$/, "x"), owned) && !owned.includes(glob)) {
        fail(
          "writer.scope_exceeds_ownership",
          `lease path "${glob}" is outside what "${writer.agent_id}" owns [${owned.join(", ")}]`
        );
      }
      if (!pathInScope(glob.replace(/\*+$/, "x"), expectedPaths) && !expectedPaths.includes(glob)) {
        fail(
          "writer.scope_exceeds_contract",
          `lease path "${glob}" is outside routing.expected_paths [${expectedPaths.join(", ")}]`
        );
      }
    }
  }

  // ── Evidence ────────────────────────────────────────────────────────────────────────────────
  const evidence = Array.isArray(contract.evidence) ? contract.evidence : [];
  const required = evidence.filter((e) => e?.required === true);

  const emptyRequired = requireCardinality(
    required,
    1,
    "required evidence (items with required: true)"
  );
  if (emptyRequired) fail("evidence.no_required", emptyRequired.message);

  for (const item of evidence) {
    if (!object(item)) {
      fail("evidence.shape", "each evidence item must be an object");
      continue;
    }
    if (!nonEmptyString(item.id)) fail("evidence.id", "an evidence item has no non-empty id");
    if (!["build", "verifier", "gui", "packaged", "migration", "security", "inspection"].includes(item.type)) {
      fail("evidence.type", `evidence "${item.id ?? "unknown"}" has invalid type ${JSON.stringify(item.type)}`);
    }
    if (typeof item.required !== "boolean") {
      fail("evidence.required", `evidence "${item.id ?? "unknown"}" required must be boolean`);
    }
    if (item.command !== null && item.command !== undefined && typeof item.command !== "string") {
      fail("evidence.command", `evidence "${item.id ?? "unknown"}" command must be string or null`);
    }
    if (item.artifact !== null && item.artifact !== undefined && typeof item.artifact !== "string") {
      fail("evidence.artifact", `evidence "${item.id ?? "unknown"}" artifact must be string or null`);
    }
    if (!EVIDENCE_STATUSES.includes(item.result) && item.result !== "pending") {
      fail(
        "evidence.status",
        `evidence "${item.id}" has result "${item.result}", which is not one of ` +
          `${EVIDENCE_STATUSES.join(" | ")} (or "pending"). The ledger's vocabulary is the only one.`
      );
    }
  }
  const evidenceNames = evidence.map((item) => item?.id).filter(Boolean);
  if (new Set(evidenceNames).size !== evidenceNames.length) {
    fail("evidence.duplicate", "evidence IDs must be unique");
  }

  // ── Acceptance ──────────────────────────────────────────────────────────────────────────────
  const acceptance = Array.isArray(contract.acceptance) ? contract.acceptance : [];
  const noAcceptance = requireCardinality(acceptance, 1, "acceptance criteria");
  if (noAcceptance) fail("acceptance.empty", noAcceptance.message);

  const evidenceIds = new Set(evidence.map((e) => e?.id));
  const acceptanceIds = acceptance.map((criterion) => criterion?.id).filter(Boolean);
  if (new Set(acceptanceIds).size !== acceptanceIds.length) {
    fail("acceptance.duplicate", "acceptance criterion IDs must be unique");
  }
  for (const criterion of acceptance) {
    if (!object(criterion)) {
      fail("acceptance.shape", "each acceptance criterion must be an object");
      continue;
    }
    if (!nonEmptyString(criterion.id)) fail("acceptance.id", "an acceptance criterion has no non-empty id");
    if (!nonEmptyString(criterion.description)) {
      fail("acceptance.description", `acceptance "${criterion.id ?? "unknown"}" needs a description`);
    }
    const needs = Array.isArray(criterion?.evidence_required) ? criterion.evidence_required : [];
    const noLink = requireCardinality(needs, 1, `acceptance "${criterion?.id}" evidence_required`);
    if (noLink) {
      fail("acceptance.unproven", noLink.message);
      continue;
    }
    for (const id of needs) {
      if (!evidenceIds.has(id)) {
        fail("acceptance.dangling", `acceptance "${criterion?.id}" cites unknown evidence "${id}"`);
      } else {
        const cited = evidence.find((item) => item?.id === id);
        if (cited?.required !== true) {
          fail(
            "acceptance.optional_evidence",
            `acceptance "${criterion?.id}" cites evidence "${id}" that is not required`
          );
        }
      }
    }
  }

  if (contract.write_lease?.history !== undefined && !Array.isArray(contract.write_lease.history)) {
    fail("write_lease.history", "write_lease.history must be an append-only array when present");
  }
  for (const entry of Array.isArray(contract.write_lease?.history) ? contract.write_lease.history : []) {
    if (!object(entry) || !nonEmptyString(entry.id) || !nonEmptyString(entry.task) || !AGENT_IDS.includes(entry.holder)) {
      fail("write_lease.history_entry", "every lease history entry needs id, task and a canonical holder");
    }
    for (const field of ["allowed_paths", "amendments", "overrides", "violations"]) {
      if (!Array.isArray(entry?.[field])) {
        fail("write_lease.history_entry", `lease history ${entry?.id ?? "unknown"}.${field} must be an array`);
      }
    }
  }

  // ── Git policy ──────────────────────────────────────────────────────────────────────────────
  if (contract.git?.direct_main !== true) {
    fail("git.direct_main", "git.direct_main must be true — AWKIT develops on main only");
  }
  if (contract.git?.commit_policy !== "coherent") {
    fail("git.commit_policy", 'git.commit_policy must be "coherent"');
  }
  if (contract.git?.force_push !== false) fail("git.force_push", "force_push must be explicitly false");
  if (contract.git?.destructive_reset !== false) {
    fail("git.destructive_reset", "destructive_reset must be explicitly false");
  }

  if (!["pending", "implemented", "rejected", "blocked", "complete"].includes(contract.completion?.status)) {
    fail("completion.status", `invalid completion.status ${JSON.stringify(contract.completion?.status)}`);
  }
  if (!["pending", "PASS", "FAIL", "BLOCKED"].includes(contract.completion?.qa_status)) {
    fail("completion.qa_status", `invalid completion.qa_status ${JSON.stringify(contract.completion?.qa_status)}`);
  }
  if (!["pending", "APPROVED", "REJECTED", "NOT_REQUIRED"].includes(contract.completion?.qc_status)) {
    fail("completion.qc_status", `invalid completion.qc_status ${JSON.stringify(contract.completion?.qc_status)}`);
  }

  // ── Overrides ───────────────────────────────────────────────────────────────────────────────
  for (const violation of validateOverrides(contract)) violations.push(violation);

  return { ok: violations.length === 0, violations, routing };
}

/**
 * Emergency overrides must be exceptional, auditable, narrowly scoped, and QC-reviewed.
 *
 * @param {Record<string, any>} contract
 * @returns {Violation[]}
 */
export function validateOverrides(contract) {
  /** @type {Violation[]} */
  const violations = [];
  const overrides = Array.isArray(contract.write_lease?.overrides)
    ? contract.write_lease.overrides
    : [];

  for (const override of overrides) {
    const label = override?.timestamp ?? "(untimestamped)";

    if (!override?.reason) {
      violations.push({
        rule: "override.no_reason",
        message: `emergency override ${label} records no reason`
      });
    }

    const paths = Array.isArray(override?.affected_paths) ? override.affected_paths : [];
    const noPaths = requireCardinality(paths, 1, `override ${label} affected_paths`);
    if (noPaths) {
      violations.push({ rule: "override.no_paths", message: noPaths.message });
    }

    if (override?.qc_required !== true) {
      violations.push({
        rule: "override.no_qc",
        message:
          `emergency override ${label} does not set qc_required: true. An override that exempts ` +
          "itself from review is the abuse this rule exists for."
      });
    }

    if (override?.qc_required === true && contract.completion?.qc_status !== "APPROVED") {
      violations.push({
        rule: "override.qc_unresolved",
        message:
          `emergency override ${label} forces QC, but completion.qc_status is ` +
          `"${contract.completion?.qc_status ?? "pending"}" rather than APPROVED`
      });
    }
  }

  return violations;
}

/**
 * The completion gate.
 *
 * Returns the reasons a task may NOT be marked complete. An empty array means the gate is open —
 * which is only ever reached through the cardinality assertions above, never by having nothing to
 * check.
 *
 * @param {Record<string, any>} contract
 * @param {Object} [options]
 * @param {{violations?: {path: string, resolved?: boolean}[]}|null} [options.lease] the active
 *   lease, so out-of-lease Bash writes recorded by the PostToolUse audit are read back here. The
 *   audit can only DETECT — it runs after the write — so this is where that detection acquires
 *   consequences. Passing no lease means the gate simply does not consider them.
 * @returns {string[]}
 */
export function completionBlockers(contract, { lease = null } = {}) {
  /** @type {string[]} */
  const blockers = [];

  const approvedOverridePaths = new Set(
    contract.completion?.qc_status === "APPROVED"
      ? (contract.write_lease?.overrides ?? [])
          .filter((override) => override?.qc_required === true && override?.reason)
          .flatMap((override) => override?.affected_paths ?? [])
      : []
  );
  const historical = (contract.write_lease?.history ?? []).flatMap((entry) => entry?.violations ?? []);
  const unresolved = [...historical, ...(lease?.violations ?? [])]
    .filter((v) => !v?.resolved && !approvedOverridePaths.has(v?.path));
  if (unresolved.length > 0) {
    blockers.push(
      `${unresolved.length} unresolved out-of-lease write(s) recorded on the lease: ` +
        `${unresolved.map((v) => v.path).join(", ")}`
    );
  }

  const { ok, violations, routing } = validateContract(contract);
  if (!ok) blockers.push(`contract is invalid (${violations.length} violation(s))`);

  const evidence = Array.isArray(contract.evidence) ? contract.evidence : [];
  const required = evidence.filter((e) => e?.required === true);

  const vacuous = requireCardinality(required, 1, "required evidence");
  if (vacuous) {
    blockers.push(vacuous.message);
  } else {
    for (const item of required) {
      if (item.result !== "PASS") {
        blockers.push(
          `required evidence "${item.id}" is ${item.result ?? "pending"} — ` +
            "BLOCKED, NOT RUN and FAIL are not PASS"
        );
      }
    }
  }

  const evidenceById = new Map(evidence.map((item) => [item?.id, item]));
  for (const criterion of Array.isArray(contract.acceptance) ? contract.acceptance : []) {
    for (const id of Array.isArray(criterion?.evidence_required) ? criterion.evidence_required : []) {
      const item = evidenceById.get(id);
      if (!item || item.required !== true || item.result !== "PASS") {
        blockers.push(
          `acceptance "${criterion?.id ?? "unknown"}" is not proven: cited evidence "${id}" ` +
            `is ${item?.result ?? "missing"}${item?.required === true ? "" : " and not required"}`
        );
      }
    }
  }

  if (contract.completion?.qa_status !== "PASS") {
    blockers.push(`qa_status is "${contract.completion?.qa_status ?? "pending"}", not PASS`);
  }

  const qcRequired = routing?.reviewers?.includes("qc") === true;
  if (qcRequired && contract.completion?.qc_status !== "APPROVED") {
    blockers.push(`qc is a reviewer but qc_status is "${contract.completion?.qc_status ?? "pending"}"`);
  }

  const escapes = (Array.isArray(contract.scope_escapes) ? contract.scope_escapes : [])
    .filter((escape) => escape?.resolved !== true);
  if (escapes.length > 0) {
    blockers.push(`${escapes.length} unresolved scope escape(s) recorded on this contract`);
  }

  return blockers;
}
