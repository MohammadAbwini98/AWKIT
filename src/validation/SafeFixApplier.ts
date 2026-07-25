/**
 * Suggested-fix applier (Tranche 2, Stage 2c) — the ONLY code that turns a `safeFix` description
 * into an actual change, and it still never touches the caller's object: it returns a new profile.
 *
 * Owner decision 2 (design doc): fixes are SUGGESTED, never automatic, and "safe" means schema
 * migration only — corrections that cannot alter execution logic. Concretely, everything this
 * module can do:
 *
 *  - `normalizeEnumCasing` — rewrite an enum literal that differs from a legal value only by
 *    casing/separators ("NotEquals" → "notEquals"). The author's intent is unambiguous; the
 *    broken literal can never match at run time, so normalizing cannot change a passing branch.
 *  - `regenerateId` — assign fresh ids to duplicate CONNECTOR ids. Nothing references an edge id,
 *    so regeneration cannot change routing. (Duplicate NODE ids deliberately carry no safeFix —
 *    connectors reference node ids, so which node an edge meant is unknowable.)
 *
 * Everything else on the never-list (add Start/End, delete nodes, reconnect, guess flow refs,
 * clamp loops, change timeouts, …) is structurally impossible here: the applier only acts on
 * `safeFix` metadata the engine emitted, and the engine emits none for those.
 *
 * The caller (main process) owns the ceremony around this pure function: change preview, untouched
 * backup, explicit confirmation, migration report, undo. See `flowValidationService.ts`.
 *
 * Framework-agnostic: no Electron, no React, no Node built-ins.
 */
import type { FlowEdge, FlowProfile } from "../profiles/FlowProfile";
import type { FlowValidationIssue, SafeFix } from "./FlowValidator";

export interface AppliedFix {
  readonly code: string;
  readonly kind: SafeFix["kind"];
  readonly edgeId?: string;
  readonly field: string;
  readonly from: string;
  readonly to: string;
  readonly description: string;
}

export interface SafeFixResult {
  /** A new profile with every applicable fix applied. The input is never mutated. */
  readonly profile: FlowProfile;
  readonly applied: readonly AppliedFix[];
  /** Fixes that could not be applied (anchor no longer present, unknown field path). */
  readonly skipped: readonly { issue: string; reason: string }[];
}

/** Deep clone via JSON — safe for profiles (proven lossless by the Phase 3 round-trip suite). */
function clone(profile: FlowProfile): FlowProfile {
  return JSON.parse(JSON.stringify(profile)) as FlowProfile;
}

/**
 * The exhaustive set of fields `normalizeEnumCasing` may rewrite. A switch, not a generic path
 * walker: an applier that can write arbitrary dotted paths is exactly the kind of "flexible"
 * machinery that ends up altering something the safety analysis never considered.
 */
function setEnumField(edge: FlowEdge, field: string, value: string): boolean {
  switch (field) {
    case "conditional.operator":
      if (!edge.conditional) return false;
      (edge.conditional as { operator: string }).operator = value;
      return true;
    case "conditional.sourceField":
      if (!edge.conditional) return false;
      (edge.conditional as { sourceField: string }).sourceField = value;
      return true;
    case "loop.condition.operator":
      if (!edge.loop?.condition) return false;
      (edge.loop.condition as { operator: string }).operator = value;
      return true;
    case "loop.condition.sourceField":
      if (!edge.loop?.condition) return false;
      (edge.loop.condition as { sourceField: string }).sourceField = value;
      return true;
    case "loop.mode":
      if (!edge.loop) return false;
      (edge.loop as { mode: string }).mode = value;
      return true;
    case "parallel.joinMode":
      if (!edge.parallel) return false;
      (edge.parallel as { joinMode: string }).joinMode = value;
      return true;
    case "parallel.failMode":
      if (!edge.parallel) return false;
      (edge.parallel as { failMode: string }).failMode = value;
      return true;
    case "parallel.isolation":
      if (!edge.parallel) return false;
      (edge.parallel as { isolation: string }).isolation = value;
      return true;
    default:
      return false;
  }
}

/**
 * Apply every applicable safe fix from a validation report to a copy of the profile.
 *
 * Deterministic: the same profile + report always produce the same output. Fixes whose anchor has
 * disappeared (stale report) are skipped and reported, never guessed.
 */
export function applySafeFixes(profile: FlowProfile, issues: readonly FlowValidationIssue[]): SafeFixResult {
  const next = clone(profile);
  const applied: AppliedFix[] = [];
  const skipped: { issue: string; reason: string }[] = [];
  const usedEdgeIds = new Set((next.edges ?? []).map((edge) => edge.id));

  for (const issue of issues) {
    const fix = issue.safeFix;
    if (!fix) continue;

    if (fix.kind === "normalizeEnumCasing") {
      const edge = (next.edges ?? []).find((candidate) => candidate.id === issue.edgeId);
      if (!edge) {
        skipped.push({ issue: `${issue.code}@${issue.edgeId ?? "?"}`, reason: "connector no longer exists" });
        continue;
      }
      if (!setEnumField(edge, fix.field, fix.to)) {
        skipped.push({ issue: `${issue.code}@${edge.id}`, reason: `unknown or absent field "${fix.field}"` });
        continue;
      }
      applied.push({ code: issue.code, kind: fix.kind, edgeId: edge.id, field: fix.field, from: fix.from, to: fix.to, description: fix.description });
      continue;
    }

    if (fix.kind === "regenerateId") {
      // Duplicate connector ids: keep the FIRST occurrence, regenerate every later one. Edge ids
      // are referenced by nothing, so this cannot change routing.
      const duplicates = (next.edges ?? []).filter((candidate) => candidate.id === fix.from);
      if (duplicates.length < 2) {
        skipped.push({ issue: `${issue.code}@${fix.from}`, reason: "no duplicate connectors remain" });
        continue;
      }
      duplicates.slice(1).forEach((edge, index) => {
        let candidate = index === 0 ? fix.to : `${fix.to}-${index + 1}`;
        while (usedEdgeIds.has(candidate)) candidate = `${candidate}x`;
        usedEdgeIds.add(candidate);
        const from = edge.id;
        edge.id = candidate;
        applied.push({
          code: issue.code,
          kind: fix.kind,
          edgeId: candidate,
          field: "id",
          from,
          to: candidate,
          description: fix.description
        });
      });
      continue;
    }

    skipped.push({ issue: issue.code, reason: `unknown fix kind "${(fix as { kind: string }).kind}"` });
  }

  return { profile: next, applied, skipped };
}

/** The safe fixes a report offers, for preview UIs. */
export function availableSafeFixes(issues: readonly FlowValidationIssue[]): readonly FlowValidationIssue[] {
  return issues.filter((issue) => issue.safeFix !== undefined);
}
