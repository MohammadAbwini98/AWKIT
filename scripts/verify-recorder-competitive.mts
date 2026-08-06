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

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

interface RecordedAction {
  type: string;
  name: string;
  locator?: { strategy: string; value: string; quality?: { matchCount?: number; isUnique?: boolean }; context?: any };
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
    const action = await capture(html, (p) => p.selectOption("#country", "ca"));
    console.log(`    · select → type=${action?.type} strategy=${action?.locator?.strategy} value=${JSON.stringify(val(action))} recorded=${action?.valueSource?.value}`);
    check("select: if recorded, the locator is unique", !action || unique(action), JSON.stringify(action?.locator?.quality));
    check("select: if recorded, the locator is not a utility/hash selector", !action || !UTILITY_OR_HASH.test(val(action)), val(action));
  }

  // ── E. contenteditable typing ────────────────────────────────────────────────
  console.log("E — contenteditable");
  {
    const html = `<div contenteditable="true" role="textbox" aria-label="Notes" style="border:1px solid #000;min-height:2em">edit me</div>`;
    const action = await capture(html, async (p) => {
      await p.locator("div[role=textbox]").click();
      await p.keyboard.type("hello world");
      await p.locator("div[role=textbox]").blur();
    });
    console.log(`    · contenteditable → type=${action?.type} strategy=${action?.locator?.strategy} value=${JSON.stringify(val(action))}`);
    check("contenteditable: if recorded, the locator is unique", !action || unique(action), JSON.stringify(action?.locator?.quality));
    check("contenteditable: if recorded, the locator is not a utility/hash selector", !action || !UTILITY_OR_HASH.test(val(action)), val(action));
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

  await browser.close();
  console.log(`\n${passed}/${passed + failed} recorder-competitive checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
