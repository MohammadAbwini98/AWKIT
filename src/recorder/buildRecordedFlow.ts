import { randomUUID } from "node:crypto";
import type { FlowProfile, FlowStep } from "../profiles/FlowProfile";
import type { RecordedAction } from "./RecorderTypes";

/**
 * Build a saveable {@link FlowProfile} from a recorded session's actions. Pure (no I/O) so it can be
 * unit-tested and reused by the recorder IPC handler.
 *
 * Guarantees (recorder Points 1 & 2):
 *  - the flow always contains a default Start node and End node, with the recorded action nodes
 *    inserted between them (Start → action… → End; Start → End when there are no actions);
 *  - recorded think-time (`wait` actions) becomes a fixed-time wait step (`config.waitType: "time"`,
 *    duration in `timeoutMs`) so it replays during execution;
 *  - recorded tab switches (`routeChange`) replay as a Route Change targeting the newest tab.
 */
export function buildRecordedFlow(name: string, actions: RecordedAction[]): FlowProfile {
  // Guard against any Start/End sneaking in from the recording so we never duplicate them.
  const actionSteps = actions.filter((action) => action.type !== "start" && action.type !== "end");

  let currentY = 100;
  const startStep: FlowStep = { id: "start", type: "start", name: "Start", position: { x: 300, y: currentY } };

  const steps: FlowStep[] = actionSteps.map((action, index) => {
    currentY += 120;
    const step: FlowStep = {
      id: `step-${index + 1}`,
      type: action.type as FlowStep["type"],
      name: action.name,
      position: { x: 300, y: currentY }
    };

    if (action.locator) {
      step.locator = {
        strategy: action.locator.strategy as NonNullable<FlowStep["locator"]>["strategy"],
        value: action.locator.value
      };
      if (action.locator.name) step.locator.name = action.locator.name;
      if (action.locator.exact) step.locator.exact = true;
      if (action.locator.quality) step.locator.quality = action.locator.quality;
      if (action.locator.alternatives && action.locator.alternatives.length > 0) {
        step.locator.alternatives = action.locator.alternatives;
      }
      if (action.locator.context) step.locator.context = action.locator.context;
    }

    if (action.valueSource) {
      step.valueSource = {
        type: action.valueSource.type as NonNullable<FlowStep["valueSource"]>["type"],
        value: action.valueSource.value
      };
    }

    // Smart Wait conditions observed during recording (Phase 2).
    if (action.beforeWaits && action.beforeWaits.length > 0) step.beforeWaits = action.beforeWaits;
    if (action.afterWaits && action.afterWaits.length > 0) step.afterWaits = action.afterWaits;

    // Recorded think-time replays as a fixed-time wait step (Point 1).
    if (action.type === "wait") {
      step.timeoutMs = Math.max(0, Math.round(action.waitMs ?? 0));
      step.config = { waitType: "time" };
    }

    // Recorded tab switches replay as a Route Change that targets the newest tab.
    if (action.type === "routeChange") {
      step.value = action.valueSource?.value;
      step.config = { routeMode: "switchToLatestTab", urlMatch: "contains", routeWaitUntil: "load" };
    }

    return step;
  });

  currentY += 120;
  const endStep: FlowStep = { id: "end", type: "end", name: "End", position: { x: 300, y: currentY } };

  const nodes: FlowStep[] = [startStep, ...steps, endStep];

  const flowProfile: FlowProfile = {
    id: `flow-${randomUUID().slice(0, 8)}`,
    name: name || "Recorded Flow",
    description: "Auto-generated from recorder",
    version: 1,
    nodes,
    edges: []
  };

  // Connect Start → action(s) → End sequentially. With no actions the flow is still Start → End.
  const sequence = nodes.map((node) => node.id);
  for (let i = 0; i < sequence.length - 1; i++) {
    flowProfile.edges.push({
      id: `conn-${i + 1}`,
      source: sequence[i],
      target: sequence[i + 1],
      // The edge out of Start is unconditional; action edges carry the step's success outcome.
      type: sequence[i] === "start" ? "always" : "success"
    });
  }

  return flowProfile;
}
