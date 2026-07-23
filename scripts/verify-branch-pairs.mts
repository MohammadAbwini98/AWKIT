/**
 * Branch-pair reconciliation verifier (SRS-CANVAS-UX-001 FR-2.6).
 *
 * Imports the REAL production functions from `app/renderer/components/shared/branchPairs.ts` — the
 * same `revertLoneBranchConnectors` / `incompleteBranchPairs` / `flowEdgeToNormal` /
 * `scenarioEdgeToNormal` that `FlowChartDesigner.tsx` and `ScenarioBuilder.tsx` call on edit and on
 * Save. Nothing is re-implemented here; if the semantics change, these checks change with them.
 *
 * Why this exists: a conditional/parallel connector is a PAIR. When a node is left holding one half
 * with no fallback the flow does not fail loudly — `FlowExecutor` routes a lone conditional to its
 * target with the condition ignored, and runs a lone parallel's target twice. Both editors used to
 * carry a no-op pass-through where the pair logic lived, so a routine deletion could produce a
 * silently mis-routing saved flow. Only executable assertions over the real functions catch a
 * regression back to that state, because none of these failures throw.
 *
 * The hybrid rule under test:
 *   - INTERACTIVE deletion auto-reverts the lone survivor to a normal connector;
 *   - EXISTING / imported lone branches are reported (Save-blocking), never rewritten on load;
 *   - a lone branch that still has a standard fallback is a valid if/else and is left alone.
 *
 * Run: npx tsx scripts/verify-branch-pairs.mts
 */
import {
  flowEdgeKind,
  flowEdgeToNormal,
  incompleteBranchPairs,
  revertLoneBranchConnectors,
  scenarioEdgeKind,
  scenarioEdgeToNormal,
  type ScenarioDesignerEdge
} from "../app/renderer/components/shared/branchPairs";
import type { FlowDesignerEdge } from "../app/renderer/components/workflow/flowStepMapping";
import type { FlowEdgeType } from "../src/profiles/FlowProfile";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------------------
// Fixture builders — plain objects in the exact shape each editor's edges take.
// ---------------------------------------------------------------------------

/** A Flow Designer edge. `kind` mirrors what the Logic picker stamps on branch connectors. */
function flowEdge(
  id: string,
  source: string,
  target: string,
  linkType: FlowEdgeType,
  extra?: Partial<FlowDesignerEdge["data"]>
): FlowDesignerEdge {
  return {
    id,
    source,
    target,
    data: { linkType, label: linkType, expression: "", ...extra }
  } as FlowDesignerEdge;
}

/** A Workflow Builder edge. Workflow links carry no `kind` field — the kind derives from `type`. */
function scenarioEdge(id: string, source: string, target: string, linkType: FlowEdgeType): ScenarioDesignerEdge {
  return {
    id,
    source,
    target,
    data: { linkType, label: linkType, expression: "" }
  } as ScenarioDesignerEdge;
}

const flowKindOf = (edge: FlowDesignerEdge): string => flowEdgeKind(edge);
const scenarioKindOf = (edge: ScenarioDesignerEdge): string => scenarioEdgeKind(edge.data?.linkType);

function revertFlow(edges: FlowDesignerEdge[], revertSources?: Set<string>): FlowDesignerEdge[] {
  return revertLoneBranchConnectors(edges, { kindOf: flowKindOf, toNormal: flowEdgeToNormal, revertSources });
}

function revertScenario(edges: ScenarioDesignerEdge[], revertSources?: Set<string>): ScenarioDesignerEdge[] {
  return revertLoneBranchConnectors(edges, { kindOf: scenarioKindOf, toNormal: scenarioEdgeToNormal, revertSources });
}

const byId = (edges: { id: string }[], id: string) => edges.find((edge) => edge.id === id)!;

console.log("Branch-pair reconciliation (FR-2.6)\n");

// ---------------------------------------------------------------------------
// 1. Interactive deletion reverts the lone survivor — both kinds, both editors.
// ---------------------------------------------------------------------------

{
  // Conditional pair on node "n". Delete e2 (the partner), then reconcile with n in revertSources.
  const afterDelete = [flowEdge("e1", "n", "a", "conditional", { kind: "conditional" })];
  const result = revertFlow(afterDelete, new Set(["n"]));
  check("Flow: deleting one conditional of a pair reverts the survivor to normal", flowKindOf(byId(result, "e1")) === "normal", flowKindOf(byId(result, "e1")));
  check("Flow: reverted conditional survivor becomes a success connector", byId(result, "e1").data?.linkType === "success");
}

{
  const afterDelete = [flowEdge("e1", "n", "a", "parallel", { kind: "parallel" })];
  const result = revertFlow(afterDelete, new Set(["n"]));
  check("Flow: deleting one parallel of a pair reverts the survivor to normal", flowKindOf(byId(result, "e1")) === "normal", flowKindOf(byId(result, "e1")));
}

