/** In-process contract coverage for the bounded history shared by both canvas editors. */
import { BoundedEditorHistory, EDITOR_HISTORY_LIMIT } from "../app/renderer/lib/editorHistory";

type State = { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>>; name: string };
const same = (left: State, right: State) => JSON.stringify(left) === JSON.stringify(right);
const state = (name: string, nodes: Array<Record<string, unknown>> = [], edges: Array<Record<string, unknown>> = []): State => ({ name, nodes, edges });
let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) { passed += 1; console.log(`  PASS ${label}`); }
  else { failed += 1; console.error(`  FAIL ${label}${detail ? ` â€” ${detail}` : ""}`); }
}

console.log("Shared editor history contract");
const saved = state("Saved", [{ id: "start" }, { id: "end" }], [{ id: "e", source: "start", target: "end" }]);
const history = new BoundedEditorHistory(saved, same);
check("Undo and Redo begin disabled", !history.canUndo && !history.canRedo);

const added = state("Saved", [...saved.nodes, { id: "click", unknownFutureField: { preserved: true } }], saved.edges);
history.record(added);
check("add is undoable", history.canUndo && same(history.undo()!, saved));
const redoneAdd = history.redo()!;
check("add is redoable", same(redoneAdd, added));
check("unknown nested profile fields survive redo", history.redoDepth === 0 && (redoneAdd.nodes[2] as any).unknownFutureField.preserved === true);

const connected = state("Saved", added.nodes, [...saved.edges, { id: "e2", source: "start", target: "click" }]);
const moved = state("Saved", added.nodes.map((node) => node.id === "click" ? { ...node, position: { x: 200, y: 300 } } : node), connected.edges);
const edited = state("Renamed", moved.nodes.map((node) => node.id === "click" ? { ...node, label: "Edited" } : node), moved.edges);
const arranged = state("Renamed", edited.nodes.map((node, index) => ({ ...node, position: { x: 100, y: index * 120 } })), edited.edges);
history.record(connected);
history.record(moved);
history.record(edited);
history.record(arranged);
check("auto-arrange undo restores the property-edit state", same(history.undo()!, edited));
check("property edit undo restores moved state", same(history.undo()!, moved));
check("move undo restores connector state", same(history.undo()!, connected));
check("connector undo restores add state", same(history.undo()!, added));

history.redo();
const branched = state("Branch after undo", added.nodes, []);
history.record(branched);
check("new mutation after undo clears redo", !history.canRedo);

const cleanHistory = new BoundedEditorHistory(saved, same);
cleanHistory.record(added);
const savedCheckpoint = added;
cleanHistory.record(connected);
const atCheckpoint = cleanHistory.undo()!;
check("undo can return exactly to a saved checkpoint", same(atCheckpoint, savedCheckpoint));
const dirtyAtCheckpoint = !same(atCheckpoint, savedCheckpoint);
check("equality-based dirty state clears at checkpoint", !dirtyAtCheckpoint);

const bounded = new BoundedEditorHistory(state("0"), same);
for (let index = 1; index <= EDITOR_HISTORY_LIMIT + 25; index += 1) bounded.record(state(String(index)));
check("history depth is bounded", bounded.undoDepth === EDITOR_HISTORY_LIMIT, `depth=${bounded.undoDepth}`);
for (let index = 0; index < EDITOR_HISTORY_LIMIT; index += 1) bounded.undo();
check("states older than the bound are discarded", !bounded.canUndo);

bounded.reset(state("Loaded another profile"));
check("loading another profile resets both stacks", !bounded.canUndo && !bounded.canRedo);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
