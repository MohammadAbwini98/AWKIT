/**
 * L4b's held-out set, chosen by a rule committed before any candidate was enumerated (owner directive
 * 2026-09-26, latest, `docs/ai/DECISIONS.md`: the agent selects, by a predeclared reproducible procedure, and no
 * person or agent picks, ranks or previews a case). The rule, in full:
 *
 * Sources: existing repository test scenarios, none of which L4b's development ever sent to a model.
 *  - S1: every flow file in `resources/sample-flows/` and `resources/test-fixtures/mock-site/flows/`.
 *  - S2: the Randomized Test Lab's committed oracle campaign `awkit-oracle-baseline-001`, exactly as
 *    `scripts/verify-random-oracle.mts` builds it (9 patterns × 6 valid flows, each given each of the 13
 *    controlled defects of `src/testing/random/RandomMutator.ts`, with that verifier's own seeds). Only the
 *    mutated flows: the valid ones are its positive controls. Each defect's expected detection is the oracle's
 *    (`MUTATION_EXPECTATIONS`); the issues sent are the product validator's own findings.
 *
 * Eligibility, in order; the first rule a candidate fails is recorded against it:
 *  - E1: the held-out structural rules (`checkHeldOutFlow`): a flow the product accepts, outside the labelled
 *    set, no canary, nothing the product's redaction treats as sensitive, at least one issue.
 *  - E2: the request's Issues text (the only flow-dependent part of what the model is sent; the instructions are
 *    fixed) differs from every request L4b's development sent a real model: the nine labelled cases and the
 *    L1.8 `validationExplanation` packet's flow.
 *  - E3: it differs from every other eligible candidate's too. Of candidates sharing one, the one with the
 *    smallest content SHA-256 stays; the others are near-duplicates.
 *
 * Selection: the seed is the SHA-256 of the committed `eligibility.json`, as parsed and re-serialized. Eligible
 * candidates are ordered by SHA-256(seed, newline, their content SHA-256), and the shortest prefix sending at
 * least 17 issues is the set. No other seed or subset is ever tried.
 *
 * Electron-free and model-free: nothing here runs a model or the display gate.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { buildAuthoringRequest, type AuthoringRequest } from "@src/ai/authoringExplanation";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import { ALL_FLOW_PATTERNS, resolveConstraints } from "@src/testing/random/GenerationConstraints";
import { generateFlow } from "@src/testing/random/RandomFlowGenerator";
import { ALL_MUTATION_KINDS, applyMutation } from "@src/testing/random/RandomMutator";
import { SeededRandom } from "@src/testing/random/SeededRandom";
import { validateFlowDefinition } from "@src/validation/FlowValidator";

import { DX_RULES, checkHeldOutFlow, heldOutRequest, type HeldOutCase } from "./authoringDx";
import { LABELLED_SET } from "./authoringQualitySet";
import { FLOW as L18_EXPLANATION_FLOW } from "./validationExplanationPacket";

export const SELECTION_RULES = 1;
/** The oracle campaign's constants, as `scripts/verify-random-oracle.mts` declares them. */
export const ORACLE_CAMPAIGN_SEED = "awkit-oracle-baseline-001";
export const RESOURCE_FLOW_DIRS = ["resources/sample-flows", "resources/test-fixtures/mock-site/flows"] as const;
export const ELIGIBILITY_FILE = "eligibility.json";

export interface Candidate {
  /** `file:<repository path>` or `oracle:<flow id>:<defect>`. */
  source: string;
  /** The flow as a `.json` file holds it. */
  text: string;
}

export interface EligibilityEntry {
  source: string;
  /** Content SHA-256 as `checkHeldOutFlow` takes it; `null` when the file is not a flow at all. */
  sha256: string | null;
  sent: HeldOutCase["sent"];
  truncated: number;
  /** SHA-256 of the request's Issues text; `null` when there is no request. */
  requestSha256: string | null;
  eligible: boolean;
  /** The first rule that excluded it, with the reason. */
  excluded?: string;
}

