import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, GitBranch, Lock, MoreHorizontal, PlayCircle, Repeat, SlidersHorizontal, Trash2, Unlock } from "lucide-react";
import { nodeEnter, usePrefersReducedMotion } from "../../lib/motion";
import type { ScenarioFlowNodeData } from "./scenarioDesignerTypes";
import { NodeAppendButton } from "../shared/NodeAppendButton";
import { NodeOptionsMenu, type NodeMenuItem } from "../shared/NodeOptionsMenu";
import { bumpRenderProbe } from "../canvas/renderProbe";
import type { CanvasNodeProps } from "../canvas";

/**
 * Workflow Builder flow-node card — the Workflow-reference look, rendered on the
 * custom canvas engine (no React Flow). Loop create/remove and delete live in the
 * kebab menu; the page owns the actual edge/node mutation via the `data` callbacks.
 */
export function ScenarioFlowNode({ id, data, selected }: CanvasNodeProps<ScenarioFlowNodeData>) {
  bumpRenderProbe("card");
  const hasLoop = Boolean(data.hasLoop);
  const reducedMotion = usePrefersReducedMotion();
  const isStart = data.kind === "start";
  const isEnd = data.kind === "end";
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const menuItems: NodeMenuItem[] = [
    { id: "configure", label: "Configure", icon: SlidersHorizontal, onSelect: () => data.onConfigure?.(id) },
    ...(!isStart && !isEnd
      ? [
          { id: "loop", label: hasLoop ? "Remove loop" : "Add loop", icon: Repeat, onSelect: () => data.onToggleLoop?.(id) } as NodeMenuItem,
          { id: "delete", label: "Remove flow", icon: Trash2, tone: "danger", onSelect: () => data.onDeleteFlow?.(id) } as NodeMenuItem
        ]
      : [])
  ];

  return (
    <>
      <motion.article
        className={`scenario-flow-node ${selected ? "selected" : ""} ${data.mode} ${data.kind}`}
        variants={nodeEnter}
        initial={reducedMotion ? false : "hidden"}
        animate="visible"
        whileHover={reducedMotion ? undefined : { y: -1 }}
      >
        <div className="scenario-node-order">{isStart ? <PlayCircle size={16} /> : isEnd ? <CheckCircle2 size={16} /> : data.order}</div>
        <div className="scenario-node-copy">
          <strong>{data.name}</strong>
          <span>{data.description}</span>
        </div>
        {!isStart && !isEnd ? (
          <div className="scenario-node-meta">
            {data.required ? <Lock size={14} /> : <Unlock size={14} />}
            <GitBranch size={14} />
          </div>
        ) : null}
        {/* Kebab affordance: opens the per-node context menu (Configure / loop / remove). */}
        <button
          ref={menuButtonRef}
          className={`action-node-menu${menuOpen ? " open" : ""} nodrag`}
          type="button"
          title="Flow actions"
          aria-label="Flow actions"
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
      {data.isLeaf && !isEnd ? <NodeAppendButton nodeId={id} onAppend={data.onAppendFlow} /> : null}
    </>
  );
}
