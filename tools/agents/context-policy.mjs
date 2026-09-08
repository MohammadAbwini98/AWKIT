/**
 * AWKIT's token-aware delegation policy.
 *
 * These are orchestration thresholds, not product limits. Claude's status-line payload reports the
 * current input context, and the manager uses this policy to decide when verbose investigation
 * belongs in an isolated specialist context. `.claude/settings.json` bounds auto-compaction
 * calculations to 200K and applies the installed client's 75% override, targeting approximately
 * 150K even when the selected model advertises an extended context window.
 */

export const CONTEXT_POLICY = Object.freeze({
  standardWindowTokens: 200_000,
  autoCompactWindowTokens: 200_000,
  delegateAtTokens: 100_000,
  warnAtTokens: 120_000,
  compactAtTokens: 150_000,
  autoCompactPercent: 75,
  zones: Object.freeze({
    normal: Object.freeze({
      minTokens: 0,
      maxTokensExclusive: 100_000,
      action: "Work normally; delegate only bounded specialist work that saves total context."
    }),
    delegate: Object.freeze({
      minTokens: 100_000,
      maxTokensExclusive: 120_000,
      action: "Move verbose discovery, logs, history and broad source reading to one specialist."
    }),
    warning: Object.freeze({
      minTokens: 120_000,
      maxTokensExclusive: 150_000,
      action: "Strongly prefer isolated specialists and retain only concise evidence in the manager."
    }),
    compact: Object.freeze({
      minTokens: 150_000,
      maxTokensExclusive: Number.POSITIVE_INFINITY,
      action: "Allow automatic compaction; continue from the ephemeral repository-state checkpoint."
    })
  })
});

export const CONCURRENCY_POLICY = Object.freeze({
  routineSpecialists: 2,
  crossLayerSpecialists: 3,
  majorInvestigationSpecialists: 4,
  allRoleSwarm: "prohibited",
  allRoleSwarmProhibited: true,
  writerConcurrency: 1,
  defaultMode: "single-agent",
  routineSubagents: 0,
  defaultMaxSubagentsPerTask: 1,
  teamsMode:
    "Optional local interactive opt-in only for independent peer coordination; never enabled in shared settings."
});

/**
 * Routing decides which ROLE owns a concern. This decides who PERFORMS it.
 *
 * These are separate questions and conflating them is what made routine work expensive: a task that
 * routed `qa` was spawning `awkit-qa-engineer` to run a typecheck the primary agent could have run
 * itself in one command. Activation is unchanged — `route()` still names every role a task is
 * accountable for, every risk level still computes the same, and no check is skipped. What changes
 * is that the primary agent discharges a routed role IN PLACE unless one of the triggers below
 * fires, at which point the isolated context is buying something the primary cannot supply:
 * independent judgement, or genuine context relief.
 *
 * The numbers above are still ceilings, not targets. `routineSpecialists: 2` says a routine task may
 * never exceed two; `routineSubagents: 0` says it should normally use none.
 */
export const DELEGATION_TRIGGERS = Object.freeze([
  Object.freeze({
    id: "major-phase-completion",
    why: "A phase or milestone is being declared done, and the author of the work is the worst judge of whether it is."
  }),
  Object.freeze({
    id: "release-candidate",
    why: "A release claim is being made; release gates govern release claims."
  }),
  Object.freeze({
    id: "security-sensitive-change",
    why: "Licensing, auth, authorization, secret handling, protected-login or signing changed. Self-review of a trust boundary is not review."
  }),
  Object.freeze({
    id: "concurrency-or-runtime-change",
    why: "Admission control, scheduling, cancellation or shared-browser behavior changed; the failure modes are interleavings the author already reasoned past once."
  }),
  Object.freeze({
    id: "persistence-migration",
    why: "A persisted shape or migration changed, where the cost of being wrong is the user's data."
  }),
  Object.freeze({
    id: "architectural-refactor",
    why: "A contract, boundary or ownership rule moved, so the blast radius is larger than the diff."
  }),
  Object.freeze({
    id: "difficult-root-cause",
    why: "Investigation has stalled and a second independent reading is cheaper than a third wrong hypothesis."
  }),
  Object.freeze({
    id: "explicit-request",
    why: "The requester asked for review. No further justification is needed."
  })
]);

