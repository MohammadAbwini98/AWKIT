/** Deterministic action-list mutation coverage for Recorder clear/delete and dependency cleanup. */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RecorderService } from "@src/recorder/RecorderService";
import { removeRecordedAction } from "@src/recorder/recordedActionMutations";
import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";
import type { RecordedAction } from "@src/recorder/RecorderTypes";

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) { passed += 1; console.log(`  PASS ${label}`); }
  else { failed += 1; console.error(`  FAIL ${label}${detail ? ` â€” ${detail}` : ""}`); }
}

async function main(): Promise<void> {
  console.log("Recorder action mutation policy");
  const ordinary: RecordedAction[] = [
    { id: "a", type: "click", name: "First" },
    { id: "wait-b", type: "wait", name: "Wait", waitMs: 800 },
    { id: "b", type: "click", name: "Second", afterWaits: [{ type: "fixedDelay", durationMs: 500 }] },
    { id: "c", type: "click", name: "Third" }
  ];
  const deleted = removeRecordedAction(ordinary, "b");
  check("ordinary delete removes the selected action", !deleted.actions.some((action) => action.id === "b"));
  check("synthetic prerequisite wait is removed with its consumer", deleted.removedIds.includes("wait-b"));
  check("unrelated neighboring actions are preserved", deleted.actions.map((action) => action.id).join(",") === "a,c", JSON.stringify(deleted.actions));
  check("first action deletion renumbers by stable remaining order", removeRecordedAction(ordinary, "a").actions.map((action) => action.id).join(",") === "wait-b,b,c");
  check("last action deletion preserves earlier actions and waits", removeRecordedAction(ordinary, "c").actions.map((action) => action.id).join(",") === "a,wait-b,b");
  check("only action deletion yields an empty list", removeRecordedAction([{ id: "only", type: "click", name: "Only" }], "only").actions.length === 0);

  const hoverBound: RecordedAction[] = [
    {
      id: "hover-click",
      type: "click",
      name: "Hover-gated click",
      locator: {
        strategy: "role",
        value: "button",
        interaction: { requiresHover: true, hoverContainer: { strategy: "role", value: "menu" } },
        prerequisite: {
          schemaVersion: 1,
          status: "resolved",
          hover: { required: true, resolved: true, reason: "hidden-at-rest" }
        }
      }
    },
    { id: "unrelated", type: "click", name: "Unrelated" }
  ];
  const hoverDelete = removeRecordedAction(hoverBound, "hover-click");
  check("deleting a hover-bound action removes its prerequisite metadata with the action", hoverDelete.actions.map((action) => action.id).join(",") === "unrelated");

  const popup: RecordedAction[] = [
    { id: "open", type: "click", name: "Open", opensPopup: true, popupExpectation: { popupAlias: "report" } },
    { id: "switch", type: "switchToPopup", name: "Switch", popupExpectation: { popupAlias: "report" } },
    { id: "child", type: "click", name: "Child", pageAlias: "report" },
    { id: "close", type: "closePopup", name: "Close", pageAlias: "report", config: { popupAlias: "report" } },
    { id: "main", type: "click", name: "Main" }
  ];
  const cascade = removeRecordedAction(popup, "open");
  check("popup opener deletion removes its lifecycle dependents", cascade.actions.map((action) => action.id).join(",") === "main", JSON.stringify(cascade));
  check("popup cascade is bounded to the matching alias", cascade.actions.some((action) => action.id === "main"));
  check("missing action is a no-op", removeRecordedAction(ordinary, "missing").actions.length === ordinary.length);

  const root = await mkdtemp(join(tmpdir(), "awkit-recorder-actions-"));
  try {
    const draft = join(root, "draft.json");
    const service = new RecorderService() as any;
    service.configureDraftStorage(draft);
    service.actions = [...ordinary];
    service.recordedUrls = [{ id: "url", url: "https://example.test/", timestamp: new Date(0).toISOString(), source: "manual_url_entry" }];
    service.isRecording = true;
    const cleared = await service.clearActions();
    check("Clear all empties the service action list", cleared.length === 0 && service.getActions().length === 0);
    check("Clear all preserves URL history", service.getUrls().length === 1 && service.getUrls()[0].id === "url");
    check("Clear all preserves the live recording state", service.getStatus().isRecording === true);
    const persisted = JSON.parse(await readFile(draft, "utf8")) as { actions: RecordedAction[] };
    check("Clear all durably persists an empty draft", Array.isArray(persisted.actions) && persisted.actions.length === 0);

    service.actions = [...popup];
    const serviceDelete = await service.deleteAction("open");
    check("service delete returns removed dependency ids", serviceDelete.removedIds.length === 4, JSON.stringify(serviceDelete));
    const persistedDelete = JSON.parse(await readFile(draft, "utf8")) as { actions: RecordedAction[] };
    check("service delete durably persists the cleaned list", persistedDelete.actions.map((action) => action.id).join(",") === "main");
    const saved = JSON.parse(JSON.stringify(buildRecordedFlow("Deleted popup round trip", persistedDelete.actions)));
    check("delete save/reload round trip contains no orphaned popup alias", !JSON.stringify(saved).includes("report"));

    service.actions = [{ id: "fresh", type: "click", name: "Captured after clear" }];
    await service.clearActions();
    service.actions.push({ id: "continued", type: "click", name: "Continued recording" });
    check("recording can append a fresh action after Clear all", service.getActions().map((action: RecordedAction) => action.id).join(",") === "continued");
    const continuedDraft = JSON.parse(JSON.stringify(buildRecordedFlow("Continue after clear", service.getActions())));
    check("clear-then-record profile round-trips only the new action", JSON.stringify(continuedDraft).includes("Continued recording") && !JSON.stringify(continuedDraft).includes("Captured after clear"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(1); });