export interface EligibilityInventory {
  version: 1;
  rules: typeof SELECTION_RULES;
  candidates: number;
  eligible: number;
  issuesEligible: number;
  entries: EligibilityEntry[];
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const issuesText = (request: AuthoringRequest) => request.prompt.fields.map((field) => ("text" in field ? String(field.text) : "")).join("\n");

/** S1, in path order. */
export function resourceCandidates(root: string): Candidate[] {
  return RESOURCE_FLOW_DIRS.flatMap((dir) =>
    fs
      .readdirSync(path.join(root, dir))
      .filter((name) => name.toLowerCase().endsWith(".json"))
      .sort(byCodeUnits)
      .map((name) => ({ source: `file:${dir}/${name}`, text: fs.readFileSync(path.join(root, dir, name), "utf8") }))
  );
}

/** S2, in the verifier's own order: defect by defect, flow by flow. */
export function oracleCandidates(): Candidate[] {
  const constraints = resolveConstraints({ seed: ORACLE_CAMPAIGN_SEED, recorderFidelity: true, minNodesPerFlow: 6, maxNodesPerFlow: 16 });
  const corpus: FlowProfile[] = [];
  for (const pattern of ALL_FLOW_PATTERNS) {
    for (let index = 0; index < 6; index += 1) {
      corpus.push(
        generateFlow({
          flowId: `oracle-${pattern}-${index}`,
          flowName: `Oracle ${pattern} ${index}`,
          rng: new SeededRandom(`${ORACLE_CAMPAIGN_SEED}::${pattern}-${index}`),
          constraints,
          referenceableFlowIds: corpus.map((profile) => profile.id).slice(0, 3),
          pattern
        }).profile
      );
    }
  }
  const candidates: Candidate[] = [];
  for (const kind of ALL_MUTATION_KINDS) {
    for (const profile of corpus) {
      const mutated = applyMutation(profile, kind, new SeededRandom(`${ORACLE_CAMPAIGN_SEED}::mut::${kind}::${profile.id}`));
      if (mutated) candidates.push({ source: `oracle:${profile.id}:${kind}`, text: `${JSON.stringify(mutated.profile, null, 2)}\n` });
    }
  }
  return candidates;
}

/** The Issues texts L4b's development sent a real model (E2). */
export function developmentRequestKeys(): Set<string> {
  const requests = [
    ...LABELLED_SET.map((c) => heldOutRequest(c.flow)),
    heldOutRequest(L18_EXPLANATION_FLOW),
    // The L1.8 packet validates with no library at all; keep both readings.
    buildAuthoringRequest(validateFlowDefinition(L18_EXPLANATION_FLOW))
  ];
  return new Set(requests.flatMap((request) => (request ? [sha256(issuesText(request))] : [])));
}

/** E1 to E3 over `candidates`, in their order. */
export function buildEligibility(candidates: readonly Candidate[]): EligibilityInventory {
  const development = developmentRequestKeys();
  const entries: EligibilityEntry[] = candidates.map(({ source, text }) => {
    const checked = checkHeldOutFlow(source, text);
    const heldOutCase = checked.heldOutCase;
    const request = checked.flow && heldOutCase ? heldOutRequest(checked.flow) : undefined;
    const requestSha256 = request ? sha256(issuesText(request)) : null;
    const base = { source, sha256: heldOutCase?.sha256 ?? null, sent: heldOutCase?.sent ?? [], truncated: heldOutCase?.truncated ?? 0, requestSha256 };
    if (checked.problems.length > 0 || !heldOutCase) return { ...base, eligible: false, excluded: `E1: ${checked.problems.join("; ") || "no case"}` };
    if (requestSha256 !== null && development.has(requestSha256)) return { ...base, eligible: false, excluded: "E2: the same request as one L4b's development sent a model" };
    return { ...base, eligible: true };
  });
  // E3: one candidate per distinct request, the smallest content hash.
  const keep = new Map<string, EligibilityEntry>();
  for (const entry of entries.filter((e) => e.eligible)) {
    const held = keep.get(entry.requestSha256!);
    if (!held || byCodeUnits(entry.sha256!, held.sha256!) < 0) keep.set(entry.requestSha256!, entry);
  }
  for (const entry of entries) {
    if (!entry.eligible) continue;
    const kept = keep.get(entry.requestSha256!)!;
    if (kept === entry) continue;
    entry.eligible = false;
    entry.excluded = `E3: the same request as ${kept.source}`;
  }
  const eligible = entries.filter((e) => e.eligible);
  return { version: 1, rules: SELECTION_RULES, candidates: entries.length, eligible: eligible.length, issuesEligible: eligible.reduce((n, e) => n + e.sent.length, 0), entries };
}

/** The seed: the committed inventory's content, never its layout. */
export const selectionSeed = (inventory: EligibilityInventory) => sha256(JSON.stringify(inventory));

/** The shortest prefix, in seeded order, that sends at least `DX_RULES.minHeldOutIssues` issues. */
export function selectHeldOut(inventory: EligibilityInventory): EligibilityEntry[] {
  const seed = selectionSeed(inventory);
  const ordered = inventory.entries
    .filter((e) => e.eligible)
    .map((entry) => ({ entry, key: sha256(`${seed}\n${entry.sha256}`) }))
    .sort((a, b) => byCodeUnits(a.key, b.key))
    .map((x) => x.entry);
  const chosen: EligibilityEntry[] = [];
  let issues = 0;
  for (const entry of ordered) {
    if (issues >= DX_RULES.minHeldOutIssues) break;
    chosen.push(entry);
    issues += entry.sent.length;
  }
  if (issues < DX_RULES.minHeldOutIssues) throw new Error(`the eligible candidates send ${issues} issue(s); the held-out set needs at least ${DX_RULES.minHeldOutIssues}`);
  return chosen;
}

/** The file a selected candidate is written to in `flows/`: its source, never anything the model is sent. */
export const heldOutFileName = (source: string) => `${source.replace(/^file:.*\//, "").replace(/\.json$/i, "").replace(/[^A-Za-z0-9-]+/g, "-")}.json`;