/** Work the primary agent finishes end to end. Delegating any of these is the anti-pattern. */
export const PRIMARY_AGENT_WORK = Object.freeze([
  "bug fixes",
  "UI adjustments",
  "small and medium features",
  "refactoring",
  "test fixes",
  "documentation",
  "configuration",
  "routine persistence edits",
  "routine validation",
  "git inspection",
  "project-state updates"
]);

/**
 * External model delegation (`glm-delegate`) is opt-in, never automatic.
 * Cheaper models are the LAST optimization, after not making the call at all.
 */
export const EXTERNAL_DELEGATION_POLICY = Object.freeze({
  automatic: false,
  allowedWhen: Object.freeze([
    "the requester explicitly asks for it",
    "the task is isolated and large enough that offloading it is economically advantageous",
    "a genuinely independent second analysis has measurable value"
  ]),
  neverFor: Object.freeze([
    "file searching",
    "summarization",
    "formatting",
    "test execution",
    "simple edits",
    "project-state updates"
  ])
});

/**
 * Optimization order. Moving a wasteful call to a cheaper model preserves the waste, so the model
 * choice is deliberately last.
 */
export const OPTIMIZATION_PRIORITY = Object.freeze([
  "avoid the unnecessary agent call",
  "minimize context sent",
  "minimize output requested",
  "target the validation",
  "only then select a cheaper model"
]);

/**
 * Compact review output. This does NOT replace `REPORT_SECTIONS`, which remains the contract for a
 * delegated specialist's full report; it is the shape a review returns when its job is a verdict
 * rather than a narrative.
 */
export const REVIEW_REPORT_FORMAT = Object.freeze({
  status: Object.freeze(["PASS", "FAIL"]),
  sections: Object.freeze(["Status", "Findings", "Validation", "Residual risk"]),
  findingShape: "file:line — severity — issue — required correction",
  validationShape: "command — PASS | FAIL",
  softLineLimit: 50,
  excluded: Object.freeze([
    "reasoning transcripts",
    "whole-repository summaries",
    "extensive evidence tables",
    "descriptions of unchanged code",
    "restatements of the requirements"
  ])
});

/**
 * Context loading. AWKIT's durable memory already lives in `docs/ai/`; this separates the part that
 * loads every task from the part that is fetched only when a question demands it. The archives are
 * not deleted and not devalued — they are simply not paid for on a task that never opens them.
 */
