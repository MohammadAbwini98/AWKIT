/**
 * Deterministic regressions for the Recorder capture gaps WebDriverUniversity exposed.
 *
 * Five defects, all found by driving the real Recorder against the live site and all sharing one
 * shape: the recording LOOKED fine and could not replay. Each one is reproduced here against
 * `mock-site/capture-gaps` and `mock-site/popup/document-write.html` so the regression needs no
 * internet.
 *
 *   [A] `awkit-tj2o` — a drag whose source follows the cursor recorded nothing. `elementFromPoint`
 *       returns the drag ghost, so the "released on the source itself" guard discarded the gesture.
 *       jQuery UI, react-draggable and SortableJS all behave this way; `/drag-lab`'s pointer
 *       sortable does not move its item, which is why no earlier fixture caught it.
 *   [B] `awkit-e0z6` — a radio group with no id or label got `:nth-of-type(n)`. `value` — the only
 *       attribute that identifies WHICH option — ranked below `href` and never survived the
 *       two-attribute cap.
 *   [C] `awkit-vzhy` — a clickable `li`/`div`/`td` whose own text identified it uniquely got a
 *       positional selector, because the text candidate was offered to buttons and links only.
 *   [D] `awkit-n4wr` — a click on a READONLY text input was dropped as redundant. It is not: no
 *       fill will ever be recorded for a field whose value cannot change, so the click that opens
 *       every datepicker and custom select vanished.
 *   [E] `awkit-jw46` — a popup built with `window.open('') + document.write(...)` recorded nothing.
 *       `document.open()` removes every listener on the Window, Document and its nodes while
 *       leaving the Window's properties untouched, so the install flag still read "installed".
 *
 * Plus [F], the press-and-hold half of `awkit-dhdr` that WDU exposed: a control that REPLACES the
 * pressed node on `mousedown`. The browser fires no `click` when the mousedown target is removed,
 * so an unhandled gesture disappears from the recording entirely rather than degrading to a click.
 *
 * MUTATION CONTRACT (measured, not asserted). Against 28 checks:
 *   [A] drag reads only the topmost hit again ......................... 4 fail
 *   [B] radio/checkbox `value` demoted below `type` again ............. 2 fail
 *   [B] scoped `:nth-` selector unflagged as a fallback again ......... 2 fail
 *   [C] own-text locator restricted to buttons and links again ........ 2 fail
 *   [D] readonly inputs skipped like typeable ones again .............. 1 fail
 *   [E] popup install probe reads the window flag again ............... 4 fail
 *   [F] a destroyed press target kills the gesture again .............. 5 fail
 *
 * [D] is deliberately narrow — one check can see it — which is why [D4] asserts the opposite
 * direction: a typeable field must still record only its fill, never a click as well.
 *
 * Run with: npx tsx scripts/verify-recorder-capture-gaps.mts
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";
import { RecorderService } from "@src/recorder/RecorderService";
import { getRecorderInitScriptContent } from "@src/recorder/recorderInitScript";
import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";
import type { RecordedAction } from "@src/recorder/RecorderTypes";

const PORT = 4427;
const BASE = `http://127.0.0.1:${PORT}`;
const LAB = `${BASE}/capture-gaps`;

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${String(detail).slice(0, 260)}` : ""}`);
  }
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch(LAB)).ok) return;
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Mock site did not start");
}

let recorderScript: string;

/** Bare init-script capture, for the cases that live entirely in the page. */
async function recordOn(browser: Browser, url: string, interact: (p: Page) => Promise<void>): Promise<RecordedAction[]> {
  const ctx = await browser.newContext();
  await ctx.addInitScript({ content: recorderScript });
  const page = await ctx.newPage();
  const actions: RecordedAction[] = [];
  await page.exposeBinding("__awtkit_recordAction", (_s, a) => {
    actions.push(a as RecordedAction);
  });
  await page.exposeBinding("__awtkit_recordSignal", () => {});
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);
  await interact(page);
  await page.waitForTimeout(400);
  await ctx.close();
  return actions;
}

/** Full service wiring, for the popup case — popup registration lives in `RecorderService`. */
async function recordWithService(
  browser: Browser,
  url: string,
  interact: (p: Page, ctx: BrowserContext) => Promise<void>
): Promise<RecordedAction[]> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const service = new RecorderService() as unknown as Record<string, unknown> & {
    wireContext: (c: BrowserContext) => Promise<void>;
    getActions: () => RecordedAction[];
  };
  Object.assign(service, {
    isRecording: true,
    captureWaitTime: false,
    captureSmartWaits: false,
    page,
    lastActionPage: page,
    actions: [],
    scheduleDraftPersist: () => undefined
  });
  await service.wireContext(ctx);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);
  await interact(page, ctx);
  await page.waitForTimeout(500);
  const actions = service.getActions();
  await ctx.close();
  return actions;
}

