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
    { id: "b", type: "click", name: "Second", afterWaits: [{ type: "fixedDelay", delayMs: 500 }] },
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
    service.signals = [{ type: "mutation", at: 1 }];
    service.lastClickByPage.set({} as never, { action: ordinary[0], at: 1 });
    service.popupAttributions.set({} as never, { action: ordinary[0] });
    service.ambiguityState = { kind: "positional", action: ordinary[0] };
    const cleared = await service.clearActions();
    check("Clear all empties the service action list", cleared.length === 0 && service.getActions().length === 0);
    check("Clear all preserves URL history", service.getUrls().length === 1 && service.getUrls()[0].id === "url");
    check("Clear all preserves the live recording state", service.getStatus().isRecording === true);
    check(
      "Clear all removes stale signals, click attribution, popup attribution, and review state",
      service.signals.length === 0 && service.lastClickByPage.size === 0 && service.popupAttributions.size === 0 && service.ambiguityState === null
    );
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

  // ── AWKIT-REC-038 — Enter is VALUE-PRESERVING for the fill echo rule ────────────────────────
{
  // Drive the REAL service echo policy through the same seam the browser binding uses.
  const svc = new RecorderService() as unknown as Record<string, any>;
  const root2 = await mkdtemp(join(tmpdir(), "awkit-rec038-"));
  svc.configureDraftStorage(join(root2, "draft.json"));
  svc.isRecording = true;
  svc.actions = [];
  svc.lastActionAt = Date.now();
  svc.lastActionPage = undefined;
  const page = { mainFrame: () => ({}), url: () => "https://x.test/form" };
  const mkFill = (v: string): RecordedAction => ({
    id: `fill-${Math.random().toString(36).slice(2)}`,
    type: "fill",
    name: "Fill Username",
    locator: { strategy: "label", value: "Username" },
    valueSource: { type: "static", value: v }
  });
  const press = (key: string): RecordedAction => ({
    id: `press-${Math.random().toString(36).slice(2)}`,
    type: "press",
    name: "Press " + key,
    locator: { strategy: "label", value: "Username" },
    valueSource: { type: "static", value: key }
  });
  await svc.recordActionFromPage(page, mkFill("alice"));
  await svc.recordActionFromPage(page, press("Enter"));
  await svc.recordActionFromPage(page, mkFill("alice"));
  const fillsAfterPress = svc.actions.filter((a: RecordedAction, i: number) =>
    a.type === "fill" && svc.actions.slice(0, i).some((p: RecordedAction) => p.type === "press" && p.valueSource?.value === "Enter")
  );
  check("REC-038 no duplicate Fill survives after Press Enter", fillsAfterPress.length === 0, JSON.stringify(svc.actions.map((a: RecordedAction) => a.name)));
  check("REC-038 the original Fill and the Press remain recorded", svc.actions.some((a: RecordedAction) => a.type === "fill") && svc.actions.some((a: RecordedAction) => a.type === "press" && a.valueSource?.value === "Enter"));
  // Escape behaves like Enter (revert, not edit).
  await svc.recordActionFromPage(page, mkFill("alice"));
  check("REC-038 an identical echo after Escape-only is also collapsed", svc.actions.filter((a: RecordedAction) => a.type === "fill").length === 1);
  svc.isRecording = false;
  await rm(root2, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(1); });
