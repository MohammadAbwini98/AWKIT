# Phase 1 — Enhanced Flow Connector System

> **Target agent:** Claude Code
> **Project:** WebFlow Studio (`c:\Users\moham\OneDrive\Desktop\AWTKIT`)
> **Pre-requisite:** Read `AGENTS.md` → `docs/ai/CURRENT_STATE.md` → `docs/ai/ARCHITECTURE.md` → `docs/ai/RULES.md` before writing any code.
> **Phase:** 1 of 3 (Foundation — Phase 2 and 3 depend on this)

---

## Goal

Enhance the Flow Designer's connector (edge) system to support **smarter, multi-path routing** for all flow nodes. This is a **global infrastructure upgrade** that every node type benefits from.

### Current State (what exists today)

The connector system currently supports 6 edge types (`src/profiles/FlowProfile.ts` L165):
```typescript
export type FlowEdgeType = "success" | "failure" | "always" | "conditional" | "manualApproval" | "loop";
```

**Limitations:**
1. **Only ONE conditional edge fires** — `FlowExecutor.resolveNextStepId` (L141-143) iterates conditional edges but returns on the first match (no fan-out).
2. **Conditions can't access step results** — the evaluator only sees `outputs`, `runtimeInputs`, `instanceInputs`. A step's own status/result is not in scope.
3. **Cycle guard is absolute** — `FlowExecutor` L30-32: `visited.has(currentStep.id)` throws unconditionally. No way to do controlled loop-backs.
4. **No outcome-based routing** — nodes that could succeed or fail always route on the `success` edge. There's no connector that routes based on what the step *produced* (e.g., `sessionSkipped` vs `sessionCaptured`).
5. **`loop` edge type exists but is unused at the flow level** — it's only used in the Workflow Builder (ScenarioLink).
6. **`parallel` edge type doesn't exist** — no way to fan out from one node to multiple concurrent targets.

### What to build

| Feature | Description |
|---|---|
| **Multi-conditional connectors** | A node can have **multiple** conditional outgoing edges, each with its own expression. All matching conditions are evaluated in order; the **first match** wins (existing behavior) OR optionally **all matches** fan out in parallel (new). |
| **Outcome-based connectors** | A new edge type `"outcome"` that routes based on the step's own outputs. E.g., `${stepResult.sessionSkipped} === true` → go here, `${stepResult.sessionCaptured} === true` → go there. The step's outputs are injected into the expression scope. |
| **Loop-back connectors** | A new edge type `"loopBack"` that is allowed to target a previously-visited node. The `FlowExecutor` cycle guard is relaxed for this edge type with a configurable `maxLoopCount` (default: 2). |
| **Parallel connectors** | A new edge type `"parallel"` that fans out to multiple target nodes simultaneously. All parallel targets execute and converge (wait-all) before the flow continues. |

---

## Critical Files to Read First

| File | What to learn |
|---|---|
| `src/profiles/FlowProfile.ts` | `FlowEdgeType` union (L165), `FlowEdge` interface (L178-186), `NodeConfig` |
| `src/profiles/ScenarioProfile.ts` | `ScenarioLink.type` union (L13) — must stay in sync |
| `src/runner/FlowExecutor.ts` | `executeFlow` loop (L13-63), cycle guard (L30-32), `resolveNextStepId` (L120-145), `handleFailure` (L86-109) |
| `src/runner/ExpressionEvaluator.ts` | `evaluateBoolean` (L52-67), `ValueResolver` type, `resolveOperand` |
| `src/runner/PlaywrightRunner.ts` | `chooseNextFlow` (L136-155) — workflow-level routing uses the same edge types |
| `app/renderer/components/workflow/ConnectionPropertiesPanel.tsx` | `linkTypeOptions` array (L29-36), condition expression input (L71-80) |
| `app/renderer/components/shared/connectorStyle.ts` | `connectorTypeColor` (L9-16), `buildConnectorVisual` (L62-72) |
| `app/renderer/components/workflow/ActionFlowNode.tsx` | Source/target Handle positions (L34, L43) |
| `app/renderer/pages/FlowChartDesigner.tsx` | `createEdge` (L95-106), `onConnect` (L279-286), `updateEdgeData` (L296-314), `toFlowProfile` (L682-699) |
| `app/renderer/components/workflow/flowDesignerTypes.ts` | `FlowDesignerNodeData` — current shape |

