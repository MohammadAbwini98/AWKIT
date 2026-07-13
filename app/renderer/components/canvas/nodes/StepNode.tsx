import { memo } from "react";
import { MoreHorizontal, Plus, Zap, type LucideIcon } from "lucide-react";
import { bumpRenderProbe } from "../renderProbe";
import type { CanvasNodeProps } from "../types";

/**
 * Workflow-reference node card: rounded card with an icon tile on the left,
 * a muted label + optional badge, and a bold title. A kebab (options) button and
 * a leaf "append" affordance appear when their callbacks are supplied. Recreated
 * with plain CSS (AWTKIT has no Tailwind) against the --awkit-* design tokens.
 */
export interface StepNodeData {
  icon?: LucideIcon;
  label?: string;
  title: string;
  badge?: string | number;
  kind?: "trigger" | "action" | "condition" | "delay" | "loop" | "start" | "end";
  /** "muted" softens the accent (used for optional flows in the overview). */
  accent?: "default" | "muted";
  isLeaf?: boolean;
  onMenu?: (id: string, event: React.MouseEvent) => void;
  onAppend?: (id: string, event: React.MouseEvent) => void;
}

function StepNodeComponent({ id, data, selected }: CanvasNodeProps<StepNodeData>) {
  bumpRenderProbe("card");
  const Icon = data.icon ?? Zap;
  const isTrigger = data.kind === "trigger" || data.kind === "start";

  return (
    <div
      className={[
        "awkit-step-node",
        selected ? "is-selected" : "",
        data.accent === "muted" ? "is-muted" : "",
        data.kind ? `kind-${data.kind}` : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="awkit-step-node-body">
        <div className="awkit-step-node-icon">
          <Icon size={20} />
        </div>

        <div className="awkit-step-node-text">
          <div className="awkit-step-node-meta">
            {data.label ? <span className="awkit-step-node-label">{data.label}</span> : null}
            {data.badge != null ? <span className="awkit-step-node-badge">{data.badge}</span> : null}
          </div>
          <p className="awkit-step-node-title">{data.title}</p>
        </div>

        {data.onMenu ? (
          <button
            type="button"
            className="awkit-step-node-menu nodrag"
            aria-label={`Options for ${data.title}`}
            onClick={(event) => {
              event.stopPropagation();
              data.onMenu?.(id, event);
            }}
          >
            <MoreHorizontal size={18} strokeWidth={2} />
          </button>
        ) : null}
      </div>

      {isTrigger ? (
        <span className="awkit-step-node-trigger">
          <Zap size={10} fill="currentColor" />
          Trigger
        </span>
      ) : null}

      {data.isLeaf && data.onAppend ? (
        <button
          type="button"
          className="awkit-step-node-append nodrag"
          aria-label="Append step"
          onClick={(event) => {
            event.stopPropagation();
            data.onAppend?.(id, event);
          }}
        >
          <Plus size={14} strokeWidth={2.5} />
        </button>
      ) : null}
    </div>
  );
}

export const StepNode = memo(StepNodeComponent) as typeof StepNodeComponent;