async function pointerDrag(page: Page, from: string, to: string): Promise<void> {
  const a = await page.getByTestId(from).boundingBox();
  const b = await page.getByTestId(to).boundingBox();
  if (!a || !b) throw new Error("missing bounding box");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 });
  await page.mouse.up();
}

async function pressAndHold(page: Page, testId: string, holdMs: number): Promise<void> {
  const target = page.getByTestId(testId);
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error(`no bounding box for ${testId}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
}

const primary = (a?: RecordedAction): string => `${a?.locator?.strategy}=${a?.locator?.value}`;

async function main(): Promise<void> {
  const server = spawn(process.execPath, ["mock-site/server.mjs"], {
    env: { ...process.env, MOCK_SITE_PORT: String(PORT) },
    stdio: "ignore"
  });
  await waitForServer();
  recorderScript = await getRecorderInitScriptContent();
  const browser = await chromium.launch({ headless: true });

  try {
    // ── [A] the drag ghost occludes the drop target ───────────────────────────────────────────
    console.log("\n[A] a drag whose source follows the cursor");
    const dragActions = await recordOn(browser, LAB, (p) => pointerDrag(p, "cg-source", "cg-target"));
    const drag = dragActions.find((x) => x.type === "drag");
    check("[A1] the gesture is captured as a drag", !!drag, JSON.stringify(dragActions.map((x) => x.type)));
    check("[A2] ...not discarded, and not left as a bare click", !dragActions.some((x) => x.type === "click"), JSON.stringify(dragActions.map((x) => x.type)));
    check("[A3] the source is the dragged element", /cg-source/.test(JSON.stringify(drag?.locator ?? null)), primary(drag));
    check(
      "[A4] the destination is the drop zone UNDER the ghost, not the ghost itself",
      /cg-target/.test(JSON.stringify(drag?.targetLocator ?? null)) && !/cg-source/.test(JSON.stringify(drag?.targetLocator ?? null)),
      JSON.stringify(drag?.targetLocator ?? null)
    );

    // ── [B] radio identified by value ─────────────────────────────────────────────────────────
    console.log("\n[B] a radio group whose only identity is its value");
    const radioActions = await recordOn(browser, LAB, async (p) => {
      await p.locator("input[name='cg-colour'][value='yellow']").check();
    });
    const radio = radioActions.find((x) => x.type === "radio");
    check("[B1] the option is captured as a radio", !!radio, JSON.stringify(radioActions.map((x) => x.type)));
    check("[B2] the stored locator names the chosen value", /yellow/.test(primary(radio)), primary(radio));
    check("[B3] ...and is not a positional index", !/nth-of-type|nth-child/.test(primary(radio)), primary(radio));
    check("[B4] the locator resolved to exactly one element", radio?.locator?.quality?.isUnique === true, JSON.stringify(radio?.locator?.quality));

    // A different option in the same group must produce a DIFFERENT locator — the check that would
    // still pass if every option shared one selector.
    const otherActions = await recordOn(browser, LAB, async (p) => {
      await p.locator("input[name='cg-colour'][value='purple']").check();
    });
    const other = otherActions.find((x) => x.type === "radio");
    check("[B5] a different option in the same group gets a different locator", primary(radio) !== primary(other), `${primary(radio)} vs ${primary(other)}`);

    // ── [C] own text for a clickable that is not a button or a link ───────────────────────────
    console.log("\n[C] a clickable list item identified by its own text");
    const listActions = await recordOn(browser, LAB, async (p) => {
      await p.getByText("Fix the build", { exact: true }).click();
    });
    const item = listActions.find((x) => x.type === "click");
    check("[C1] the list-item click is captured", !!item, JSON.stringify(listActions.map((x) => x.type)));
    check("[C2] the stored locator uses the item's own text", item?.locator?.strategy === "text" && item?.locator?.value === "Fix the build", primary(item));
    check("[C3] ...rather than a positional index into a list that re-renders", !/nth-of-type|nth-child/.test(primary(item)), primary(item));

    // The container must NOT get a text locator: its text is the sum of its children, not identity.
    const hostActions = await recordOn(browser, LAB, async (p) => {
      await p.getByTestId("cg-list-host").click({ position: { x: 2, y: 2 } });
    });
    const hostClick = hostActions.find((x) => x.type === "click");
    check(
      "[C4] a container is never given its children's aggregate text as a locator",
      !hostClick || hostClick.locator?.strategy !== "text" || !/Review the changelog/.test(String(hostClick.locator?.value)),
      primary(hostClick)
    );

    // ── [D] a readonly field's click is the interaction ───────────────────────────────────────
    console.log("\n[D] a readonly field that opens a picker");
    const pickerActions = await recordOn(browser, LAB, async (p) => {
      await p.getByTestId("cg-readonly-input").click();
      await p.waitForTimeout(200);
      await p.getByTestId("cg-picker-option").click();
    });
    const openClick = pickerActions.find((x) => x.type === "click" && /cg-readonly-input|input/.test(JSON.stringify(x.locator ?? {})));
    check("[D1] clicking the readonly field is captured", !!openClick, JSON.stringify(pickerActions.map((x) => `${x.type}:${x.locator?.value}`)));
    check("[D2] both the open and the choice are captured", pickerActions.filter((x) => x.type === "click").length >= 2, JSON.stringify(pickerActions.map((x) => x.type)));
    check("[D3] the readonly field is never recorded as a fill", !pickerActions.some((x) => x.type === "fill"), JSON.stringify(pickerActions.map((x) => x.type)));

    // A TYPEABLE field must still not record a click — the fill covers it, and a stray click on
    // every field is what the original exclusion existed to prevent.
    const typeActions = await recordOn(browser, `${BASE}/form`, async (p) => {
      const field = p.locator("input[type='text']").first();
      await field.click();
      await field.fill("typed");
      await p.keyboard.press("Tab"); // blur without clicking anything else
    });
    check(
      "[D4] a TYPEABLE field still records only its fill, never a click as well",
      !typeActions.some((x) => x.type === "click"),
      JSON.stringify(typeActions.map((x) => `${x.type}:${x.locator?.value}`))
    );

    // ── [E] a popup whose document is written ─────────────────────────────────────────────────
    console.log("\n[E] a popup built with document.write");
    const popupActions = await recordWithService(browser, `${BASE}/popup/document-write.html`, async (page) => {
      const popupPromise = page.waitForEvent("popup", { timeout: 15_000 });
      await page.getByTestId("open-written-popup").click();
      const popup = await popupPromise;
      await popup.waitForTimeout(400);
      await popup.getByTestId("written-confirm").click();
      await popup.waitForTimeout(400);
      check("[E0] the popup itself observed the click", (await popup.getByTestId("written-confirmed").textContent()) === "confirmed");
    });
    const opener = popupActions.find((x) => x.type === "click" && x.opensPopup);
    check("[E1] the opener click is marked as opening a popup", !!opener, JSON.stringify(popupActions.map((x) => `${x.type}@${x.pageAlias ?? "main"}`)));
    const inPopup = popupActions.find((x) => x.pageAlias && x.pageAlias !== "main" && x.type === "click");
    check("[E2] the click INSIDE the written document is captured", !!inPopup, JSON.stringify(popupActions.map((x) => `${x.type}@${x.pageAlias ?? "main"}`)));
    check("[E3] ...attributed to the popup, not the opener", inPopup?.pageAlias === opener?.popupExpectation?.popupAlias, `${inPopup?.pageAlias} vs ${opener?.popupExpectation?.popupAlias}`);
    check("[E4] a switch step is inserted before it", popupActions.some((x) => x.type === "switchToPopup"), JSON.stringify(popupActions.map((x) => x.type)));
    check(
      "[E5] the capture is armed promptly, not after the identity budget",
      popupActions.filter((x) => x.type === "click").length === 2,
      JSON.stringify(popupActions.map((x) => `${x.type}@${x.pageAlias ?? "main"}`))
    );

    // ── [F] press-and-hold on a control that replaces the pressed node ────────────────────────
    console.log("\n[F] press-and-hold where the page replaces what was pressed");
    // Press the CHILD, which the handler destroys — pressing the container would leave the target
    // alive and never exercise the surviving-ancestor path at all.
    const destroyActions = await recordOn(browser, LAB, (p) => pressAndHold(p, "cg-destroy-inner", 900));
    const hold = destroyActions.find((x) => x.type === "clickAndHold");
    check("[F1] the gesture survives the target being replaced", !!hold, JSON.stringify(destroyActions.map((x) => x.type)));
    check("[F2] it is stored as clickAndHold", hold?.type === "clickAndHold", JSON.stringify(destroyActions.map((x) => x.type)));
    check("[F3] with the measured hold duration", Number((hold?.config as { holdMs?: number } | undefined)?.holdMs ?? 0) >= 500, JSON.stringify(hold?.config));
    check(
      "[F4] the locator names the surviving container, not the destroyed child",
      /cg-destroy-box/.test(primary(hold)) && !/cg-destroy-inner/.test(primary(hold)),
      primary(hold)
    );
    const builtHold = buildRecordedFlow("destroyed hold", destroyActions).nodes.find((n) => n.type === "clickAndHold");
    check("[F5] the built flow keeps it", !!builtHold, JSON.stringify(buildRecordedFlow("destroyed hold", destroyActions).nodes.map((n) => n.type)));
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