---

## Implementation Steps

### Step 1: Extend Edge Types

#### `src/profiles/FlowProfile.ts`

Update `FlowEdgeType`:
```typescript
export type FlowEdgeType = "success" | "failure" | "always" | "conditional" | "outcome" | "manualApproval" | "loop" | "loopBack" | "parallel";
```

Update `FlowEdge` to support loop configuration:
```typescript
export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  type: FlowEdgeType;
  label?: string;
  condition?: { expression: string };
  style?: EdgeVisualStyle;
  /** For loopBack edges: maximum number of times this back-edge can be traversed before stopping. */
  maxLoopCount?: number;
}
```

#### `src/profiles/ScenarioProfile.ts`

Update `ScenarioLink.type` to stay in sync:
```typescript
type: "success" | "failure" | "always" | "conditional" | "outcome" | "manualApproval" | "loop" | "loopBack" | "parallel";
```

---

### Step 2: Add Colors for New Edge Types

#### `app/renderer/components/shared/connectorStyle.ts`

Add colors and update `buildConnectorVisual`:

```typescript
export const connectorTypeColor: Record<string, string> = {
  success: "#22a06b",
  failure: "#d64545",
  always: "#1769e0",
  conditional: "#d68a00",
  outcome: "#e07c17",     // Warm amber — distinct from conditional's yellow
  manualApproval: "#7c5cff",
  loop: "#0d9488",
  loopBack: "#06b6d4",    // Cyan — visually suggests "back/return"
  parallel: "#8b5cf6"     // Violet — suggests "fan out"
};
```

Update `buildConnectorVisual` to animate `loopBack` and `parallel` edges:
```typescript
animated: type === "loop" || type === "conditional" || type === "loopBack" || type === "parallel",
```

For `loopBack`, use dashed line by default to visually distinguish:
```typescript
const defaultDash = type === "loopBack" ? "6 4" : undefined;
// ...
strokeDasharray: dashArray(s.lineStyle) ?? defaultDash,
```

---

### Step 3: Update Connection Properties Panel

#### `app/renderer/components/workflow/ConnectionPropertiesPanel.tsx`

Add new edge type options:
```typescript
const linkTypeOptions: { value: FlowEdgeType; label: string }[] = [
  { value: "success", label: "Success" },
  { value: "failure", label: "Failure" },
  { value: "always", label: "Always" },
  { value: "conditional", label: "Conditional" },
  { value: "outcome", label: "Outcome-based" },
  { value: "manualApproval", label: "Manual approval" },
  { value: "loop", label: "Loop" },
  { value: "loopBack", label: "Loop Back" },
  { value: "parallel", label: "Parallel" }
];
```

Show the condition expression input for `outcome` edges too:
```typescript
{(edge.data?.linkType === "conditional" || edge.data?.linkType === "outcome") ? (
  <label>
    {edge.data?.linkType === "outcome" ? "Outcome Expression" : "Condition Expression"}
    <input
      value={edge.data?.expression ?? ""}
      placeholder={edge.data?.linkType === "outcome"
        ? "${stepResult.sessionCaptured} === true"
        : "${outputs.step.result} === 'ok'"
      }
      onChange={(event) => onUpdate(edge.id, { expression: event.target.value })}
    />
  </label>
) : null}
```

Add `maxLoopCount` input for `loopBack` edges:
```typescript
{edge.data?.linkType === "loopBack" ? (
  <label>
    Max Loop Count
    <input
      type="number"
      min={1}
      max={10}
      value={edge.data?.maxLoopCount ?? 2}
      onChange={(event) => onUpdate(edge.id, { maxLoopCount: parseInt(event.target.value) || 2 })}
    />
    <small>How many times this back-edge can be traversed before stopping.</small>
  </label>
) : null}
```

