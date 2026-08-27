import type { FlowStep } from "@src/profiles/FlowProfile";
import type { WorkflowFlowNode } from "@src/profiles/WorkflowProfile";

export type DesignerClipboardPayload =
  | { source: "flow"; step: FlowStep }
  | { source: "workflow"; node: WorkflowFlowNode };

let clipboard: DesignerClipboardPayload | null = null;

export function copyDesignerNode(payload: DesignerClipboardPayload): void {
  // Application-scoped clipboard avoids leaking configuration to the OS clipboard while still
  // supporting navigation between Flow and Workflow canvases during the app session.
  clipboard = structuredClone(payload);
}

export function readDesignerNode(): DesignerClipboardPayload | null {
  return clipboard ? structuredClone(clipboard) : null;
}

export function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}
