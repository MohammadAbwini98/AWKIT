import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { MoreHorizontal, Repeat, SlidersHorizontal, Trash2 } from "lucide-react";
import { nodeEnter, usePrefersReducedMotion } from "../../lib/motion";
import { getFlowNodeCatalogItem } from "./flowNodeCatalog";
import type { FlowDesignerNodeData } from "./flowDesignerTypes";
import { NodeAppendButton } from "../shared/NodeAppendButton";
import { NodeOptionsMenu, type NodeMenuItem } from "../shared/NodeOptionsMenu";
import { bumpRenderProbe } from "../canvas/renderProbe";
import type { CanvasNodeProps } from "../canvas";

/** A node can host a self-loop connector once it has both a target and a source port. */
function canHaveLoop(stepType: FlowDesignerNodeData["stepType"]): boolean {
  return stepType !== "start" && stepType !== "end";
}

/**
 * Flow Designer node card — the Workflow-reference look, rendered on the custom
 * canvas engine (no React Flow). Loop create/remove and delete live in the kebab
 * menu; the page owns the actual edge/node mutation via the `data` callbacks.
 */
export function ActionFlowNode({ id, data, selected }: CanvasNodeProps<FlowDesignerNodeData>) {
  bumpRenderProbe("card");
  const nodeData = data;
  const catalogItem = getFlowNodeCatalogItem(nodeData.stepType);
  const Icon = catalogItem.icon;
  const hasLoop = Boolean(nodeData.hasLoop);
  const reducedMotion = usePrefersReducedMotion();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const isStructural = nodeData.stepType === "start" || nodeData.stepType === "end";

  const menuItems: NodeMenuItem[] = [
    { id: "configure", label: "Configure", icon: SlidersHorizontal, onSelect: () => nodeData.onConfigure?.(id) },
    ...(canHaveLoop(nodeData.stepType)
      ? [{ id: "loop", label: hasLoop ? "Remove loop" : "Add loop", icon: Repeat, onSelect: () => nodeData.onToggleLoop?.(id) } as NodeMenuItem]
      : []),
    ...(isStructural ? [] : [{ id: "delete", label: "Delete node", icon: Trash2, tone: "danger", onSelect: () => nodeData.onDeleteNode?.(id) } as NodeMenuItem])
  ];

  return (
    <>
      <motion.article
        className={`action-flow-node ${selected ? "selected" : ""} ${nodeData.validationState}`}
        variants={nodeEnter}
        initial={reducedMotion ? false : "hidden"}
        animate="visible"
        whileHover={reducedMotion ? undefined : { y: -1 }}
      >
        <div className="action-node-icon" aria-hidden="true">
          <Icon size={18} />
        </div>
        <div className="action-node-content">
          <div className="action-node-meta">
            <span>{catalogItem.label}</span>
            <span className="action-node-index">{nodeData.stepType}</span>
          </div>
          <strong className="action-node-title">{nodeData.name}</strong>
          {nodeData.description ? <span className="action-node-description">{nodeData.description}</span> : null}
        </div>
        {/* Kebab affordance: opens the per-node context menu (Configure / loop / delete).
            Stops pointer/click so it never triggers node drag or canvas selection. */}
        <button
          ref={menuButtonRef}
          className={`action-node-menu${menuOpen ? " open" : ""} nodrag`}
          type="button"
          title="Node actions"
          aria-label="Node actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen((open) => !open);
          }}
        >
          <MoreHorizontal size={16} />
        </button>
      </motion.article>
      <NodeOptionsMenu open={menuOpen} anchor={menuButtonRef.current} items={menuItems} onClose={() => setMenuOpen(false)} />
      {nodeData.isLeaf && nodeData.stepType !== "end" ? <NodeAppendButton nodeId={id} onAppend={nodeData.onAppendNode} /> : null}
    </>
  );
}
