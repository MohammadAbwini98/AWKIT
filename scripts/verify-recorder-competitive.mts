/**
 * Competitive/adversarial Recorder scenarios — deep coverage beyond verify:recorder.
 *
 * Drives the REAL capture script (`installRecorderCapture`) inside real Chromium and probes the
 * cases a production-grade recorder is judged on and that the main suite does not exercise:
 *   A. Generated / framework identifiers (React useId, Ember, GUID, CSS-module id) are never used
 *      as the locator — they change every render/build.
 *   B. CSS-in-JS / hashed class names (emotion `css-…`, styled `sc-…`, FB atomic `x1…`, CSS-module
 *      `Foo__hash`) are never used as the locator.
 *   C. Meaningful, author-written classes ARE used when they disambiguate.
 *   D-F. Native <select>, contenteditable, and keyboard interactions are captured safely (if an
 *      action is recorded at all, its locator must be unique and non-utility).
 *
 * What a regression here looks like: a brittle generated token appears in a recorded locator, a
 * disambiguation is non-unique, or a captured locator is a utility/hashed selector.
 *
 * Run: npm run verify:recorder-competitive
 */
import { chromium } from "playwright";
import type { Page } from "playwright";
import { getRecorderInitScriptContent } from "@src/recorder/recorderInitScript";
import { RecorderService } from "@src/recorder/RecorderService";
import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";

let passed = 0;
let failed = 0;

/*
 * Known-gap sentinels are tallied SEPARATELY from ordinary checks, and deliberately so.
 *
 * A sentinel passes when a defect is still present. Counting one inside the headline number produces
 * a line like "58/58 recorder-competitive checks passed" that reads as "recorder pointer handling is
 * green" while two interactions are silently lost — the number becomes an argument against fixing
 * them. Reported apart, the summary has to say out loud that N assertions exist only because the
 * product is wrong.
 *
 * A sentinel that FAILS still fails the run: it means the behaviour changed, and the correct response
 * is to convert it into a positive assertion, not to adjust it until it passes again.
 */
let gapsHolding = 0;
let gapsChanged = 0;
const GAP_BEAD = "awkit-bxyo";
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * Record a KNOWN-GAP sentinel: an assertion that holds only while a defect remains unfixed.
 *
 * `condition` is "the gap is still exactly as measured". True means the defect persists — reported as
 * GAP, never as a pass. False means the behaviour moved and this assertion must be rewritten as a
 * positive one; that fails the run.
 */