Update `FlowConnectionData` to include `maxLoopCount`:
```typescript
export type FlowConnectionData = {
  linkType: FlowEdgeType;
  label?: string;
  expression?: string;
  style?: EdgeVisualStyle;
  maxLoopCount?: number;
};
```

---

### Step 4: Update FlowChartDesigner Edge Serialization

#### `app/renderer/pages/FlowChartDesigner.tsx`

Update `toFlowProfile` to serialize `maxLoopCount`:
```typescript
edges: edges.map((edge) => ({
  id: edge.id,
  source: edge.source,
  target: edge.target,
  type: edge.data?.linkType ?? "success",
  label: edge.data?.label,
  condition: edge.data?.expression ? { expression: edge.data.expression } : undefined,
  style: hasCustomStyle(edge.data?.style) ? edge.data?.style : undefined,
  maxLoopCount: edge.data?.linkType === "loopBack" ? (edge.data?.maxLoopCount ?? 2) : undefined
}))
```

Update `createEdge` function signature and `loadProfile` → `createEdge` call to pass through `maxLoopCount`.

Update `updateEdgeData` to handle `maxLoopCount` in the patch.

---

### Step 5: FlowExecutor — Enhanced Routing Engine

This is the core runtime change. Modify `src/runner/FlowExecutor.ts`:

#### A) Cycle Guard — Allow Loop-Back Edges

Replace the absolute cycle guard with a loop-back-aware version:

```typescript
// Replace L25 and L29-33 with:
const visited = new Set<string>();
const loopBackCounts = new Map<string, number>(); // edgeId → times traversed

// In the while loop, replace the cycle check:
if (visited.has(currentStep.id)) {
  // Check if we arrived here via a loopBack edge
  const incomingLoopBacks = flow.edges.filter(
    (edge) => edge.type === "loopBack" && edge.target === currentStep.id
  );
  
  const allowedLoopBack = incomingLoopBacks.find((edge) => {
    const count = loopBackCounts.get(edge.id) ?? 0;
    const max = edge.maxLoopCount ?? 2;
    return count < max;
  });
  
  if (allowedLoopBack) {
    loopBackCounts.set(allowedLoopBack.id, (loopBackCounts.get(allowedLoopBack.id) ?? 0) + 1);
    visited.clear(); // Allow re-traversal of all nodes in this loop iteration
    this.log("info", context, `Loop-back via edge ${allowedLoopBack.id} (iteration ${loopBackCounts.get(allowedLoopBack.id)}/${allowedLoopBack.maxLoopCount ?? 2}).`);
  } else {
    throw new Error(`Flow ${flow.id} contains a runtime cycle at step ${currentStep.id}.`);
  }
}
visited.add(currentStep.id);
```

#### B) Outcome-Based Edge Routing

Update `resolveNextStepId` to handle `outcome` edges by injecting the step's own outputs into the expression scope:

```typescript
private resolveNextStepId(
  flow: FlowProfile,
  step: FlowStep,
  stepResult: StepExecutionResult,
  outputs: Record<string, unknown>,
  context: InstanceExecutionContext
): string | undefined {
  if (stepResult.nextStepId) return stepResult.nextStepId;

  const outgoing = flow.edges.filter((edge) => edge.source === step.id);
  if (!outgoing.length) return step.next;

  const getValue = this.makeScope(outputs, context);
  
  // Enhanced scope: inject the step's own result outputs as ${stepResult.xxx}
  const getValueWithStepResult = (path: string): unknown => {
    if (path.startsWith("stepResult.")) {
      const key = path.slice("stepResult.".length);
      return stepResult.outputs[key];
    }
    return getValue(path);
  };
  
  const pick = (type: FlowEdge["type"]) => outgoing.find((edge) => edge.type === type)?.target;

  // Condition node (existing behavior — unchanged)
  if (step.type === "condition") {
    const passed = evaluateBoolean(step.value ?? "", getValueWithStepResult);
    const target = passed
      ? pick("conditional") ?? pick("success") ?? pick("always")
      : pick("failure") ?? pick("always");
    return target ?? step.next;
  }

  // 1. Outcome edges (route by step's own output values)
  for (const edge of outgoing.filter((e) => e.type === "outcome")) {
    if (evaluateBoolean(edge.condition?.expression ?? "", getValueWithStepResult)) {
      return edge.target;
    }
  }
  
  // 2. Conditional edges (route by flow-level outputs)
  for (const edge of outgoing.filter((e) => e.type === "conditional")) {
    if (evaluateBoolean(edge.condition?.expression ?? "", getValueWithStepResult)) {
      return edge.target;
    }
  }
  
  // 3. Loop-back edges (treated as a fallback after outcome/conditional)
  const loopBack = outgoing.find((e) => e.type === "loopBack");
  if (loopBack) {
    // Loop-back only triggers if no other edge matched and the step explicitly 
    // produced an output that signals a restart (prevents unconditional loops)
    if (loopBack.condition?.expression) {
      if (evaluateBoolean(loopBack.condition.expression, getValueWithStepResult)) {
        return loopBack.target;
      }
    }
    // If loopBack has no condition, it fires as a last resort (below success/always)
  }
  
  // 4. Standard fallbacks: success → always → loopBack (unconditional) → next
  return pick("success") ?? pick("always") ?? (loopBack && !loopBack.condition?.expression ? loopBack.target : undefined) ?? step.next;
}
```

