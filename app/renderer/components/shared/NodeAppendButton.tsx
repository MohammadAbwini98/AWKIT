import { Plus } from "lucide-react";

interface NodeAppendButtonProps {
  nodeId: string;
  onAppend?: (nodeId: string, anchor: HTMLElement) => void;
}

export function NodeAppendButton({ nodeId, onAppend }: NodeAppendButtonProps) {
  if (!onAppend) return null;
  return (
    <div className="node-append-affordance nodrag nopan">
      <span aria-hidden="true" />
      <button
        type="button"
        aria-label="Add next item"
        title="Add next item"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onAppend(nodeId, event.currentTarget);
        }}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