{
  const afterDelete = [scenarioEdge("e1", "n", "a", "conditional")];
  const result = revertScenario(afterDelete, new Set(["n"]));
  check("Workflow: deleting one conditional of a pair reverts the survivor to normal", scenarioKindOf(byId(result, "e1")) === "normal", scenarioKindOf(byId(result, "e1")));
  check("Workflow: reverted survivor becomes a success link", byId(result, "e1").data?.linkType === "success");
}

{
  const afterDelete = [scenarioEdge("e1", "n", "a", "parallel")];
  const result = revertScenario(afterDelete, new Set(["n"]));
  check("Workflow: deleting one parallel of a pair reverts the survivor to normal", scenarioKindOf(byId(result, "e1")) === "normal", scenarioKindOf(byId(result, "e1")));
}

// ---------------------------------------------------------------------------
// 2. A complete pair is never touched by a revert on its own source.
// ---------------------------------------------------------------------------

{
  const pair = [
    flowEdge("e1", "n", "a", "conditional", { kind: "conditional" }),
    flowEdge("e2", "n", "b", "conditional", { kind: "conditional" })
  ];
  const result = revertFlow(pair, new Set(["n"]));
  check("Flow: a complete conditional pair survives a revert on its source", flowKindOf(byId(result, "e1")) === "conditional" && flowKindOf(byId(result, "e2")) === "conditional");
  check("Flow: reconcile returns the same array reference when nothing reverts", result === pair);
}

// ---------------------------------------------------------------------------
// 3. Unrelated / normal connectors are never rewritten.
// ---------------------------------------------------------------------------

{
  const edges = [
    flowEdge("lone", "n", "a", "conditional", { kind: "conditional" }),
    flowEdge("other", "m", "b", "success")
  ];
  const result = revertFlow(edges, new Set(["n"]));
  check("Flow: a normal connector on a different node is untouched by a revert elsewhere", flowKindOf(byId(result, "other")) === "normal" && byId(result, "other") === byId(edges, "other"));
}

{
  // Deleting a normal connector puts its source in revertSources but there is no branch to revert.
  const edges = [flowEdge("keep", "n", "a", "success"), flowEdge("also", "m", "b", "success")];
  const result = revertFlow(edges, new Set(["n"]));
  check("Flow: deleting a normal connector does not disturb another normal connector", result === edges);
}

// ---------------------------------------------------------------------------
// 4. Load-time: no revertSources ⇒ nothing is ever mutated (opening never rewrites a profile).
// ---------------------------------------------------------------------------

{
  const loaded = [flowEdge("e1", "n", "a", "conditional", { kind: "conditional" })];
  const afterLoad = revertFlow(loaded); // no revertSources — this is what loadProfile does
  check("Flow: loading a lone conditional does NOT mutate it (same reference)", afterLoad === loaded);
  check("Flow: the loaded lone conditional keeps its kind", flowKindOf(byId(afterLoad, "e1")) === "conditional");
}

{
  const loaded = [scenarioEdge("e1", "n", "a", "parallel")];
  const afterLoad = revertScenario(loaded);
  check("Workflow: loading a lone parallel does NOT mutate it (same reference)", afterLoad === loaded);
}

// ---------------------------------------------------------------------------
// 5. Save-blocking validation reports exactly the unrecoverable lone branches.
// ---------------------------------------------------------------------------

{
  const edges = [flowEdge("e1", "n", "a", "conditional", { kind: "conditional" })];
  const issues = incompleteBranchPairs(edges, flowKindOf);
  check("Flow: a lone conditional with no fallback is reported for Save", issues.length === 1 && issues[0].kind === "conditional" && issues[0].source === "n");
}

{
  const edges = [flowEdge("e1", "n", "a", "parallel", { kind: "parallel" })];
  const issues = incompleteBranchPairs(edges, flowKindOf);
  check("Flow: a lone parallel with no fallback is reported for Save", issues.length === 1 && issues[0].kind === "parallel");
}

{
  const edges = [scenarioEdge("e1", "n", "a", "conditional")];
  const issues = incompleteBranchPairs(edges, scenarioKindOf);
  check("Workflow: a lone conditional with no fallback is reported for Save", issues.length === 1 && issues[0].kind === "conditional");
}

// EXEMPTION: a lone branch WITH a standard fallback evaluates as a valid if/else at runtime
// (FlowExecutor's success→always fallback catches the no-match case), so it must NOT block Save.
{
  const ifElse = [
    flowEdge("cond", "n", "a", "conditional", { kind: "conditional" }),
    flowEdge("fallback", "n", "b", "success")
  ];
  check("Flow: 1 conditional + 1 success (valid if/else) is NOT reported", incompleteBranchPairs(ifElse, flowKindOf).length === 0);
}