export const CONTEXT_LOADING = Object.freeze({
  /**
   * Paid on EVERY task, so it stays small. Three entries, two of which are the task itself and the
   * rules that govern it. Everything else has to earn its place by a trigger below.
   */
  always: Object.freeze([
    Object.freeze({
      source: "AGENTS.md + CLAUDE.md",
      why: "The operating rules. CLAUDE.md imports AGENTS.md, so this is one read, not two."
    }),
    Object.freeze({
      source: "docs/ai/CURRENT_STATE.md",
      why: "Current project state: what works, what is incomplete, what moved last."
    }),
    Object.freeze({
      source: "the active task contract",
      why: "The task's own objective, classification, acceptance criteria and lease scope."
    })
  ]),

  /**
   * Opened ONLY when the task touches the subject. Each entry carries the classification flags that
   * fire it, so the decision is a lookup rather than a judgement call. A small single-layer change
   * fires none of these, and that is the point: its context budget is the always-set.
   */
  conditional: Object.freeze([
    Object.freeze({
      source: "docs/ai/ARCHITECTURE.md, docs/ai/DECISIONS.md",
      when: "architecture or cross-layer change",
      trigger: "cross_layer_count >= 2, public_contract_change, new_dependency, or a module boundary moves"
    }),
    Object.freeze({
      source: "docs/ai/COMMANDS.md, docs/ai/TESTING.md",
      when: "validating",
      trigger: "you are about to choose, run, add or change a verification command"
    }),
    Object.freeze({
      source: "docs/ai/SECURITY.md",
      when: "security-sensitive work",
      trigger:
        "licensing_change, auth_change, authorization_change, secret_handling_change, " +
        "protected_login_change, signing_change"
    }),
    Object.freeze({
      source: "docs/ai/RULES.md data rules, the local AGENTS.md of the folder being modified",
      when: "persistence or schema work",
      trigger: "persisted_shape_change, migration_required, filesystem_write_change"
    }),
    Object.freeze({
      source: "docs/ai/RULES.md offline rules, docs/OFFLINE_STANDALONE_PACKAGING.md",
      when: "packaging or release work",
      trigger: "packaging_change, offline_boundary_change, signing_change, new_dependency"
    }),
    Object.freeze({
      source: "docs/ai/RULES.md UI rules, the local AGENTS.md of the folder being modified",
      when: "renderer or UI work",
      trigger: "renderer_visual_change, interaction_change, accessibility_change"
    }),
    Object.freeze({
      source: "docs/ai/HANDOFF.md",
      when: "resuming paused or handed-off work",
      trigger: "the task continues someone else's work, or the previous task was parked"
    }),
    Object.freeze({
      source: "docs/ai/KNOWN_ISSUES.md",
      when: "the area is known-fragile or a failure looks familiar",
      trigger: "an unexpected failure, or work a previous task flagged as risky"
    }),
    Object.freeze({
      source: "docs/ai/GRAPHIFY.md, docs/ai/routing/ROUTING_MATRIX.md",
      when: "using the code graph, or questioning who owns a path",
      trigger: "broad_investigation, or a routing or path-ownership question"
    })
  ]),

  historical: Object.freeze([
    "docs/ai/TASK_LOG.md",
    "docs/ai/contracts/**",
    "playwright_flow_studio_updated_phases/**",
    "change_requests/**",
    "docs/IMPLEMENTATION_AUDIT.md",
    "phase reports and prior audits"
  ]),

  rule:
    "Open a conditional source only when its trigger actually fires, and stop there. Open a " +
    "historical document only to answer a specific question, and read the section, not the file. " +
    "Never load the whole repository, every planning file, all phase reports or unrelated " +
    "architecture documents to make a scoped change: for a small single-layer change the " +
    "always-set is the whole budget, and a tiny UI bug loads no persistence, release, architecture " +
    "or historical validation context at all."
});

/** The four epistemic labels every delegated result must use. */
export const DELEGATION_FIELDS = Object.freeze([
  "FACT",
  "INFERENCE",
  "RECOMMENDATION",
  "UNKNOWN"
]);

/** The minimal packet the manager sends into an isolated specialist context. */
export const DELEGATION_PACKET_FIELDS = Object.freeze([
  "Objective",
  "Relevant acceptance criteria",
  "Relevant AWKIT constraints",
  "Known evidence",
  "Relevant files/modules",
  "Expected output",
  "Write authority"
]);

/** Concise report headings returned to the manager. */
export const REPORT_SECTIONS = Object.freeze([
  "Summary",
  "Evidence",
  "Changes",
  "Files",
  "Checks",
  "Results",
  "Risks",
  "Unresolved",
  "Next action"
]);

export const DEFECT_REPORT_FIELDS = Object.freeze([
  "Expected behavior",
  "Actual behavior",
  "Reproduction",
  "Root cause",
  "Evidence",
  "Affected layer",
  "Proposed fix",
  "Regression risk",
  "Verification"
]);