#### C) Parallel Edges (Foundation)

For Phase 1, implement parallel edges as **sequential fan-out** (execute all parallel targets one after another and collect results). True parallelism with concurrent execution can be a future enhancement.

When the routing engine encounters `parallel` edges, it should execute all parallel targets in sequence:

Add a new method to `FlowExecutor`:

```typescript
/**
 * Execute parallel edges sequentially (fan-out). Each parallel target runs
 * to completion; all outputs are merged. If any fail and the step has
 * stopParentOnChildFailure, the flow fails.
 */
private async executeParallelTargets(
  flow: FlowProfile,
  parallelEdges: FlowEdge[],
  outputs: Record<string, unknown>,
  context: InstanceExecutionContext,
  visited: Set<string>,
  byId: Map<string, FlowStep>
): Promise<{ success: boolean; nextStepAfterParallel?: string }> {
  const results: StepExecutionResult[] = [];
  
  for (const edge of parallelEdges) {
    const targetStep = byId.get(edge.target);
    if (!targetStep) continue;
    
    // Mark as visited (parallel targets are still subject to the cycle guard)
    if (visited.has(targetStep.id)) continue;
    visited.add(targetStep.id);
    
    const result = await this.executeWithRetry(targetStep);
    results.push(result);
    
    Object.entries(result.outputs).forEach(([key, value]) => {
      outputs[`${flow.id}.${key}`] = value;
    });
    
    if (result.status === "failed") {
      return { success: false };
    }
  }
  
  return { success: true };
}
```

Integrate this into the main `executeFlow` loop: after resolving the next step, check if there are `parallel` edges. If so, execute all parallel targets before proceeding to the resolved next step.

---

### Step 6: PlaywrightRunner — Sync Workflow-Level Routing

Update `PlaywrightRunner.chooseNextFlow` (L136-155) to handle the new edge types at the workflow (scenario) level:

```typescript
private chooseNextFlow(
  links: ScenarioLink[],
  outputs: Record<string, unknown>,
  context: InstanceExecutionContext
): string | undefined {
  const getValue = (path: string): unknown => {
    if (path.startsWith("outputs.")) return outputs[path.slice("outputs.".length)];
    if (path.startsWith("runtimeInputs.")) return context.runtimeInputs[path.slice("runtimeInputs.".length)];
    if (path.startsWith("instanceInputs.")) return context.instanceInputs[path.slice("instanceInputs.".length)];
    return outputs[path];
  };

  // Outcome edges first (most specific)
  for (const link of links.filter((l) => l.type === "outcome")) {
    if (evaluateBoolean(link.condition?.expression ?? "", getValue)) return link.targetFlowId;
  }
  // Then conditional
  for (const link of links.filter((l) => l.type === "conditional")) {
    if (evaluateBoolean(link.condition?.expression ?? "", getValue)) return link.targetFlowId;
  }
  const successOrLoop = links.find((l) => l.type === "success" || l.type === "loop" || l.type === "manualApproval");
  if (successOrLoop) return successOrLoop.targetFlowId;
  const always = links.find((l) => l.type === "always");
  return always?.targetFlowId;
}
```