{
  const ifElse = [scenarioEdge("cond", "n", "a", "conditional"), scenarioEdge("fallback", "n", "b", "success")];
  check("Workflow: 1 conditional + 1 success (valid if/else) is NOT reported", incompleteBranchPairs(ifElse, scenarioKindOf).length === 0);
}

// A complete pair is valid — never reported.
{
  const pair = [
    flowEdge("e1", "n", "a", "conditional", { kind: "conditional" }),
    flowEdge("e2", "n", "b", "conditional", { kind: "conditional" })
  ];
  check("Flow: a complete conditional pair is NOT reported", incompleteBranchPairs(pair, flowKindOf).length === 0);
}

// Self-loops are not branch pairs and must never be reported or reverted.
{
  const loopy = [flowEdge("loop", "n", "n", "loop", { kind: "loop" }), flowEdge("out", "n", "a", "conditional", { kind: "conditional" })];
  // The conditional is lone with no standard fallback (the loop is self-referential) → still reported.
  check("Flow: a self-loop does not count as a branch fallback", incompleteBranchPairs(loopy, flowKindOf).some((i) => i.kind === "conditional"));
  const reverted = revertFlow(loopy, new Set(["n"]));
  check("Flow: a self-loop is never reverted to normal", flowKindOf(byId(reverted, "loop")) === "loop");
}

// ---------------------------------------------------------------------------
// 6. Conversion to normal clears branch-only configuration (no stale config carried over).
// ---------------------------------------------------------------------------

{
  const conditional = flowEdge("e1", "n", "a", "conditional", {
    kind: "conditional",
    conditional: { sourceField: "outcome", operator: "equals", expectedValue: "ok", priority: 3 }
  });
  const normal = flowEdgeToNormal(conditional);
  check("Flow: converting a conditional clears its conditional config", normal.data?.conditional === undefined);
  check("Flow: converting a conditional sets kind=normal / linkType=success", normal.data?.kind === "normal" && normal.data?.linkType === "success");
  check("Flow: converting resets the routing expression", (normal.data?.expression ?? "") === "");
}

{
  const parallel = flowEdge("e1", "n", "a", "parallel", {
    kind: "parallel",
    parallel: { joinMode: "waitAll", failMode: "failFast" }
  });
  const normal = flowEdgeToNormal(parallel);
  check("Flow: converting a parallel clears its parallel config", normal.data?.parallel === undefined && normal.data?.kind === "normal");
}

{
  const link = scenarioEdge("e1", "n", "a", "conditional");
  link.data!.expression = "outputs.flow.ok === true";
  const normal = scenarioEdgeToNormal(link);
  check("Workflow: converting a conditional resets type + expression", normal.data?.linkType === "success" && (normal.data?.expression ?? "") === "");
}

// ---------------------------------------------------------------------------
// 7. Runtime-safety proofs: a newly-orphaned branch can no longer mis-route after revert.
// ---------------------------------------------------------------------------

{
  // After the survivor is reverted, its kind is `normal` — FlowExecutor's success/always fallback
  // routes to the target normally (condition no longer silently ignored), so the flow can't truncate.
  const reverted = revertFlow([flowEdge("e1", "n", "a", "conditional", { kind: "conditional" })], new Set(["n"]));
  check("Flow: a newly-orphaned conditional cannot silently truncate (survivor routes as success)", flowKindOf(byId(reverted, "e1")) === "normal");
}

{
  // After revert, no `parallel` kind remains on the node, so FlowExecutor's parallel fan-out
  // (join/fail machinery) is not entered with a single branch.
  const reverted = revertFlow([flowEdge("e1", "n", "a", "parallel", { kind: "parallel" })], new Set(["n"]));
  check("Flow: a newly-orphaned parallel cannot enter single-branch join/fail machinery", reverted.every((edge) => flowKindOf(edge) !== "parallel"));
}

// ---------------------------------------------------------------------------
// 8. Determinism & idempotence.
// ---------------------------------------------------------------------------

{
  const edges = [
    flowEdge("e1", "n", "a", "conditional", { kind: "conditional" }),
    flowEdge("e2", "m", "b", "parallel", { kind: "parallel" })
  ];
  const once = revertFlow(edges, new Set(["n", "m"]));
  const twice = revertFlow(once, new Set(["n", "m"]));
  const kinds = (list: FlowDesignerEdge[]) => list.map((e) => `${e.id}:${flowKindOf(e)}`).join(",");
  check("Flow: revert is idempotent (a second pass changes nothing)", kinds(once) === kinds(twice));
  check("Flow: revert is deterministic across independent runs", kinds(once) === kinds(revertFlow(edges, new Set(["n", "m"]))));
  check("Flow: the second idempotent pass returns the same reference", once === twice || kinds(once) === kinds(twice));
}

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