/**
 * @param {number} tokens current input-context tokens
 * @returns {{zone:"normal"|"delegate"|"warning"|"compact", tokens:number, action:string}}
 */
export function contextZoneFor(tokens) {
  const value = Number.isFinite(Number(tokens)) ? Math.max(0, Number(tokens)) : 0;
  let zone = "normal";
  if (value >= CONTEXT_POLICY.compactAtTokens) zone = "compact";
  else if (value >= CONTEXT_POLICY.warnAtTokens) zone = "warning";
  else if (value >= CONTEXT_POLICY.delegateAtTokens) zone = "delegate";

  return { zone, tokens: value, action: CONTEXT_POLICY.zones[zone].action };
}

/**
 * Maximum concurrently active specialists, excluding the manager. Writers remain serialized even
 * when read-only specialists run in parallel.
 *
 * @param {{crossLayerCount?:number, broadInvestigation?:boolean}} [input]
 * @returns {number}
 */
export function specialistLimitFor({ crossLayerCount = 1, broadInvestigation = false } = {}) {
  if (broadInvestigation && Number(crossLayerCount) >= 3) {
    return CONCURRENCY_POLICY.majorInvestigationSpecialists;
  }
  if (Number(crossLayerCount) >= 2) return CONCURRENCY_POLICY.crossLayerSpecialists;
  return CONCURRENCY_POLICY.routineSpecialists;
}

/** Trigger ids, for callers that only need membership. */
export const DELEGATION_TRIGGER_IDS = Object.freeze(DELEGATION_TRIGGERS.map((t) => t.id));

/**
 * Whether a task should spawn anything, and how many.
 *
 * The default answer is no. A trigger is required, it must be NAMED, and availability is not a
 * reason: "there is a reviewer agent" has never been an argument that a review is needed.
 *
 * This decides execution only. It does not remove a routed role, lower a risk level or skip a
 * check — the primary agent still discharges every activated role and still runs the validation the
 * contract declared. `route()` remains the authority on WHO is accountable.
 *
 * @param {{triggers?: string[], crossLayerCount?: number, broadInvestigation?: boolean}} [input]
 * @returns {{delegate: boolean, maxSubagents: number, ceiling: number, triggers: string[], reason: string}}
 */
export function delegationDecisionFor({
  triggers = [],
  crossLayerCount = 1,
  broadInvestigation = false
} = {}) {
  const ceiling = specialistLimitFor({ crossLayerCount, broadInvestigation });
  const named = (Array.isArray(triggers) ? triggers : [])
    .map((t) => String(t).trim())
    .filter((t) => DELEGATION_TRIGGER_IDS.includes(t));

  if (named.length === 0) {
    return {
      delegate: false,
      maxSubagents: CONCURRENCY_POLICY.routineSubagents,
      ceiling,
      triggers: [],
      reason:
        "No delegation trigger named. The primary agent completes this task end to end, including its validation."
    };
  }

  // Even with a trigger the default is ONE independent reader. More requires the ceiling to allow
  // it AND a genuine second concern — parallel reviewers of the same diff mostly re-derive
  // each other, at full price.
  const maxSubagents = Math.min(
    Math.max(CONCURRENCY_POLICY.defaultMaxSubagentsPerTask, named.length > 1 ? 2 : 1),
    ceiling
  );

  return {
    delegate: true,
    maxSubagents,
    ceiling,
    triggers: named,
    reason: `Delegation authorized by: ${named.join(", ")}.`
  };
}

/**
 * Nested delegation is prohibited by default. A subagent completes the scope it was given; it does
 * not decide it needs a committee. Only the primary agent may authorize a nested spawn, explicitly.
 */
export const NESTED_DELEGATION = Object.freeze({
  allowedByDefault: false,
  requiresExplicitPrimaryAuthorization: true,
  rule:
    "Subagents must complete their assigned scope themselves. They must not delegate to additional " +
    "agents unless the primary agent explicitly authorizes nested delegation."
});
