/**
 * The claim screens over an L4b explanation, and the display gate built on them (R4, owner-authorized
 * 2026-09-25). Phase L, L4b.
 *
 * The screens were written for the quality harness (`scripts/ai-harness/authoringQualitySet.ts`) and moved
 * here unchanged, so the product and the harness apply ONE set of rules: the harness imports them from this
 * module. A screen can prove an explanation wrong; nothing here can prove one right.
 *
 * The display gate (`withholdReasons`) decides whether the Flow Designer may show a model's explanation. It
 * withholds one that a screen hits, or that states a cause or a run-time consequence in its OWN words. What
 * the product itself told the model is trusted evidence: the issue's rule summary (whole, or one of its
 * clauses) and its corrective step, verbatim, and whether the issue blocks the run. A cause or consequence
 * that is a copy of that evidence is shown; any other one is withheld, because no lexical rule can tell a
 * supported paraphrase from an invented one. The validator stays the source of truth: a withheld answer's
 * issue, severity and corrective step are shown exactly as before, and only the model's text is not.
 *
 * Coverage limits (see L4-authoring-diagnostics.md › R4): causes are read from connectives and consequences
 * from a closed vocabulary of run-time outcomes, both in English; a cause or consequence worded outside them
 * ("prevents", "the value ends up empty") is not read, and a correct paraphrase of a rule's consequence is
 * withheld with the wrong ones. Evidence is removed only where it starts a sentence (or follows "Action:"),
 * so a claim in a separate sentence beside it is read on its own words only. Positions, values, severities and
 * remedies are the existing screens' own limits, and positions and values are checked against the whole
 * request, the other issue's line included.
 *
 * Pure: no Electron, no filesystem, no clock, no model.
 */

import { FLOW_VALIDATION_RULES, isExecutionBlocking, type FlowValidationCode } from "../validation/FlowValidator";
import type { AuthoringIssueRef, AuthoringRequest } from "./authoringExplanation";

/**
 * Corrections a rule contradicts, one pattern per rule whose wrong direction is unambiguous. Unlike the
 * harness's subject and remedy patterns, these were written AFTER real answers were read: each is a
 * regression screen for a correction the 97996c48 captures gave (an agent's reading, pending a person's
 * review), generalised from the rule rather than from the wording. A hit is an unsupported claim, and never
 * actionable.
 */
export const WRONG_REMEDY: Readonly<Partial<Record<FlowValidationCode, RegExp>>> = Object.freeze({
  // The connector LEAVING End is the defect; another connector into End leaves it in place.
  connectorFromEndNode: /\b(?:add|connect|draw|create|insert)\b[^.;]{0,40}\bconnectors?\b[^.;]{0,30}\b(?:to|into|reach(?:es)?)\b[^.;]{0,15}\bend\b/i,
  // The step's type needs one: saying it is not needed or not required inverts the rule.
  missingRequiredValue: /\b(?:not|never)\b[^.;]{0,20}\b(?:need|requir)\w*[^.;]{0,20}\bvalues?\b/i,
  missingRequiredLocator: /\b(?:not|never)\b[^.;]{0,20}\b(?:need|requir)\w*[^.;]{0,20}\blocators?\b/i,
  // The emitted fix gives the duplicate a new id. Removing a connector, or an id, is a structural change no rule asks for.
  duplicateEdgeId: /\b(?:remove|delete|drop)\b[^.;]{0,25}\b(?:edges?|connectors?|connections?|ids?|identifiers?)\b/i,
  // The connector already carries its condition, and the runner is nothing the editor changes.
  incompleteBranchPair: /\badd (?:a |another |the )?condition\b|\b(?:add|set|change|configure)\b[^.;]{0,30}\b(?:to|in) the runner\b/i,
  // A timeout that is already unusually high is not corrected by raising it.
  highTimeout: /\b(?:increase|raise|extend|lengthen)\b[^.;]{0,20}\btimeouts?\b/i
});

/**
 * Claims the request does not support, each one evidence an explanation is wrong:
 *  - AUTO_FIX_CLAIMED: the application can repair an issue it emitted no fix for (AI inventing a fix);
 *  - OFF_DOMAIN: a cause or remedy outside the flow (restart, network, cache, credentials, support);
 *  - FABRICATED_LITERAL: a name quoted in any style, a selector, a URL or a value the request never held
 *    (a value is held only as a target the request gives: "to a listed value"), the corrective action
 *    given as a step's name (`ACTION_AS_NAME`), or a step's position (`POSITION`, since 2026-09-25);
 *  - SEVERITY_OVERSTATED: an issue that does not block the run is said to stop the flow running, to block
 *    the run, or to have failed validation (the last two since 2026-09-25);
 *  - SEVERITY_UNDERSTATED: an issue that blocks the run is said to be harmless, only a warning, or not to
 *    block the run;
 *  - WRONG_REMEDY: a correction the issue's own rule contradicts (`WRONG_REMEDY`).
 */