---

### Step 7: Workflow Builder — Add New Edge Types to UI

Update the Scenario Builder's edge type dropdown (`app/renderer/pages/ScenarioBuilder.tsx`) to include the new types. Search for the `linkType` options array (around L895) and add:
```typescript
{ value: "outcome", label: "Outcome-based" },
{ value: "loopBack", label: "Loop Back" },
{ value: "parallel", label: "Parallel" },
```

---

### Step 8: Testing

#### Extend `scripts/verify-runner.mts`

Add test cases:

1. **Multi-conditional routing:** Flow with 3 conditional edges from one node, each with a different expression. Verify only the first matching one fires.

2. **Outcome-based routing:** Flow with an outcome edge checking `${stepResult.someOutput} === 'value'`. Verify it routes correctly based on what the step produced.

3. **Loop-back edge:** Flow: Start → A → B → (loopBack to A, maxLoopCount=2). B produces a counter output. Verify A executes 3 times total (1 initial + 2 loop-backs) without a cycle error.

4. **Loop-back exhaustion:** Same as above but with maxLoopCount=1. Verify A executes 2 times total.

5. **Parallel edges:** Flow with node A having 2 parallel edges to B and C, then a success edge to D. Verify B and C both execute.

6. **Existing regression:** All existing tests must still pass (the `success`, `failure`, `always`, `conditional` routing logic must be unchanged).

#### Run:
```bash
npm run build          # Must pass
npm run verify:runner  # Must pass with all new + existing tests
```

---

## Files That Will Be Modified

| File | Change |
|---|---|
| `src/profiles/FlowProfile.ts` | Add `outcome`, `loopBack`, `parallel` to `FlowEdgeType`; add `maxLoopCount` to `FlowEdge` |
| `src/profiles/ScenarioProfile.ts` | Sync `ScenarioLink.type` union |
| `src/runner/FlowExecutor.ts` | Loop-back cycle guard, outcome routing, parallel fan-out |
| `src/runner/ExpressionEvaluator.ts` | No changes needed (existing evaluator handles new expressions) |
| `src/runner/PlaywrightRunner.ts` | Update `chooseNextFlow` for outcome/parallel at workflow level |
| `app/renderer/components/shared/connectorStyle.ts` | Add colors + visual config for new types |
| `app/renderer/components/workflow/ConnectionPropertiesPanel.tsx` | Add edge type options, outcome expression input, maxLoopCount input |
| `app/renderer/pages/FlowChartDesigner.tsx` | Serialize/deserialize `maxLoopCount`, update `createEdge` |
| `app/renderer/pages/ScenarioBuilder.tsx` | Add new edge types to workflow connector dropdown |
| `scripts/verify-runner.mts` | Add test cases |
| `docs/ai/CURRENT_STATE.md` | Document enhanced connectors |
| `docs/ai/TASK_LOG.md` | Append task entry |
| `docs/ai/KNOWN_ISSUES.md` | Note parallel edges are sequential (not concurrent) in Phase 1 |

---

## Non-Negotiable Rules

- **Backward compatible:** All existing flows/edges must work identically. New edge types are additive.
- **Offline-first:** No CDN, no remote deps, no runtime internet.
- **No secrets in logs:** Expression results may contain sensitive data — never log resolved values.
- **Minimal diffs:** Don't refactor unrelated code. Match existing patterns exactly.
- **TypeScript clean:** `npm run build` must pass (`tsc --noEmit`).

## End-of-Task Checklist

1. `npm run build` passes
2. `npm run verify:runner` passes (all existing + new tests)
3. Update `docs/ai/CURRENT_STATE.md`
4. Append to `docs/ai/TASK_LOG.md`
5. Update `docs/ai/KNOWN_ISSUES.md` — note parallel connectors are sequential fan-out in Phase 1
6. List all files changed, tests run, tests not-run with reasons
