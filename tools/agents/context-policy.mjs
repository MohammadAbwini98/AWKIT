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
  defaultMode: "subagents",
  teamsMode:
    "Optional local interactive opt-in only for independent peer coordination; never enabled in shared settings."
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