export type UnsupportedKind = "AUTO_FIX_CLAIMED" | "OFF_DOMAIN" | "FABRICATED_LITERAL" | "SEVERITY_OVERSTATED" | "SEVERITY_UNDERSTATED" | "WRONG_REMEDY";

const AUTO_FIX =
  /\b(?:app|application|tool|designer|editor|validator|system|awkit)\b[^.;]{0,20}\b(?:can|will|could)\b[^.;]{0,15}\b(?:fix|repair|correct|resolve|regenerate|rewrite|normalize)\b|\bapply (?:the |a |its )?(?:safe |suggested |available |automatic )?(?:fix|repair)\b|\bauto-?fix|\bone[- ]click\b|\b(?:is|marked) fixable\b|\bfix(?:ed)? (?:it |this )?automatically\b/i;
const NEGATED = /\b(?:not|no|cannot|can't|isn't|won't)\b/i;
const OFF_DOMAIN =
  /\b(?:restart|reboot|reinstall|internet|network|wi-?fi|cache|cookies?|firewall|antivirus|vpn|password|credentials?|permissions?|licen[cs]e|contact (?:support|an? admin\w*|your admin\w*|the admin\w*))\b|\bupdate (?:the |your )?(?:app|application|browser|software|driver)s?\b|\b(?:log|sign) ?in again\b/i;
const BLOCKS_RUN =
  /\b(?:flow|run|automation|execution)\b[^.;]{0,25}\b(?:cannot|can't|can not|won't|will not|unable to|is blocked from)\b[^.;]{0,15}\b(?:run|start|execute|begin)\b|\bfrom (?:running|starting|executing|being run)\b|\bbefore (?:the flow|it) can (?:run|start)\b/i;
/** The request's own words since R2 (2026-09-25): each issue's line says whether it blocks the run. */
const BLOCKS_THE_RUN = /\bblock(?:s|ed|ing)?\s+(?:the\s+)?(?:run|flow|execution)\b/gi;
/**
 * A validation failure claimed: "failed validation", "fail the validation", "validation fails", "a validation
 * failure". Written from the 2026-09-25 AI evaluation (R1, owner-authorized the same day): 7 displayed answers
 * gave a warning as the reason "the automation flow failed validation", and `BLOCKS_RUN` read none of them. A
 * non-blocking issue fails nothing, whether its report holds only warnings or a blocking error beside it.
 */
const VALIDATION_FAILED = /\bfail(?:s|ed|ing)?\s+(?:the\s+|its\s+)?validation\b|\bvalidation\s+(?:\w+\s+){0,2}?fail(?:s|ed|ing|ures?)?\b/gi;
/**
 * A negation ON the claim: inside it, or in the few characters before it ("does not fail validation"). One
 * elsewhere in the sentence negates nothing: "…failed validation because a reachable step had no way out".
 */
const NEGATES_CLAIM = /\b(?:not|never|no)\b|n't\b/i;
const claims = (text: string, pattern: RegExp): boolean =>
  [...text.matchAll(pattern)].some((m) => !NEGATES_CLAIM.test(`${text.slice(Math.max(0, (m.index ?? 0) - 12), m.index)}${m[0]}`));
const HARMLESS =
  /\b(?:harmless|(?:safe|okay|ok|fine) to ignore|can (?:safely )?(?:be )?ignored?|(?:only|just) a warning|not (?:a )?(?:real |serious |critical |blocking )?(?:problem|issue|error)|does(?:n't| not) matter|(?:does|do|will) ?(?:not|n't) block|won't block|not blocking|non-?blocking)\b/i;
/**
 * Quoted text in any style. A single quote opens only after a non-letter and closes only before one, so the
 * apostrophes in "step's", "steps'" and "can't" are never quotation marks. Until 2026-09-23 only double
 * quotes and backticks were read, and "Correct the operator casing to 'operator'." cleared the screen.
 */
const QUOTED = [/["`“”]([^"`“”]{2,})["`“”]/g, /(?<![\p{L}\p{N}_])['‘](\S[^\n]*?\S)['’](?![\p{L}\p{N}_])/gu];
/** A value, where it is what something is changed or set TO. */
const VALUE_TARGET = /(?:\b(?:change|correct|set|switch|convert|rename|update|normali[sz]e)\w*\b[^.;!?]{0,60}\b(?:to|into)|=)\s*$/i;
/** An unquoted value only a literal can be: a boolean, null, or a code-like name ("notEquals"). */
const LITERAL_WORD = /(?<=\b(?:to|into)\s+|=\s*)([A-Za-z_]\w*)/gi;
const literalShaped = (word: string) => /^(?:true|false|null)$/i.test(word) || /^[a-z]+(?:[A-Z][a-z0-9]*)+$/.test(word);
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Held as a whole phrase: a literal that occurs only inside a longer word ("supported" in "unsupportedOperator") is not held. */
const holds = (supported: string, pattern: string) => new RegExp(`(?<![\\p{L}\\p{N}_])${pattern}(?![\\p{L}\\p{N}_])`, "iu").test(supported);
/**
 * The corrective action given as the NAME of a step ("The step 'Add a locator to this step' is missing
 * a locator"): a step name the request never held, and no instruction. Written after the first 2026-09-23
 * capture showed it, while the request still labelled the action "Step:".
 */
export const ACTION_AS_NAME = /\bstep\s+["'`“‘]?(?:add|apply|change|choose|connect|delete|fill|give|keep|lower|move|reconnect|remove|review|set)\b/i;
/**
 * A place in the flow the request never gives: an ordinal step ("the first step") or a numbered one ("step 3").
 * The request says only "at a node" or "at a connector". Written from the 2026-09-25 AI evaluation (R1): "the
 * first step" for a timeout on the flow's second step read clear, because `NUMBER` reads digits, not ordinals.
 * An issue's id given as its step ("at step i0", the first live run after R2) is one too: the id names the
 * issue, never where it is. "This step" and "the next step" are the request's own words and no position.
 */
const POSITION =
  /\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|final|\d+(?:st|nd|rd|th))\s+(?:steps?|nodes?|connectors?|actions?|conditions?|branch(?:es)?)\b|\b(?:step|node|connector)\s+(?:#\s*|number\s+)?\d+\b|\b(?:steps?|nodes?|connectors?)\s+["'`“‘]?i\d+\b/gi;
const NUMBER = /\b(\d+(?:[.,]\d+)*)\s*(ms|milliseconds?|s|secs?|seconds?|mins?|minutes?|h|hours?|%|px|times)?\b/gi;
const SELECTOR = /https?:\/\/|www\.|(?:^|\s)[#.][a-z][\w-]*|\[data-[\w-]+/i;

export const sentencesOf = (text: string): string[] => text.split(/[.!?;]+/).filter((s) => s.trim());

/** Everything the model was given: the instructions and the Issues block, never the nonce. */
export const supportedTextOf = (request: AuthoringRequest): string => [request.prompt.instructions, ...request.prompt.fields.map((f) => f.text)].join("\n");

function fabricatesLiteral(raw: string, supported: string): boolean {
  // An escaped quotation mark (\' or \") quotes like a plain one.
  const text = raw.replace(/\\(?=["'`“”‘’])/g, "");
  if (ACTION_AS_NAME.test(text)) return true;
  if ([...text.matchAll(POSITION)].some((m) => !holds(supported, escapeRegExp(m[0]).replace(/\s+/g, "\\s+")))) return true;
  const literals = [
    ...QUOTED.flatMap((quoted) => [...text.matchAll(quoted)].map((m) => ({ value: m[1].trim(), at: m.index ?? 0, quoted: true }))),
    ...[...text.matchAll(LITERAL_WORD)].filter((m) => literalShaped(m[1])).map((m) => ({ value: m[1], at: m.index ?? 0, quoted: false }))
  ];
  for (const { value, at, quoted } of literals) {
    // A value is held only as a target the request gives itself ("…to a listed value"), never as a word
    // it uses elsewhere: "to 'operator'" is a value the request never held, though it says "operator".
    if (VALUE_TARGET.test(text.slice(0, at))) {
      if (!holds(supported, `\\b(?:to|into)\\s+(?:(?:a|an|the|one of the)\\s+)?${escapeRegExp(value)}`)) return true;
    } else if (quoted && !holds(supported, escapeRegExp(value))) return true;
  }
  for (const number of text.matchAll(NUMBER)) {
    // A small count ("2 connectors") restates "two or more"; a value or a unit is something the model was never told.
    // Held where it ends a sentence too: invalidLoopBounds' own "…from 1 to 1000." was read as a value never given
    // (DX revision 2, 2026-09-26). A decimal part ("1000.5") still makes it another number.
    const held = new RegExp(`(?<![\\w.,])${number[1].replace(/[.,]/g, "\\$&")}(?![\\w,]|\\.\\d)`).test(supported);
    if (!held && (number[2] !== undefined || Number(number[1].replace(/,/g, "")) >= 3)) return true;
  }
  return SELECTOR.test(text);
}

/** The screens that hit one explanation of `ref`. */
export function unsupportedClaims(ref: AuthoringIssueRef, text: string, supported: string): UnsupportedKind[] {
  const hits: UnsupportedKind[] = [];
  if (!ref.fixable && sentencesOf(text).some((s) => AUTO_FIX.test(s) && !NEGATED.test(s))) hits.push("AUTO_FIX_CLAIMED");
  if (OFF_DOMAIN.test(text)) hits.push("OFF_DOMAIN");
  if (fabricatesLiteral(text, supported)) hits.push("FABRICATED_LITERAL");
  const blocking = isExecutionBlocking(ref.issue);
  if (!blocking && (BLOCKS_RUN.test(text) || claims(text, BLOCKS_THE_RUN) || claims(text, VALIDATION_FAILED))) hits.push("SEVERITY_OVERSTATED");
  if (blocking && HARMLESS.test(text)) hits.push("SEVERITY_UNDERSTATED");
  if (WRONG_REMEDY[ref.issue.code]?.test(text)) hits.push("WRONG_REMEDY");
  return hits;
}

/**
 * A claim that one thing causes or explains another. Detected, never judged: a lexical screen cannot tell a
 * cause the evidence supports from an invented one, so every displayed answer that makes one needs a person
 * (R1, owner 2026-09-25; criterion 1). "So that" states a purpose, not a cause.
 */
export const makesCausalClaim = (text: string): boolean =>
  /\b(?:because|caus(?:e|es|ed|ing)\b|due to|as a result|results? in|resulted in|leads? to|led to|therefore|which means|so (?:it|its|the|this)\b)/i.test(text);

/**
 * What happens when the flow runs, as a closed vocabulary of run-time outcomes (R4). Written from the rule
 * summaries' consequence clauses, the part the 0.8B distorted in 5 of the 8 unsupported answers of the
 * 2026-09-25 evaluation, and from the outcomes a run can have. Not "block": whether an issue blocks the run
 * is the severity screens' to judge, both ways.
 */
const CONSEQUENCE = new RegExp(
  `\\b(?:${[
    "fail(?:s|ed|ing|ures?)?",
    "stop(?:s|ped|ping)?",
    "halt(?:s|ed|ing)?",
    "abort(?:s|ed|ing)?",
    "crash(?:es|ed|ing)?",
    "hang(?:s|ing)?",
    "freez(?:e|es|ing)",
    "terminat(?:e|es|ed|ing)",
    "skip(?:s|ped|ping)?",
    "ignor(?:e|es|ed|ing)",
    "finish(?:es|ed|ing)?",
    "the run ends",
    "ends the run",
    "times? out",
    "timed out",
    "throw(?:s|n|ing)?",
    "forever",
    "infinite(?:ly)?",
    "endless(?:ly)?",
    "runs? (?:twice|again|once|repeatedly|more than once)",
    "never (?:runs?|executes?|starts?|reach(?:es)?|completes?)",
    "succeed(?:s|ed)?",
    "reports? (?:success|an error|a failure)",
    "resolv(?:e|es|ed|ing) to",
    "without reaching"
  ].join("|")})\\b`,
  "i"
);
/** Something not running or starting: a consequence, unless the evidence below states it. */
const NOT_RUN = /\b(?:cannot|can't|can not|won't|will not|unable to|does not|doesn't|do not|don't)\s+(?:be\s+)?(?:run|start|execute|begin)\b/i;
/**
 * The FLOW not running or starting: the Issues line's own "blocks the run", so evidence for an issue that
 * blocks it. Only with the flow or the run named as its subject: "only this step will not execute" is a
 * claim about scope that nothing supports, and so is "only this step is affected; it will not execute",
 * where a pronoun carries the step back in (QC, 2026-09-25, both passes).
 */
const FLOW_NOT_RUN = /\b(?:the flow|this flow|the run|the automation)\s+(?:cannot|can't|can not|won't|will not|is unable to|does not|doesn't)\s+(?:be\s+)?(?:run|start|execute|begin)\b/gi;

/** A claim about what happens at run time, in `text` as given. */
export const makesConsequenceClaim = (text: string): boolean => CONSEQUENCE.test(text) || NOT_RUN.test(text);

/**
 * The evidence the product itself gave for `ref`, as spans a model may copy: the rule's summary, each of its
 * clauses, and the corrective step. Longest first, so a whole summary is taken before one of its clauses.
 */
function evidenceSpans(ref: AuthoringIssueRef): string[] {
  const summary = FLOW_VALIDATION_RULES[ref.issue.code].summary;
  const spans = [summary, ...summary.split(/;\s+|\.\s+/), ref.step].map((s) => s.trim().replace(/[.;]$/, "")).filter((s) => s.length >= 12);
  return [...new Set(spans)].sort((a, b) => b.length - a.length);
}

/**
 * `text` with every verbatim copy of `ref`'s evidence taken out, whatever its case: the model's own words.
 * A copy counts only as a statement of its own: starting the text, a sentence or the request's own
 * "Action:" label, and ending at a sentence or clause break. Inside a sentence the words around it can
 * reverse it ("After you add a connector, the run stops there…"), and so can a framing colon or clause ("It is
 * not true that: …; the run stops there…"), so it stays and is read like the rest (QC, 2026-09-25, both
 * passes). A whole summary copied as a sentence is removed whole, its own ";" included.
 */
function ownWordsOf(ref: AuthoringIssueRef, text: string): string {
  let rest = text.replace(/\s+/g, " ");
  for (const span of evidenceSpans(ref)) {
    rest = rest.replace(new RegExp(`(?<=^|[.!?]\\s|Action:\\s)${escapeRegExp(span).replace(/ /g, "\\s+")}(?=\\s*(?:[.!?;]|$))`, "gi"), " ");
  }
  return rest;
}

/**
 * Why an explanation is withheld from display (R4): a screen's hit, or a cause or a run-time consequence the
 * product's evidence does not state.
 */
export type ExplanationWithholdReason = UnsupportedKind | "UNESTABLISHED_CAUSE" | "UNESTABLISHED_CONSEQUENCE";

/**
 * The display gate: every reason the product withholds this explanation of `ref`, in a fixed order; empty
 * when it may be shown. `text` is the text as it would be displayed (complete sentences only), `supported`
 * everything the model was given (`supportedTextOf`). Deterministic, and it fails closed: a claim it cannot
 * establish from the evidence is withheld, never shown on a guess.
 */
export function withholdReasons(ref: AuthoringIssueRef, text: string, supported: string): ExplanationWithholdReason[] {
  const reasons: ExplanationWithholdReason[] = unsupportedClaims(ref, text, supported);
  const own = ownWordsOf(ref, text);
  if (makesCausalClaim(own)) reasons.push("UNESTABLISHED_CAUSE");
  // A validation failure is a severity claim, judged both ways above. So is the run not starting, which the
  // issue's own line states when it blocks the run.
  const rest = own.replace(VALIDATION_FAILED, " ").replace(isExecutionBlocking(ref.issue) ? FLOW_NOT_RUN : /$^/, " ");
  if (makesConsequenceClaim(rest)) reasons.push("UNESTABLISHED_CONSEQUENCE");
  return reasons;
}

const WITHHOLD_REASON_TEXT: Readonly<Record<ExplanationWithholdReason, string>> = Object.freeze({
  UNESTABLISHED_CAUSE: "gave a cause",
  UNESTABLISHED_CONSEQUENCE: "said what happens when the flow runs",
  FABRICATED_LITERAL: "named a step, position, value or selector",
  SEVERITY_OVERSTATED: "said this finding stops the run",
  SEVERITY_UNDERSTATED: "said this finding does not matter",
  AUTO_FIX_CLAIMED: "offered an automatic fix",
  OFF_DOMAIN: "pointed outside the flow",
  WRONG_REMEDY: "suggested a correction this rule contradicts"
});

/** The sentence the Flow Designer shows in place of a withheld explanation. Product text, never model text. */
export function withheldExplanationSentence(reasons: readonly ExplanationWithholdReason[]): string {
  const parts = [...new Set(reasons)].map((reason) => WITHHOLD_REASON_TEXT[reason]);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] ?? "made a claim";
  return `Not shown: the AI's text ${list}, which the validator's findings do not establish. The finding and its corrective action stand.`;
}
