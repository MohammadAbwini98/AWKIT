import { Handle, Position } from "@xyflow/react";
import type { ConnectorPortFlags } from "./connectorStyle";
import { branchSourceHandle, portPositions } from "./connectorStyle";

/**
 * Connector ports for a flow/scenario node.
 *
 * Source (right) side: a single centered `normal-out` port by default. Once a conditional or
 * parallel connector leaves the node (`flags.sourceKind`), the node switches to a **branch
 * pair** — exactly two same-kind ports (`<kind>-out-0`, `<kind>-out-1`), evenly centered — so
 * each of the two branch connectors aligns to its own port.
 *
 * Target (left) side: a centered `normal-in` port, plus a distinct `conditional-in`/`parallel-in`
 * port when a branch connector of that kind arrives.
 *
 * IMPORTANT: these `<Handle>`s must be rendered as *siblings* of the node's `<article>` card
 * (not children), so React Flow positions them against the un-clipped `.react-flow__node`
 * wrapper (the card has `overflow: hidden`, which would otherwise clip the edge-hugging handles).
 */

interface ConnectorPortsProps {
  flags?: ConnectorPortFlags;
}

export function ConnectorTargetPorts({ flags }: ConnectorPortsProps) {
  const kinds: Array<"normal" | "conditional" | "parallel"> = ["normal"];
  if (flags?.conditionalIn) kinds.push("conditional");
  if (flags?.parallelIn) kinds.push("parallel");
  const positions = portPositions(kinds.length);
  return (
    <>
      {kinds.map((kind, index) => (
        <Handle
          key={kind}
          className={`react-flow-handle connector-port connector-port-${kind}`}
          id={`${kind}-in`}
          position={Position.Left}
          style={{ top: `${positions[index]}%` }}
          type="target"
        />
      ))}
    </>
  );
}

export function ConnectorSourcePorts({ flags }: ConnectorPortsProps) {
  // Branch pair: exactly two same-kind ports so each conditional/parallel connector aligns.
  if (flags?.sourceKind === "conditional" || flags?.sourceKind === "parallel") {
    const kind = flags.sourceKind;
    const positions = portPositions(2);
    return (
      <>
        {[0, 1].map((slot) => (
          <Handle
            key={slot}
            className={`react-flow-handle connector-port connector-port-${kind}`}
            id={branchSourceHandle(kind, slot)}
            position={Position.Right}
            style={{ top: `${positions[slot]}%` }}
            type="source"
          />
        ))}
      </>
    );
  }
  // Default: a single centered normal source port.
  return <Handle className="react-flow-handle connector-port connector-port-normal" id="normal-out" position={Position.Right} style={{ top: "50%" }} type="source" />;
}

/**
 * Dedicated self-loop port (top edge). A `loop`-kind connector returns a node to itself, so it
 * gets its own source/target handle pair on the top, letting `SelfLoopEdge` draw a semicircle
 * above the node. Always rendered (so the loop edge attaches immediately when the loop button
 * creates it) but invisible/non-interactive until a loop connector exists (`flags.loop`).
 */
export function ConnectorLoopPort({ flags }: ConnectorPortsProps) {
  const active = flags?.loop ? " active" : "";
  return (
    <>
      <Handle className={`react-flow-handle connector-port connector-port-loop${active}`} id="loop-out" position={Position.Top} style={{ left: "44%" }} type="source" />
      <Handle className={`react-flow-handle connector-port connector-port-loop${active}`} id="loop-in" position={Position.Top} style={{ left: "56%" }} type="target" />
    </>
  );
}