function gapSentinel(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    gapsHolding += 1;
    console.log(`  GAP  ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    gapsChanged += 1;
    console.error(
      `  CHANGED  ${label} — the measured gap no longer holds. Convert this sentinel into a positive ` +
        `assertion and update ${GAP_BEAD}.${detail ? ` Detail: ${detail}` : ""}`
    );
  }
}

interface RecordedAction {
  id?: string;
  type: string;
  name: string;
  locator?: { strategy: string; value: string; quality?: { matchCount?: number; isUnique?: boolean }; context?: any };
  targetLocator?: { strategy?: string; value?: string; quality?: { isUnique?: boolean } };
  valueSource?: { type: string; value: string };
}

const UTILITY_OR_HASH = /\.(flex|items-center|justify-center|grid|block|hidden|css-|sc-|x1[a-z0-9]{5,})\b/;
const val = (a?: RecordedAction): string => a?.locator?.value ?? "";
const unique = (a?: RecordedAction): boolean => a?.locator?.quality?.matchCount === 1 || a?.locator?.quality?.isUnique === true;

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  const recorded: RecordedAction[] = [];
  const bindingRecorder = new RecorderService() as any;
  bindingRecorder.isRecording = true;
  bindingRecorder.captureWaitTime = false;
  bindingRecorder.captureSmartWaits = false;
  bindingRecorder.actions = [];
  bindingRecorder.lastActionAt = 0;
  await context.exposeBinding("__awtkit_recordAction", (source: any, action: RecordedAction) => {
    bindingRecorder.recordActionFromPage(source.page, action, source.frame);
    const stored = (bindingRecorder.getAmbiguityState()?.action ?? bindingRecorder.getActions().at(-1)) as RecordedAction | undefined;
    if (stored) recorded.push(stored);
  });
  await context.exposeBinding("__awtkit_recordSignal", () => undefined);
  await context.addInitScript({ content: getRecorderInitScriptContent() });
  const page = await context.newPage();

  async function capture(html: string, interact: (page: Page) => Promise<void>): Promise<RecordedAction | undefined> {
    recorded.length = 0;
    bindingRecorder.actions = [];
    bindingRecorder.ambiguityState = null;
    bindingRecorder.isRecording = true;
    bindingRecorder.lastActionAt = 0;
    bindingRecorder.lastActionPage = undefined;
    await page.goto("data:text/html;charset=utf-8," + encodeURIComponent("<!doctype html><html><body>" + html + "</body></html>"), { waitUntil: "load" });
    await interact(page);
    await page.waitForTimeout(120);
    return recorded[recorded.length - 1];
  }

  /**
   * Every action an interaction produced, not just the last.
   *
   * `capture` returns the tail, which cannot answer "how many actions did this gesture make?" — and
   * that count is the whole question for a double-click, where the page fires one `dblclick` and the
   * recorder stores two clicks.
   */
  async function captureAll(html: string, interact: (page: Page) => Promise<void>): Promise<RecordedAction[]> {
    await capture(html, interact);
    return [...recorded];
  }

  // ── A. Generated / framework identifiers must never be used ──────────────────
  // Two identical "Go" buttons; only the SECOND carries a generated id, so the recorder must
  // disambiguate the second one WITHOUT latching onto its unstable id.
  console.log("A — Generated identifier avoidance");
  const genIds: Array<[string, string]> = [
    ["React useId", ":r7:"],
    ["Ember auto-id", "ember1042"],
    ["GUID", "a1b2c3d4-e5f6-4a1b-8c2d-1234567890ab"],
    ["CSS-module id hash", "Header_root__2x9Yt"]
  ];
  for (const [label, id] of genIds) {
    const html = `<button type="button">Go</button><button type="button" id="${id}">Go</button>`;
    const action = await capture(html, (p) => p.locator("button").nth(1).click());
    console.log(`    · ${label} id="${id}" → strategy=${action?.locator?.strategy} value=${JSON.stringify(val(action))}`);
    check(`generated id (${label}) is NOT used in the locator`, !val(action).includes(id), val(action));
    check(`generated id (${label}) still yields a unique locator`, unique(action), JSON.stringify(action?.locator?.quality));
  }

  // ── B. CSS-in-JS / hashed classes must never be used ─────────────────────────
  console.log("B — Hashed / CSS-in-JS class avoidance");
  const hashClasses: Array<[string, string]> = [
    ["emotion", "css-1a2b3c"],
    ["styled-components v6", "sc-bdvvtL"],
    ["Facebook atomic", "x1lliihq"],
    ["CSS-module class", "Button_primary__3xKz9"]
  ];
  for (const [label, cls] of hashClasses) {
    const html = `<button type="button">Go</button><button type="button" class="${cls}">Go</button>`;
    const action = await capture(html, (p) => p.locator("button").nth(1).click());
    console.log(`    · ${label} class="${cls}" → strategy=${action?.locator?.strategy} value=${JSON.stringify(val(action))}`);
    check(`hashed class (${label}) is NOT used in the locator`, !val(action).includes(cls), val(action));
    check(`hashed class (${label}) still yields a unique locator`, unique(action), JSON.stringify(action?.locator?.quality));
  }

  // ── C. Meaningful author-written classes ARE used when they disambiguate ─────
  console.log("C — Meaningful class usage");
  {
    const html = `<button type="button">Go</button><button type="button" class="checkout-button">Go</button>`;
    const action = await capture(html, (p) => p.locator("button").nth(1).click());
    console.log(`    · hyphenated meaningful class → value=${JSON.stringify(val(action))}`);
    check("meaningful hyphenated class disambiguates uniquely", unique(action), JSON.stringify(action?.locator?.quality));
    check("meaningful hyphenated class is not a utility/hash selector", !UTILITY_OR_HASH.test(val(action)), val(action));
    // Characterization only (single-word ≥6 chars can trip the CLASS_HASH_RE over-match): assert the
    // uniqueness GUARANTEE, log whether the class itself was used.
    const html2 = `<button type="button">Go</button><button type="button" class="checkout">Go</button>`;
    const action2 = await capture(html2, (p) => p.locator("button").nth(1).click());
    console.log(`    · single-word class "checkout" → value=${JSON.stringify(val(action2))} (used .checkout? ${val(action2).includes("checkout")})`);
    check("single-word semantic class still yields a unique locator", unique(action2), JSON.stringify(action2?.locator?.quality));
  }

  // ── D. Native <select> option selection ──────────────────────────────────────
  console.log("D — Native <select>");
  {
    const html = `<label for="country">Country</label><select id="country"><option value="us">United States</option><option value="ca">Canada</option></select>`;
    const action = await capture(html, async (p) => {
      await p.selectOption("#country", "ca");
    });
    console.log(`    · select → type=${action?.type} strategy=${action?.locator?.strategy} value=${JSON.stringify(val(action))} recorded=${action?.valueSource?.value}`);
    check("select: if recorded, the locator is unique", !action || unique(action), JSON.stringify(action?.locator?.quality));
    check("select: if recorded, the locator is not a utility/hash selector", !action || !UTILITY_OR_HASH.test(val(action)), val(action));
  }

  // ── E. contenteditable typing (awkit-fbq: the typed text must be captured, not just the click) ──
  console.log("E — contenteditable");
  {
    const html = `<div contenteditable="true" role="textbox" aria-label="Notes" style="border:1px solid #000;min-height:2em;padding:4px"></div>`;
    const action = await capture(html, async (p) => {
      await p.locator("div[role=textbox]").click();
      await p.keyboard.type("hello world");
      await p.locator("div[role=textbox]").blur();
    });
    console.log(`    · contenteditable → type=${action?.type} strategy=${action?.locator?.strategy} value=${JSON.stringify(action?.valueSource?.value)}`);
    check("contenteditable: typed text is captured as a fill (not just the click)", action?.type === "fill", JSON.stringify(action));
    check("contenteditable: the fill value is the entered text", (action?.valueSource?.value ?? "").includes("hello world"), JSON.stringify(action?.valueSource));
    check("contenteditable: locator is unique and not a utility/hash selector", unique(action) && !UTILITY_OR_HASH.test(val(action)), val(action));
  }

  // ── G. Drag and drop (native HTML5 DnD) — capture as a `drag` action ─────────
  console.log("G — Drag and drop");
  {
    const html = `
      <ul style="list-style:none"><li draggable="true" id="src" style="padding:8px">Item A</li></ul>
      <div id="dropzone" style="padding:24px;border:2px dashed #888">Drop zone</div>
      <script>
        var dz = document.getElementById('dropzone');
        dz.addEventListener('dragover', function (e) { e.preventDefault(); });
        dz.addEventListener('drop', function (e) { e.preventDefault(); dz.textContent = 'dropped'; });
      </script>`;
    const action = await capture(html, (p) => p.dragAndDrop("#src", "#dropzone"));
    console.log(
      `    · drag → type=${action?.type} source=${JSON.stringify(val(action))} target=${JSON.stringify(action?.targetLocator?.value)} name=${JSON.stringify(action?.name)}`
    );
    check("drag: a native HTML5 drag is captured as a `drag` action", action?.type === "drag", JSON.stringify(action));
    check("drag: the action carries a source locator (the dragged element)", !!action?.locator?.value, JSON.stringify(action?.locator));
    check("drag: the action carries a distinct target locator (the drop target)", !!action?.targetLocator?.value && action?.targetLocator?.value !== action?.locator?.value, JSON.stringify(action?.targetLocator));
    check("drag: source locator is unique + non-utility", !action || (unique(action) && !UTILITY_OR_HASH.test(val(action))), JSON.stringify(action?.locator?.quality));
    // Dedup: a native drag fires BOTH native (dragstart/drop/dragend) and pointer events; only ONE
    // `drag` action must result (the pointer recognizer defers to the native path).
    check("drag: native + pointer paths deduplicate to exactly one drag action", recorded.filter((a) => a.type === "drag").length === 1, `got ${recorded.filter((a) => a.type === "drag").length}`);
  }

  // ── H. Custom ARIA combobox + listbox option ─────────────────────────────────
  console.log("H — Custom ARIA combobox/listbox");
  {
    const html = `
      <div role="combobox" aria-expanded="true" aria-label="Fruit" tabindex="0">Pick…</div>
      <ul role="listbox" aria-label="Fruit options" style="list-style:none">
        <li role="option" style="padding:6px">Apple</li>
        <li role="option" style="padding:6px">Banana</li>
      </ul>`;
    const action = await capture(html, (p) => p.locator("li[role=option]", { hasText: "Banana" }).click());
    console.log(`    · listbox option → type=${action?.type} strategy=${action?.locator?.strategy} value=${JSON.stringify(val(action))} name=${JSON.stringify(action?.name)}`);
    check("aria listbox: the option click is recorded", !!action, JSON.stringify(action));
    check("aria listbox: option locator is unique", !action || unique(action), JSON.stringify(action?.locator?.quality));
    check(
      "aria listbox: option locator is semantic (role/text/testid), not utility/hash/positional",
      !action || (["role", "text", "testId"].includes(action?.locator?.strategy ?? "") && !UTILITY_OR_HASH.test(val(action))),
      `${action?.locator?.strategy} ${val(action)}`
    );
  }

  // ── I. SPA client-side navigation continuity ─────────────────────────────────
  // A pushState + full DOM replacement (no document navigation) must NOT stop capture — the delegated
  // window listeners persist, so the post-"navigation" click must still be recorded.
  console.log("I — SPA client-side navigation continuity");
  {
    recorded.length = 0;
    bindingRecorder.actions = [];
    bindingRecorder.ambiguityState = null;
    bindingRecorder.isRecording = true;
    bindingRecorder.lastActionAt = 0;
    bindingRecorder.lastActionPage = undefined;
    await page.goto(
      "data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><html><body><button id="p1">Page 1 action</button></body></html>`),
      { waitUntil: "load" }
    );
    await page.locator("#p1").click();
    await page.evaluate(() => {
      try {
        history.pushState({}, "", "#/dashboard"); // hash route change (valid even on data: URLs)
      } catch {
        /* some origins reject pushState — the DOM swap below is the real capture-survival test */
      }
      document.body.innerHTML = '<button id="p2">Page 2 action</button>';
    });
    await page.waitForTimeout(60);
    await page.locator("#p2").click();
    await page.waitForTimeout(120);
    const count = recorded.length;
    const last = recorded[recorded.length - 1];
    console.log(`    · after pushState + DOM swap → captured ${count} action(s); last name=${JSON.stringify(last?.name)}`);
    check("spa: capture survives a client-side route change (both clicks recorded)", count >= 2, `captured ${count}`);
    check("spa: the post-navigation click resolves to the new element", (last?.name ?? "").includes("Page 2"), last?.name);
  }

  // ── F. Keyboard Enter submit ─────────────────────────────────────────────────
  console.log("F — Keyboard Enter");
  {
    const html = `<form onsubmit="return false"><input aria-label="Search" type="text"><button type="submit">Search</button></form>`;
    const action = await capture(html, async (p) => {
      await p.locator("input[aria-label=Search]").click();
      await p.locator("input[aria-label=Search]").fill("query");
      await p.keyboard.press("Enter");
    });
    console.log(`    · after fill + Enter → last action type=${action?.type} strategy=${action?.locator?.strategy}`);
    check("keyboard: an action was captured for the interaction (no crash / silent loss of the fill)", !!action, JSON.stringify(action));
    check("keyboard: captured locator is unique", !action || unique(action), JSON.stringify(action?.locator?.quality));
  }

  // ── L. DECLARED LIMITATIONS: double-click and context menu ───────────────────
  /*
   * These two record something other than what the user did, and until now nothing said so.
   * The recorder installs listeners for click, keydown, change, pointer*, drop, popstate,
   * hashchange, scroll and mouseover — there is no `dblclick` and no `contextmenu` listener.
   *
   * Measured, not assumed:
   *   double-click → the page's dblclick handler fires; the recorder stores TWO click actions
   *   right-click  → the page's contextmenu handler fires; the recorder stores NOTHING
   *
   * These checks exist to make the gap loud rather than to bless it. Two clicks replayed with a gap
   * between them will not reliably re-fire `dblclick`, so a dblclick-driven UI records but does not
   * faithfully replay; a right-click is dropped silently, with no step and no warning. If either is
   * ever implemented properly, these checks SHOULD fail — that is the signal to update them, and the
   * limitation is recorded in docs/testing/RECORDER_NAVIGATION_MATRIX.md.
   */
  console.log("L — Declared limitations (double-click, context menu)");
  {
    const html = `<button data-testid="lim-target" style="padding:20px">Target</button>`;

    // Control FIRST. Every assertion below is about a COUNT, and a count of 0 or 2 is also what a
    // recorder that has stopped capturing altogether would produce.
    const single = await captureAll(html, (p) => p.getByTestId("lim-target").click());
    check(
      "limits: the control single click records exactly one action (capture is alive)",
      single.length === 1 && single[0]?.type === "click",
      JSON.stringify(single.map((a) => a.type))
    );

    const double = await captureAll(html, (p) => p.getByTestId("lim-target").dblclick());
    gapSentinel(
      "double-click is captured as two ordinary clicks, not a double-click action",
      double.length === 2 && double.every((a) => a.type === "click"),
      JSON.stringify(double.map((a) => a.type))
    );
    check(
      "limits: no action type claims double-click semantics the runtime cannot replay",
      !double.some((a) => /dbl|double/i.test(a.type)),
      JSON.stringify(double.map((a) => a.type))
    );

    const rightClick = await captureAll(html, (p) => p.getByTestId("lim-target").click({ button: "right" }));
    gapSentinel(
      "right-click is discarded entirely — no context-menu action is captured",
      rightClick.length === 0,
      JSON.stringify(rightClick.map((a) => `${a.type}:${a.name}`))
    );
  }

  // ── P. Pointer-emulated drag (bounded gesture recognizer) ────────────────────
  console.log("P — Pointer-emulated drag");
  // Cards carry user-select:none (as react-dnd/dnd-kit/SortableJS items do) so a pointer drag never
  // turns into a text selection. No `draggable` attr → the native path never fires here.
  const pointerHtml = `
    <div data-testid="p-src" style="position:absolute;left:12px;top:24px;width:96px;height:46px;user-select:none;-webkit-user-select:none;background:#dde">Card A</div>
    <div data-testid="p-zone" style="position:absolute;left:240px;top:24px;width:150px;height:96px;user-select:none;-webkit-user-select:none;background:#efe">Drop zone</div>`;
  const centreDrag = async (page: Page, srcSel: string, dstSel: string): Promise<void> => {
    const s = await page.locator(srcSel).boundingBox();
    const d = await page.locator(dstSel).boundingBox();
    if (!s || !d) throw new Error("missing bounding box");
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
    await page.mouse.down();
    await page.mouse.move(s.x + s.width / 2 + 6, s.y + s.height / 2 + 4, { steps: 3 }); // cross the threshold
    await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2, { steps: 10 });
    await page.mouse.up();
  };

  {
    const action = await capture(pointerHtml, (p) => centreDrag(p, "[data-testid=p-src]", "[data-testid=p-zone]"));
    console.log(`    · pointer drag → type=${action?.type} source=${JSON.stringify(val(action))} target=${JSON.stringify(action?.targetLocator?.value)}`);
    check("pointer: a pointer-only gesture is captured as a `drag` action", action?.type === "drag", JSON.stringify(action));
    check("pointer: the source locator is the dragged card", action?.locator?.value === "p-src", JSON.stringify(action?.locator));
    check("pointer: a distinct drop-target locator is captured", action?.targetLocator?.value === "p-zone", JSON.stringify(action?.targetLocator));
    const flow = buildRecordedFlow("PointerDrag", [action as any]);
    const step = flow.nodes.find((n) => n.type === "drag");
    const rt = JSON.parse(JSON.stringify(flow)).nodes.find((n: { type: string }) => n.type === "drag");
    check("pointer: both locators survive the save/reload round-trip", rt?.locator?.value === "p-src" && rt?.targetLocator?.value === "p-zone", JSON.stringify(rt));
    check("pointer: a unique drop target is resolved (not review)", step?.targetLocator?.resolution === "resolved", JSON.stringify(step?.targetLocator));
  }

  // Small movement stays a click — jitter must not become a drag.
  {
    const action = await capture(pointerHtml, async (p) => {
      const s = await p.locator("[data-testid=p-src]").boundingBox();
      if (!s) throw new Error("no box");
      await p.mouse.move(s.x + 10, s.y + 10);
      await p.mouse.down();
      await p.mouse.move(s.x + 13, s.y + 12, { steps: 2 });
      await p.mouse.up();
    });
    check("pointer: a small movement stays a click, not a drag", action?.type !== "drag", JSON.stringify(action));
  }

  // Text selection is not a drag (source without user-select:none; dragging selects text).
  {
    const textHtml = `<p data-testid="p-text" style="width:420px">The quick brown fox jumps over the lazy dog and then keeps on running for quite a while</p>`;
    const action = await capture(textHtml, async (p) => {
      const b = await p.locator("[data-testid=p-text]").boundingBox();
      if (!b) throw new Error("no box");
      await p.mouse.move(b.x + 5, b.y + 8);
      await p.mouse.down();
      await p.mouse.move(b.x + 220, b.y + 8, { steps: 10 });
      await p.mouse.up();
    });
    check("pointer: dragging across text selects it and is NOT a drag", action?.type !== "drag", JSON.stringify(action));
  }

  // Escape during the gesture cancels it — no action.
  {
    const action = await capture(pointerHtml, async (p) => {
      const s = await p.locator("[data-testid=p-src]").boundingBox();
      if (!s) throw new Error("no box");
      await p.mouse.move(s.x + 10, s.y + 10);
      await p.mouse.down();
      await p.mouse.move(s.x + 120, s.y + 40, { steps: 6 });
      await p.keyboard.press("Escape");
      await p.mouse.up();
    });
    check("pointer: Escape during a gesture cancels it (no drag)", action?.type !== "drag", JSON.stringify(action));
  }

  // Releasing over no credible target (empty page area) produces no drag — never fabricated.
  {
    const action = await capture(pointerHtml, async (p) => {
      const s = await p.locator("[data-testid=p-src]").boundingBox();
      if (!s) throw new Error("no box");
      await p.mouse.move(s.x + 10, s.y + 10);
      await p.mouse.down();
      await p.mouse.move(s.x + 10, s.y + 460, { steps: 8 });
      await p.mouse.up();
    });
    check("pointer: releasing over no credible target produces no drag", action?.type !== "drag", JSON.stringify(action));
  }

  // A slider (input[type=range]) is not a drag source.
  {
    const rangeHtml = `<input data-testid="p-range" type="range" min="0" max="100" style="position:absolute;left:12px;top:24px;width:200px" />
      <div data-testid="p-zone" style="position:absolute;left:260px;top:24px;width:120px;height:80px;user-select:none">Zone</div>`;
    const action = await capture(rangeHtml, (p) => centreDrag(p, "[data-testid=p-range]", "[data-testid=p-zone]"));
    check("pointer: manipulating a range slider is not captured as a drag", action?.type !== "drag", JSON.stringify(action));
  }

  // A non-primary (right) button drag is not captured.
  {
    const action = await capture(pointerHtml, async (p) => {
      const s = await p.locator("[data-testid=p-src]").boundingBox();
      const d = await p.locator("[data-testid=p-zone]").boundingBox();
      if (!s || !d) throw new Error("no box");
      await p.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
      await p.mouse.down({ button: "right" });
      await p.mouse.move(d.x + d.width / 2, d.y + d.height / 2, { steps: 8 });
      await p.mouse.up({ button: "right" });
    });
    check("pointer: a non-primary (right-button) gesture is not a drag", action?.type !== "drag", JSON.stringify(action));
  }

  // Duplicate-looking drop targets → the target is review-required (never silently chosen by index).
  {
    const dupHtml = `
      <div data-testid="p-src" style="position:absolute;left:12px;top:20px;width:90px;height:40px;user-select:none">Card</div>
      <div class="zone" style="position:absolute;left:240px;top:20px;width:120px;height:64px;user-select:none">Zone</div>
      <div class="zone" style="position:absolute;left:240px;top:110px;width:120px;height:64px;user-select:none">Zone</div>`;
    const action = await capture(dupHtml, (p) => centreDrag(p, "[data-testid=p-src]", ".zone >> nth=0"));
    const flow = buildRecordedFlow("PointerDup", [action as any]);
    const step = flow.nodes.find((n) => n.type === "drag");
    console.log(`    · duplicate target → target=${JSON.stringify(step?.targetLocator?.value)} resolution=${step?.targetLocator?.resolution}`);
    check("pointer: an ambiguous/positional drop target is captured as a drag", action?.type === "drag", JSON.stringify(action));
    /*
     * awkit-gc0g. This check used to assert `resolution === "needs-review"`. That expectation predates
     * awkit-65g, where the owner directive changed the policy deliberately: the recorder builds a
     * unique selector and ADOPTS a positional last-resort as resolved, rather than pausing for review.
     * `buildRecordedFlow` routes a unique-but-positional locator straight to `resolved`, and
     * `verify:locator-guard` asserts the same for the sensitive case.
     *
     * The intent the old assertion protected is NOT obsolete, so it is not deleted and the product is
     * not bent back to satisfy it. The intent was: an index-chosen target must never be silently
     * indistinguishable from a strong locator. That protection now lives in the locator's own
     * declaration - positional disambiguation, low confidence, an explicit warning - and in the guard
     * evidence that makes replay RE-PROVE the recorded identity instead of trusting the index. Those
     * are what the checks below assert.
     */
    const dropTarget = step?.targetLocator;
    check(
      "pointer: a positional drop target is adopted as resolved (awkit-65g: no pause, no approval)",
      dropTarget?.resolution === "resolved" && dropTarget?.resolvedBy === "recorder",
      JSON.stringify(dropTarget)
    );
    check(
      "pointer: it declares itself POSITIONAL rather than passing as an ordinary selector",
      dropTarget?.quality?.disambiguation === "positional",
      JSON.stringify(dropTarget?.quality)
    );
    check(
      "pointer: it is low confidence and carries its own warning",
      dropTarget?.quality?.confidence === "low" && typeof dropTarget?.quality?.warning === "string" &&
        (dropTarget?.quality?.warning?.length ?? 0) > 0,
      JSON.stringify(dropTarget?.quality)
    );
    check(
      "pointer: it carries guard evidence, so replay re-proves identity instead of trusting the index",
      Boolean(dropTarget?.guard?.fingerprint) && Boolean(dropTarget?.guard?.candidateSelector),
      JSON.stringify(dropTarget?.guard)
    );
    check(
      "pointer: the guard records the ambiguous sibling set the index was chosen from",
      (dropTarget?.guard?.siblingCount ?? 0) >= 2 && typeof dropTarget?.guard?.index === "number",
      JSON.stringify(dropTarget?.guard)
    );
  }

  // Shadow-boundary: dropping onto an open-shadow host is supported through the existing architecture
  // (elementFromPoint returns the light-DOM host, which the locator engine resolves normally).
  {
    const shadowHtml = `
      <div data-testid="p-src" style="position:absolute;left:12px;top:24px;width:96px;height:46px;user-select:none">Card</div>
      <div data-testid="p-shadow-host" style="position:absolute;left:240px;top:24px;width:150px;height:96px;user-select:none">host</div>
      <script>
        var h = document.querySelector('[data-testid="p-shadow-host"]');
        var r = h.attachShadow({ mode: "open" });
        r.innerHTML = '<div style="width:100%;height:100%">inner drop zone</div>';
      </script>`;
    const action = await capture(shadowHtml, (p) => centreDrag(p, "[data-testid=p-src]", "[data-testid=p-shadow-host]"));
    console.log(`    · shadow-host drop → type=${action?.type} target=${JSON.stringify(action?.targetLocator?.value)}`);
    check("pointer: dropping onto a shadow host is captured via the host (existing architecture)", action?.type === "drag" && action?.targetLocator?.value === "p-shadow-host", JSON.stringify(action?.targetLocator));
  }

  // NOTE on the movement threshold: the "successful drag" checks above and the "small movement stays a
  // click" check below BRACKET DRAG_MOVE_THRESHOLD_PX — a threshold set too high fails the former, too
  // low fails the latter. The threshold's load-bearing role is also mutation-tested in the verifier's
  // run recipe (docs/ai/TASK_LOG.md): raising it to 100000 flips the successful-drag checks to FAIL.
  // Cross-frame pointer drags cannot form a single gesture in one frame, so they fail closed (no action);
  // within-frame drags are captured by that frame's recognizer.

  await browser.close();
  console.log(`\n${passed}/${passed + failed} recorder-competitive checks passed`);
  if (gapsHolding > 0 || gapsChanged > 0) {
    console.log(
      `${gapsHolding} known-gap sentinel(s) still holding — these are NOT passes. They assert that an ` +
        `open defect remains present (${GAP_BEAD}: double-click and right-click are not captured ` +
        `semantically). When that work lands they must become positive assertions.`
    );
    if (gapsChanged > 0) {
      console.error(`${gapsChanged} sentinel(s) no longer describe the product — rewrite them.`);
    }
  }
  process.exit(failed === 0 && gapsChanged === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
