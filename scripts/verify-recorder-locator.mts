/**
 * Live verification of the Recorder's unique-locator generation and the runner's
 * non-unique-locator safeguard. Run with: npx tsx scripts/verify-recorder-locator.mts
 *
 * Part A drives the exact capture script the recorder injects (`installRecorderCapture`)
 * inside a real Chromium page and asserts it saves unique, semantic locators — never
 * generic utility-class selectors like `div.flex.items-center.justify-center`.
 * Part B asserts `StepExecutor` fails a non-unique step with a friendly message and
 * translates raw Playwright strict-mode errors.
 */
import { chromium } from "playwright";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { Page } from "playwright";
import { getRecorderInitScriptContent } from "@src/recorder/recorderInitScript";
import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";
import { RecorderService } from "@src/recorder/RecorderService";
import { buildSmartWaits, type RecordedSignal } from "@src/recorder/smartWaitObservation";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { FileLocatorRecoveryStore } from "@src/runner/LocatorRecoveryStore";
import { ValueResolver } from "@src/runner/ValueResolver";
import { StepExecutor } from "@src/runner/StepExecutor";
import { derivePopupAlias } from "@src/runner/runtime/PopupIdentityRegistry";
import { executionBlockingErrorsOf, hasActivePathError, validateFlowDefinition } from "@src/validation/FlowValidator";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";
import type { FlowStep, LocatorContainerContext } from "@src/profiles/FlowProfile";
import { createLocatorApprovalBinding } from "@src/profiles/locatorApproval";

let passed = 0;
let failed = 0;

function check(label: string, condition: unknown, detail?: string) {
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
  locator?: { strategy: string; value: string; name?: string; exact?: boolean; quality?: any; alternatives?: any[]; context?: any; interaction?: any; resolution?: string; resolvedBy?: string; reviewReason?: string };
  valueSource?: { type: string; value: string };
}

async function makeContext(): Promise<InstanceExecutionContext> {
  const dir = await mkdtemp(join(tmpdir(), "wfs-recloc-"));
  return {
    executionId: "exec-1",
    instanceId: "inst-1",
    scenarioId: "scen-1",
    flowId: "flow-1",
    instanceOrderNumber: 1,
    totalInstances: 1,
    runtimeInputs: {},
    instanceInputs: {},
    flowOutputs: {},
    paths: {
      downloads: join(dir, "downloads"),
      screenshots: join(dir, "screenshots"),
      logs: join(dir, "logs"),
      reports: join(dir, "reports"),
      sessions: join(dir, "sessions")
    }
  };
}

function approveFallback(step: FlowStep, reason = "Reviewed in the locator verifier."): FlowStep {
  const approved: FlowStep = {
    ...step,
    locator: {
      ...step.locator!,
      resolution: "user-approved-fallback",
      resolvedBy: "user",
      approvedFallbackReason: reason
    }
  };
  approved.locator!.approvedFallbackBinding = createLocatorApprovalBinding(approved);
  return approved;
}

const UTILITY_CLASS = /\.(flex|items-center|justify-center|relative|absolute|grid|block|hidden)\b/;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  const recorded: RecordedAction[] = [];
  const bindingRecorder = new RecorderService() as any;
  bindingRecorder.isRecording = true;
  bindingRecorder.captureWaitTime = false;
  bindingRecorder.captureSmartWaits = false;
  bindingRecorder.actions = [];
  bindingRecorder.lastActionAt = 0;
  await context.exposeBinding("__awtkit_recordAction", (source, action: RecordedAction) => {
    bindingRecorder.recordActionFromPage(source.page, action, source.frame);
    const stored = (bindingRecorder.getAmbiguityState()?.action ?? bindingRecorder.getActions().at(-1)) as RecordedAction | undefined;
    if (stored) recorded.push(stored);
  });
  // Part D captures the raw Smart Wait observation signals emitted by the injected script.
  const signals: RecordedSignal[] = [];
  await context.exposeBinding("__awtkit_recordSignal", (_source, s: RecordedSignal) => {
    signals.push(s);
  });
  // Register the capture script BEFORE the page is created so it applies to every
  // subsequent setContent() document (matches RecorderService, which injects before goto()).
  await context.addInitScript({ content: getRecorderInitScriptContent() });
  const page = await context.newPage();

  // Runs `interact` against `html`, returns the single action the capture script produced.
  async function capture(html: string, interact: (page: Page) => Promise<void>): Promise<RecordedAction | undefined> {
    recorded.length = 0;
    bindingRecorder.actions = [];
    bindingRecorder.ambiguityState = null;
    bindingRecorder.isRecording = true;
    bindingRecorder.lastActionAt = 0;
    bindingRecorder.lastActionPage = undefined;
    // Navigate (not setContent) so the addInitScript capture reliably runs for this document.
    await page.goto("data:text/html;charset=utf-8," + encodeURIComponent("<!doctype html><html><body>" + html + "</body></html>"), { waitUntil: "load" });
    await interact(page);
    await page.waitForTimeout(120);
    return recorded[recorded.length - 1];
  }

  console.log("Part A — Recorder unique-locator generation");

  // 1. Unique button among utility-class divs → semantic locator, unique, no utility classes.
  {
    const html = `
      <div class="flex items-center justify-center">A</div>
      <div class="flex items-center justify-center">B</div>
      <div class="flex items-center justify-center">
        <button class="flex items-center justify-center" type="submit">Log in</button>
      </div>
      ${Array.from({ length: 18 }, () => '<div class="flex items-center justify-center">x</div>').join("")}`;
    const action = await capture(html, (p) => p.getByRole("button", { name: "Log in" }).click());
    check("click button → records an action", !!action, JSON.stringify(action));
    check("chosen strategy is semantic (role/text/testId)", ["role", "text", "testId"].includes(action?.locator?.strategy ?? ""), action?.locator?.strategy);
    check("locator is NOT a utility-class selector", !UTILITY_CLASS.test(action?.locator?.value ?? ""), action?.locator?.value);
    check("locator marked unique (matchCount === 1)", action?.locator?.quality?.matchCount === 1, JSON.stringify(action?.locator?.quality));
    check("step name is human-readable ('Click Log in')", action?.name === "Click Log in", action?.name);
  }

  // 2. The reported bug: many identical utility-class buttons, one with a stable testid.
  {
    const html = `
      ${Array.from({ length: 20 }, () => '<button class="flex items-center justify-center">Go</button>').join("")}
      <button class="flex items-center justify-center" data-testid="checkout">Go</button>`;
    const action = await capture(html, (p) => p.getByTestId("checkout").click());
    check("prefers data-testid over ambiguous role/text", action?.locator?.strategy === "testId", action?.locator?.value);
    check("testid locator is unique", action?.locator?.quality?.isUnique === true, JSON.stringify(action?.locator?.quality));
    check("never emits the generic class selector", !UTILITY_CLASS.test(action?.locator?.value ?? ""), action?.locator?.value);
  }

  // 3. Multiple similar buttons; the target sits under a stable ancestor id → scoped/unique.
  {
    const html = `
      <div><button class="flex">Add</button></div>
      <div id="cart"><button class="flex">Add</button></div>
      <div><button class="flex">Add</button></div>`;
    const action = await capture(html, (p) => p.locator("#cart button").click());
    check("finds a unique locator for a repeated label", action?.locator?.quality?.isUnique === true, JSON.stringify(action?.locator?.quality));
    check("does not save utility-class-only selector", !UTILITY_CLASS.test(action?.locator?.value ?? ""), action?.locator?.value);
  }

  // 4. No stable attributes anywhere → positional fallback, flagged fragile (low confidence).
  {
    const html = `<main><div><p>alpha</p></div><div><p>beta</p></div></main>`;
    const action = await capture(html, (p) => p.locator("p", { hasText: "beta" }).click());
    const quality = action?.locator?.quality;
    check("fallback locator still resolves to one element", quality?.matchCount === 1, JSON.stringify(quality));
    check("fallback flagged as fragile (low confidence or fallback strategy)", quality?.confidence === "low" || quality?.strategy === "fallback", JSON.stringify(quality));
  }

  // 4b. Regression: a deeply-nested attribute-less <svg> repeated across identical sibling
  // subtrees. The old fallback emitted a floating child-chain (`div > div > … > svg`) that
  // matched every subtree; the serial structural path must resolve to exactly one element.
  {
    const cell = (n: number) => `<div><div><div><div></div><div></div><div><div></div><div></div><div><svg data-n="${n}"><path d="M0 0"/></svg></div></div></div></div></div>`;
    const html = `<section>${Array.from({ length: 6 }, (_, i) => cell(i)).join("")}</section>`;
    const action = await capture(html, (p) => p.locator('svg[data-n="3"]').click());
    const quality = action?.locator?.quality;
    check("repeated nested svg → fallback resolves to one element", quality?.matchCount === 1, JSON.stringify(quality));
    check("repeated nested svg → locator marked unique", quality?.isUnique === true, action?.locator?.value);
  }

  // 5. Fill an email input with a placeholder → semantic placeholder/label locator, unique.
  {
    const html = `<form><label for="e">Email</label><input id="e" type="email" placeholder="you@example.com" /></form>`;
    const action = await capture(html, async (p) => {
      await p.getByPlaceholder("you@example.com").fill("me@test.dev");
      await p.getByPlaceholder("you@example.com").blur(); // 'change' fires on blur
    });
    check("fill records a fill action", action?.type === "fill", action?.type);
    check("fill uses a semantic locator (role/label/placeholder/id)", ["role", "label", "placeholder", "id"].includes(action?.locator?.strategy ?? ""), action?.locator?.strategy);
    check("fill locator is unique", action?.locator?.quality?.isUnique === true, JSON.stringify(action?.locator?.quality));
    check("fill value captured", action?.valueSource?.value === "me@test.dev", action?.valueSource?.value);
  }

  // 6. Password field value is never stored in the recorded flow.
  {
    const html = `<form><label for="pw">Password</label><input id="pw" type="password" /></form>`;
    const action = await capture(html, async (p) => {
      await p.locator("#pw").fill("s3cret-value");
      await p.locator("#pw").blur(); // 'change' fires on blur
    });
    check("password fill still records a step", action?.type === "fill", action?.type);
    check("password value is masked (not stored)", (action?.valueSource?.value ?? "") === "", JSON.stringify(action?.valueSource));
  }

  // 6a. Secret-shaped field NAMES are redacted in the two dominant naming conventions.
  //
  // Regression for REC-007/AWKIT-REC-002: the sensitive-field pattern anchors several terms with
  // \b, but a word boundary requires a NON-word character — and both `apiToken` (camelCase) and
  // `api_token` (snake_case) put a word character immediately before the term. `\btoken\b` matched
  // neither, so some of the commonest secret field names on the web were silently exempt. The
  // non-sensitive controls at the end must stay UNREDACTED, or the fix would just be over-matching.
  {
    const redacted: [string, string][] = [
      ["apiToken", "CANARY-A"],
      ["api_token", "CANARY-B"],
      ["accessToken", "CANARY-C"],
      ["clientSecret", "CANARY-D"],
      ["client_secret", "CANARY-E"],
      ["devicePin", "CANARY-F"],
      ["userSsn", "CANARY-G"],
      ["cardCvv", "CANARY-H"]
    ];
    for (const [name, value] of redacted) {
      const html = `<form><label for="f">Field</label><input id="f" name="${name}" type="text" /></form>`;
      const action = await capture(html, async (p) => {
        await p.locator("#f").fill(value);
        await p.locator("#f").blur();
      });
      check(`sensitive field name "${name}" records a step`, action?.type === "fill", action?.type);
      check(`sensitive field name "${name}" is redacted`, (action?.valueSource?.value ?? "") === "", JSON.stringify(action?.valueSource));
    }
    for (const name of ["displayName", "shippingAddress", "tokenizer_label"]) {
      const html = `<form><label for="f">Field</label><input id="f" name="${name}" type="text" /></form>`;
      const action = await capture(html, async (p) => {
        await p.locator("#f").fill("ordinary value");
        await p.locator("#f").blur();
      });
      check(`ordinary field name "${name}" is NOT redacted`, action?.valueSource?.value === "ordinary value", JSON.stringify(action?.valueSource));
    }
  }

  // 6b. Live text capture: text typed WITHOUT blurring the field is still recorded. This is the
  // regression the 'input'-event handler fixes — 'change' alone only fires on blur.
  {
    const html = `<form><label for="live">Name</label><input id="live" type="text" /></form>`;
    const action = await capture(html, async (p) => {
      await p.locator("#live").focus();
      await p.locator("#live").pressSequentially("Marcel", { delay: 5 });
      // Intentionally no blur — proves the 'input' handler captures live, not just 'change'.
    });
    check("live typing (no blur) records a fill", action?.type === "fill", action?.type);
    check("live typing captures the typed value", action?.valueSource?.value === "Marcel", action?.valueSource?.value);
  }

  console.log("Part B — Runner non-unique locator safeguard");
  const ctx = await makeContext();

  // 7. A step saved as non-unique fails fast with a friendly message (no raw strict-mode error).
  {
    await page.setContent(`<button class="flex">Go</button><button class="flex">Go</button>`);
    const exec = new StepExecutor(page, new LocatorFactory(page), new ValueResolver(ctx), ctx);
    const step: FlowStep = {
      id: "s1",
      type: "click",
      name: "Click Go",
      locator: { strategy: "css", value: "button.flex", quality: { strategy: "css", isUnique: false, matchCount: 2, confidence: "low" } }
    };
    const result = await exec.execute(step);
    check("non-unique step fails (not passed)", result.status === "failed", result.status);
    check("friendly error mentions multiple elements", /matches 2 elements/i.test(result.error ?? ""), result.error);
    check("friendly error is not a raw strict-mode dump", !/strict mode violation/i.test(result.error ?? ""), result.error);
  }

  // 8. A locator that becomes ambiguous at run time yields a translated, friendly error.
  {
    await page.setContent(`<button class="flex">Go</button><button class="flex">Go</button>`);
    const exec = new StepExecutor(page, new LocatorFactory(page), new ValueResolver(ctx), ctx);
    const step: FlowStep = { id: "s2", type: "click", name: "Click Go", locator: { strategy: "css", value: "button.flex" } };
    const result = await exec.execute(step);
    check("ambiguous runtime click fails", result.status === "failed", result.status);
    check("strict-mode error translated to friendly message", /matched multiple elements/i.test(result.error ?? ""), result.error);
  }

  // 9. Unapproved positional fallback now EXECUTES for a NON-sensitive step: the recorder builds nested
  //    selectors until unique, so a last-resort positional locator is resolved, not an approval prompt.
  //    (Sensitive steps stay gated without an identity guard — covered by the recorder-ambiguity verifier.)
  {
    await page.setContent(`<button class="flex" onclick="window.__hit='pos-go'">Go</button>`);
    await page.evaluate(() => { (window as unknown as { __hit?: string }).__hit = ""; });
    const exec = new StepExecutor(page, new LocatorFactory(page), new ValueResolver(ctx), ctx);
    const step: FlowStep = {
      id: "s3",
      type: "click",
      name: "Click Go",
      locator: {
        strategy: "css",
        value: "button >> nth=0",
        quality: { strategy: "fallback", isUnique: true, matchCount: 1, confidence: "low" }
      }
    };
    const result = await exec.execute(step);
    check("unapproved positional fallback (non-sensitive) executes without approval", result.status === "passed", result.error || result.status);
    check("unapproved positional fallback actually clicked the target", (await page.evaluate(() => (window as unknown as { __hit?: string }).__hit)) === "pos-go");
  }

  // 10. Approved positional fallback on non-dangerous step passes.
  {
    await page.setContent(`<button class="flex" onclick="window.__hit='pos'">Go</button>`);
    const exec = new StepExecutor(page, new LocatorFactory(page), new ValueResolver(ctx), ctx);
    const step = approveFallback({
      id: "s4",
      type: "click",
      name: "Click Go",
      locator: {
        strategy: "css",
        value: "button.flex",
        quality: { strategy: "fallback", isUnique: true, matchCount: 1, confidence: "low" },
      }
    });
    const result = await exec.execute(step);
    check("approved positional fallback on non-dangerous step passes", result.status === "passed", result.error || result.status);
  }

  // 11. Approved positional fallback on dangerous step still fails (absolute guard).
  {
    await page.setContent(`<input type="text">`);
    const exec = new StepExecutor(page, new LocatorFactory(page), new ValueResolver(ctx), ctx);
    const step = approveFallback({
      id: "s5",
      type: "click",
      name: "Click Delete",
      locator: {
        strategy: "css",
        value: "input",
        quality: { strategy: "fallback", isUnique: true, matchCount: 1, confidence: "low" },
      }
    });
    const result = await exec.execute(step);
    check("approved positional fallback on dangerous step still fails", result.status === "failed", result.status);
    check("dangerous step error mentions sensitive action", /performs a sensitive action/i.test(result.error ?? ""), result.error);
  }

  // Drag-and-drop: the runner executes a `drag` step by resolving BOTH the source and the drop target
  // and performing a native drag. Exercises StepExecutor's `drag` case end-to-end (awkit-dat).
  {
    await page.setContent(`
      <div id="src" draggable="true" style="padding:8px">Card</div>
      <div id="zone" style="padding:24px">Zone</div>
      <script>
        var z = document.getElementById('zone');
        z.addEventListener('dragover', function (e) { e.preventDefault(); });
        z.addEventListener('drop', function (e) { e.preventDefault(); window.__dropped = 'src->zone'; });
      </script>`);
    await page.evaluate(() => { (window as unknown as { __dropped?: string }).__dropped = ""; });
    const exec = new StepExecutor(page, new LocatorFactory(page), new ValueResolver(ctx), ctx);
    const dragStep: FlowStep = {
      id: "s-drag",
      type: "drag",
      name: "Drag Card to Zone",
      locator: { strategy: "css", value: "#src", quality: { strategy: "css", isUnique: true, matchCount: 1, confidence: "high" } },
      targetLocator: { strategy: "css", value: "#zone", quality: { strategy: "css", isUnique: true, matchCount: 1, confidence: "high" } }
    };
    const dragResult = await exec.execute(dragStep);
    check("drag: StepExecutor resolves source + target and performs the drop", dragResult.status === "passed", dragResult.error || dragResult.status);
    check("drag: the drop actually fired on the target", (await page.evaluate(() => (window as unknown as { __dropped?: string }).__dropped)) === "src->zone");

    const noTarget: FlowStep = {
      id: "s-drag-2",
      type: "drag",
      name: "Drag with no target",
      locator: { strategy: "css", value: "#src", quality: { strategy: "css", isUnique: true, matchCount: 1, confidence: "high" } }
    };
    const noTargetResult = await exec.execute(noTarget);
    check("drag: a step with no targetLocator fails (never a silent pass)", noTargetResult.status === "failed", noTargetResult.status);
    check("drag: the failure names the missing drop target", /targetlocator|drop target/i.test(noTargetResult.error ?? ""), noTargetResult.error);
  }

  // Pointer-emulated sortable replay: a `drag` step must move the CORRECT item on a list that uses
  // pointer events only (no native draggable) — proving the runner's dragTo drives a react-dnd/dnd-kit/
  // SortableJS-style widget (awkit-3g6 Part 3).
  {
    await page.setContent(`
      <ul id="plist" style="list-style:none;padding:0;max-width:220px">
        <li id="pi-a" data-item="a" style="user-select:none;padding:10px;margin:4px 0;border:1px solid #ccc">Alpha</li>
        <li id="pi-b" data-item="b" style="user-select:none;padding:10px;margin:4px 0;border:1px solid #ccc">Bravo</li>
      </ul>
      <output id="porder">a,b</output>
      <script>
        var list=document.getElementById('plist'),out=document.getElementById('porder'),dragging=null,moved=false,sx=0,sy=0;
        list.addEventListener('pointerdown',function(e){if(e.button!==0)return;var it=e.target.closest('li');if(!it)return;dragging=it;moved=false;sx=e.clientX;sy=e.clientY;try{it.setPointerCapture(e.pointerId);}catch(x){}});
        list.addEventListener('pointermove',function(e){if(!dragging)return;var dx=e.clientX-sx,dy=e.clientY-sy;if(dx*dx+dy*dy>64)moved=true;});
        list.addEventListener('pointerup',function(e){var s=dragging;dragging=null;if(!s||!moved)return;var over=document.elementFromPoint(e.clientX,e.clientY);var t=over&&over.closest?over.closest('li'):null;if(!t||t===s)return;list.insertBefore(s,t);var ids=[];list.querySelectorAll('li').forEach(function(li){ids.push(li.getAttribute('data-item'));});out.textContent=ids.join(',');});
      </script>`);
    const exec = new StepExecutor(page, new LocatorFactory(page), new ValueResolver(ctx), ctx);
    const pointerDragStep: FlowStep = {
      id: "s-pdrag",
      type: "drag",
      name: "Drag Bravo onto Alpha",
      locator: { strategy: "css", value: "#pi-b", quality: { strategy: "css", isUnique: true, matchCount: 1, confidence: "high" } },
      targetLocator: { strategy: "css", value: "#pi-a", quality: { strategy: "css", isUnique: true, matchCount: 1, confidence: "high" } }
    };
    const pointerResult = await exec.execute(pointerDragStep);
    check("pointer sortable: StepExecutor replays the drag (dragTo drives pointer events)", pointerResult.status === "passed", pointerResult.error || pointerResult.status);
    check("pointer sortable: replay moved the CORRECT item (b before a → b,a)", (await page.evaluate(() => document.getElementById("porder")?.textContent)) === "b,a");
  }

  console.log("Part C — Runner fallback resolution (alternatives, visibility, context scoping)");

  // Run one step against `html` and return the execution result + the id of the element the
  // click/check landed on (candidate elements set `window.__hit` via onclick).
  async function run(html: string, step: FlowStep): Promise<{ status: string; error?: string; hit: string | null }> {
    await page.setContent(html);
    // setContent rewrites the document but keeps the SAME window, so `__hit` survives between
    // cases. Without this reset a step that never fires its handler reads the previous case's
    // value and the assertion passes on stale state.
    await page.evaluate(() => { delete (window as unknown as { __hit?: string }).__hit; });
    const exec = new StepExecutor(page, new LocatorFactory(page), new ValueResolver(ctx), ctx);
    const result = await exec.execute(step);
    const hit = (await page.evaluate(() => (window as unknown as { __hit?: string }).__hit ?? null)) as string | null;
    return { status: result.status, error: result.error, hit };
  }

  // C1. Duplicate modal (hidden template + visible modal), repeated label → visible dialog wins.
  {
    const html = `
      <div id="exampleModal" style="display:none">
        <label><input type="checkbox" data-k="hidden"> Allow notifications</label>
      </div>
      <div id="exampleModal">
        <label><input type="checkbox" data-k="visible"> Allow notifications</label>
      </div>`;
    const step: FlowStep = {
      id: "c1",
      type: "check",
      name: "Check Allow notifications",
      locator: {
        strategy: "role",
        value: "checkbox",
        name: "Allow notifications",
        exact: false,
        quality: { strategy: "role", isUnique: false, matchCount: 2, confidence: "low" },
        context: { container: { type: "dialog", strategy: "id", value: "exampleModal", visibleOnly: true } }
      }
    };
    const { status } = await run(html, step);
    check("duplicate modal: non-unique-but-scoped step passes", status === "passed", status);
    check("duplicate modal: the VISIBLE checkbox got checked", await page.locator('input[data-k="visible"]').isChecked(), "visible not checked");
    check("duplicate modal: the hidden checkbox stayed unchecked", !(await page.locator('input[data-k="hidden"]').isChecked()), "hidden was checked");
  }

  // C2. No container, primary matches 2 but only one is visible → visibility disambiguation.
  {
    const html = `<button class="act" data-k="hidden" style="display:none" onclick="window.__hit='hidden'">X</button>
                  <button class="act" data-k="vis" onclick="window.__hit='vis'">X</button>`;
    const step: FlowStep = { id: "c2", type: "click", name: "Click X", locator: { strategy: "css", value: "button.act" } };
    const { status, hit } = await run(html, step);
    check("visibility fallback: ambiguous-but-one-visible click passes", status === "passed", status);
    check("visibility fallback: clicked the visible button", hit === "vis", hit ?? "null");
  }

  // C3. Table row action button scoped by row text.
  {
    const html = `<table><tbody>
      <tr><td>Customer ABC</td><td><button onclick="window.__hit='abc'">Edit</button></td></tr>
      <tr><td>Customer XYZ</td><td><button onclick="window.__hit='xyz'">Edit</button></td></tr>
    </tbody></table>`;
    const step: FlowStep = {
      id: "c3",
      type: "click",
      name: "Click Edit",
      locator: {
        strategy: "role",
        value: "button",
        name: "Edit",
        exact: true,
        context: { container: { type: "tableRow", strategy: "role", value: "row", name: "Customer ABC", exact: false } }
      }
    };
    const { status, hit } = await run(html, step);
    check("table row: row-scoped Edit click passes", status === "passed", status);
    check("table row: clicked the ABC row's Edit button", hit === "abc", hit ?? "null");
  }

  // C4. Repeated card action button scoped by card text (hasText).
  {
    const html = `
      <div data-testid="workflow-card"><span>Flow A</span><button onclick="window.__hit='A'">Run</button></div>
      <div data-testid="workflow-card"><span>Flow B</span><button onclick="window.__hit='B'">Run</button></div>`;
    const step: FlowStep = {
      id: "c4",
      type: "click",
      name: "Click Run",
      locator: {
        strategy: "role",
        value: "button",
        name: "Run",
        exact: true,
        context: { container: { type: "card", strategy: "testId", value: "workflow-card", hasText: "Flow B" } }
      }
    };
    const { status, hit } = await run(html, step);
    check("repeated card: card-scoped Run click passes", status === "passed", status);
    check("repeated card: clicked Flow B's Run button", hit === "B", hit ?? "null");
  }

  // C5. Primary absent → ranked alternative resolves.
  {
    const html = `<button data-testid="real" onclick="window.__hit='real'">Go</button>`;
    const step: FlowStep = {
      id: "c5",
      type: "click",
      name: "Click Go",
      locator: { strategy: "role", value: "button", name: "Nonexistent", exact: true, alternatives: [{ strategy: "testId", value: "real" }] }
    };
    const { status, hit } = await run(html, step);
    check("alternative fallback: absent primary falls back to alternative", status === "passed", status);
    check("alternative fallback: clicked via the alternative locator", hit === "real", hit ?? "null");
  }

  // C6. iframe target resolved via frame context.
  {
    const html = `<iframe name="pay" srcdoc="<input type='checkbox' aria-label='agree'>"></iframe>`;
    const step: FlowStep = {
      id: "c6",
      type: "check",
      name: "Check agree",
      locator: { strategy: "role", value: "checkbox", name: "agree", exact: false, context: { frame: { selector: 'iframe[name="pay"]' } } }
    };
    const { status } = await run(html, step);
    check("iframe: frame-scoped check passes", status === "passed", status);
    check(
      "iframe: the checkbox inside the frame is checked",
      await page.frameLocator('iframe[name="pay"]').getByRole("checkbox", { name: "agree" }).isChecked(),
      "frame checkbox not checked"
    );
  }

  // C7. Backward compatibility: a legacy locator (no alternatives/context/quality) still resolves.
  {
    const html = `<button id="only" onclick="window.__hit='only'">Go</button>`;
    const step: FlowStep = { id: "c7", type: "click", name: "Click Go", locator: { strategy: "id", value: "only" } };
    const { status, hit } = await run(html, step);
    check("backward compat: legacy unique locator still resolves", status === "passed", status);
    check("backward compat: clicked the expected element", hit === "only", hit ?? "null");
  }

  console.log("Part CR — Recorder compound/container disambiguation for non-unique elements");

  // CR1. The reported bug: two checkboxes sharing role + accessible name, distinguished ONLY by a
  // stable container. The recorder must find a unique locator (container-scoped or compound) and the
  // runner must check exactly the intended one.
  {
    const html = `
      <div data-testid="pkg-a"><label><input type="checkbox" data-k="a" aria-label="0796713928"> Pick</label></div>
      <div data-testid="pkg-b"><label><input type="checkbox" data-k="b" aria-label="0796713928"> Pick</label></div>`;
    const action = await capture(html, (p) => p.locator('[data-testid="pkg-b"] input').check());
    const quality = action?.locator?.quality;
    check("dup role+name: recorder finds a UNIQUE locator (no warning)", quality?.isUnique === true, JSON.stringify(action?.locator));
    check("dup role+name: matchCount === 1", quality?.matchCount === 1, JSON.stringify(quality));
    check("dup role+name: not a utility-class selector", !UTILITY_CLASS.test(action?.locator?.value ?? ""), action?.locator?.value);
    check("dup role+name: disambiguation is container or compound", quality?.disambiguation === "container" || quality?.disambiguation === "compound", JSON.stringify(quality));

    await page.setContent(html);
    const exec = new StepExecutor(page, new LocatorFactory(page), new ValueResolver(ctx), ctx);
    const result = await exec.execute({ id: "cr1", type: "check", name: action?.name ?? "Check", locator: action?.locator as unknown as FlowStep["locator"] });
    check("dup role+name: recorded locator runs green", result.status === "passed", result.error ?? result.status);
    check("dup role+name: checked the intended (pkg-b) checkbox", await page.locator('[data-testid="pkg-b"] input').isChecked(), "pkg-b not checked");
    check("dup role+name: left pkg-a unchecked", !(await page.locator('[data-testid="pkg-a"] input').isChecked()), "pkg-a was checked");
  }

  // CR1b. Neither stable ancestor works alone: each outer section contains two Confirm buttons,
  // and the same named card exists in both sections. Outer -> inner is therefore load-bearing.
  {
    const html = `
      <section data-testid="nested-scope-a">
        <div data-testid="nested-action-card">Primary <button onclick="window.__hit='a-primary'">Confirm</button></div>
        <div data-testid="nested-action-card">Secondary <button onclick="window.__hit='a-secondary'">Confirm</button></div>
      </section>
      <section data-testid="nested-scope-b">
        <div data-testid="nested-action-card">Primary <button onclick="window.__hit='b-primary'">Confirm</button></div>
        <div data-testid="nested-action-card">Secondary <button onclick="window.__hit='b-secondary'">Confirm</button></div>
      </section>`;
    const action = await capture(html, (p) => p.locator('[data-testid="nested-scope-b"] [data-testid="nested-action-card"]').filter({ hasText: "Primary" }).getByRole("button", { name: "Confirm" }).click());
    const chain = action?.locator?.context?.containers as Array<{ type?: string; value?: string }> | undefined;
    check("nested containers: exactly two outer-to-inner segments captured", chain?.length === 2, JSON.stringify(action?.locator?.context));
    check("nested containers: outer segment is the selected section", chain?.[0]?.value === "nested-scope-b", JSON.stringify(chain));
    check("nested containers: inner segment is the repeated action card", chain?.[1]?.value === "nested-action-card", JSON.stringify(chain));
    check("nested containers: capture proves the final locator unique", action?.locator?.quality?.isUnique === true && action.locator.quality.matchCount === 1, JSON.stringify(action?.locator));

    const step: FlowStep = {
      id: "cr1b",
      type: "click",
      name: "Click Confirm",
      locator: JSON.parse(JSON.stringify(action?.locator ?? null)) as FlowStep["locator"]
    };
    const replay = await run(html, step);
    check("nested containers: chain replays green", replay.status === "passed", replay.error ?? replay.status);
    check("nested containers: replay reaches the originally clicked element", replay.hit === "b-primary", replay.hit ?? "null");

    const withoutOuter: FlowStep = {
      ...step,
      id: "cr1b-negative",
      locator: { ...step.locator!, context: { containers: chain?.slice(1) as LocatorContainerContext[] } }
    };
    const negative = await run(html, withoutOuter);
    check("nested containers negative: removing one required segment fails", negative.status !== "passed", negative.status);

    const overBound: FlowStep = {
      ...step,
      id: "cr1b-bound",
      locator: { ...step.locator!, context: { containers: [...(step.locator?.context?.containers ?? []), ...(step.locator?.context?.containers ?? [])] } }
    };
    const boundResult = await run(html, overBound);
    check("nested containers: runtime rejects a chain longer than three", boundResult.status !== "passed" && /3-segment bound/.test(boundResult.error ?? ""), boundResult.error);

    // CR1e. The SAME recorded chain must survive the sections being reordered in the DOM. A chain
    // that quietly depended on document order would still pass CR1b and fail only here.
    const reordered = `
      <section data-testid="nested-scope-b">
        <div data-testid="nested-action-card">Secondary <button onclick="window.__hit='b-secondary'">Confirm</button></div>
        <div data-testid="nested-action-card">Primary <button onclick="window.__hit='b-primary'">Confirm</button></div>
      </section>
      <section data-testid="nested-scope-a">
        <div data-testid="nested-action-card">Primary <button onclick="window.__hit='a-primary'">Confirm</button></div>
        <div data-testid="nested-action-card">Secondary <button onclick="window.__hit='a-secondary'">Confirm</button></div>
      </section>`;
    const reorderedReplay = await run(reordered, { ...step, id: "cr1e" });
    check("nested containers: the chain replays green after a DOM reorder", reorderedReplay.status === "passed", reorderedReplay.error ?? reorderedReplay.status);
    check("nested containers: the reordered replay still hits the original element", reorderedReplay.hit === "b-primary", reorderedReplay.hit ?? "null");
  }

  // CR1f. Frame + nested chain: buildRoot must enter the frame FIRST, then fold the chain inside it.
  // Decoy twins outside the frame prove the frame segment is load-bearing.
  {
    // The handlers write to parent.__hit: the button lives in the iframe, so `window.__hit` there
    // would be the FRAME's window and the top-level assertion would never see it.
    const inner = "<section data-testid='f-region'><div data-testid='f-card'>Primary <button onclick=\"parent.__hit='frame-primary'\">Approve</button></div><div data-testid='f-card'>Secondary <button onclick=\"parent.__hit='frame-secondary'\">Approve</button></div></section>";
    const html = `
      <section data-testid="f-region"><div data-testid="f-card">Primary <button onclick="window.__hit='outer-decoy'">Approve</button></div></section>
      <iframe name="scoped" srcdoc="${inner.replace(/"/g, "&quot;")}"></iframe>`;
    const step: FlowStep = {
      id: "cr1f",
      type: "click",
      name: "Approve",
      locator: {
        strategy: "role",
        value: "button",
        name: "Approve",
        exact: false,
        context: {
          frame: { selector: 'iframe[name="scoped"]' },
          containers: [
            { type: "section", strategy: "testId", value: "f-region" },
            { type: "card", strategy: "testId", value: "f-card", hasText: "Primary" }
          ]
        }
      }
    };
    const result = await run(html, step);
    check("frame + chain: replays green", result.status === "passed", result.error ?? result.status);
    check("frame + chain: resolves inside the frame, not the outer decoy", result.hit === "frame-primary", result.hit ?? "null");

    const withoutFrame = await run(html, { ...step, id: "cr1f-neg", locator: { ...step.locator!, context: { containers: step.locator!.context!.containers } } });
    check("frame + chain negative: dropping the frame segment stops resolving the framed element", withoutFrame.hit !== "frame-primary", withoutFrame.hit ?? withoutFrame.status);
  }

  // CR1g. Open shadow host chain + nested container chain inside the shadow root.
  {
    const html = `
      <script>
        if(!customElements.get('x-scope-host')) customElements.define('x-scope-host', class extends HTMLElement {
          connectedCallback(){ if(this.shadowRoot) return; const r=this.attachShadow({mode:'open'});
            r.innerHTML = "<section data-testid='s-region'><div data-testid='s-card'>Primary <button type='button'>Approve</button></div><div data-testid='s-card'>Secondary <button type='button'>Approve</button></div></section>";
            var host = this.getAttribute('data-testid');
            r.querySelectorAll('[data-testid=s-card]').forEach(function(card){ card.querySelector('button').onclick = function(){ window.__hit = host + '-' + card.textContent.trim().split(' ')[0].toLowerCase(); }; });
          }
        });
      </script>
      <section data-testid="s-region"><div data-testid="s-card">Primary <button type="button" onclick="window.__hit='light-decoy'">Approve</button></div></section>
      <x-scope-host data-testid="scope-host-a"></x-scope-host>
      <x-scope-host data-testid="scope-host-b"></x-scope-host>`;
    const step: FlowStep = {
      id: "cr1g",
      type: "click",
      name: "Approve",
      locator: {
        strategy: "role",
        value: "button",
        name: "Approve",
        exact: false,
        context: {
          shadow: { boundary: "open", hosts: [{ strategy: "testId", value: "scope-host-b" }] },
          containers: [
            { type: "section", strategy: "testId", value: "s-region" },
            { type: "card", strategy: "testId", value: "s-card", hasText: "Primary" }
          ]
        }
      }
    };
    const result = await run(html, step);
    check("shadow + chain: replays green", result.status === "passed", result.error ?? result.status);
    check("shadow + chain: resolves inside the named host, not the light-DOM decoy", result.hit === "scope-host-b-primary", result.hit ?? "null");

    // Playwright's locators PIERCE open shadow roots, so omitting the host chain does not stop
    // resolution — the honest proof that the host segment is applied is that naming a different
    // host selects a different element, with the chain held constant.
    const otherHost = await run(html, {
      ...step,
      id: "cr1g-alt",
      locator: { ...step.locator!, context: { ...step.locator!.context!, shadow: { boundary: "open", hosts: [{ strategy: "testId", value: "scope-host-a" }] } } }
    });
    check("shadow + chain: naming the other host selects that host's element", otherHost.hit === "scope-host-a-primary", otherHost.hit ?? otherHost.status);
  }

  // CR2. Repeated cards distinguished only by a meaningful per-card class (no id/testid/role
  // container) → a compound CSS selector that combines the class with structure, never a utility
  // class, resolving to exactly the intended element.
  {
    const html = `
      <section>
        <div class="card card-alpha"><button class="buy" onclick="window.__hit='alpha'">Add</button></div>
        <div class="card card-beta"><button class="buy" onclick="window.__hit='beta'">Add</button></div>
      </section>`;
    const action = await capture(html, (p) => p.locator(".card-beta button").click());
    const quality = action?.locator?.quality;
    check("repeated cards: unique locator", quality?.isUnique === true, JSON.stringify(action?.locator));
    check("repeated cards: compound CSS (not utility-only)", action?.locator?.strategy === "css" && !UTILITY_CLASS.test(action?.locator?.value ?? ""), JSON.stringify(action?.locator));
    check("repeated cards: uses the meaningful per-card class", /card-beta/.test(action?.locator?.value ?? ""), action?.locator?.value);
    const { status, hit } = await run(html, { id: "cr2", type: "click", name: "Click Add", locator: action?.locator as unknown as FlowStep["locator"] });
    check("repeated cards: recorded locator runs green", status === "passed", status);
    check("repeated cards: clicked Beta's Add button", hit === "beta", hit ?? "null");
  }

  // CR5. Landmark twins: two identical links distinguished only by their semantic landmark ancestor's accessible name.
  // The recorder must discover a container strategy that scopes by landmark role+name.
  {
    const html = `
      <nav aria-label="Side navigation"><a href="/s" class="twin" onclick="window.__hit='side'; return false;">Shorts</a></nav>
      <nav aria-label="Footer navigation"><a href="/s" class="twin" onclick="window.__hit='footer'; return false;">Shorts</a></nav>
    `;
    const action = await capture(html, (p) => p.locator('nav[aria-label="Footer navigation"] a').click());
    const quality = action?.locator?.quality;
    check("landmark twins: unique locator generated", quality?.isUnique === true, JSON.stringify(action?.locator));
    check("landmark twins: disambiguated by container or compound", quality?.disambiguation === "container" || quality?.disambiguation === "compound", JSON.stringify(quality));
    
    const { status, hit } = await run(html, { id: "cr5", type: "click", name: "Click Shorts", locator: action?.locator as unknown as FlowStep["locator"] });
    check("landmark twins: recorded locator runs green", status === "passed", status);
    check("landmark twins: clicked the link in footer", hit === "footer", hit ?? "null");
  }

  // CR6. Table-row container name (awkit-bw9). The recorder must CAPTURE a row-scoped locator that
  // REPLAYS. Raw `row.textContent` concatenates adjacent cells with no separator ("Customer BetaEdit"),
  // which never matches `getByRole('row',{name})` (accessible name "Customer Beta Edit"). Each case
  // captures the click, saves/reloads (JSON), and replays on a fresh page.
  const rtLocator = (a: RecordedAction | undefined) => JSON.parse(JSON.stringify(a?.locator ?? null)) as unknown as FlowStep["locator"];
  // CR6a. Adjacent cells (no source whitespace) + a row containing an interactive child.
  {
    const html = `<table><tbody>` +
      `<tr><td>Customer Alpha</td><td><button onclick="window.__hit='alpha'">Edit</button></td></tr>` +
      `<tr><td>Customer Beta</td><td><button onclick="window.__hit='beta'">Edit</button></td></tr>` +
      `</tbody></table>`;
    const action = await capture(html, (p) => p.getByRole("row", { name: /Customer Beta/ }).getByRole("button", { name: "Edit" }).click());
    const container = (action?.locator?.context as { container?: { type?: string; name?: string } } | undefined)?.container;
    check("bw9: captured a tableRow container context", container?.type === "tableRow", JSON.stringify(action?.locator?.context));
    check(
      "bw9: adjacent cells are separated in the captured row name (not 'BetaEdit')",
      typeof container?.name === "string" && !/BetaEdit/.test(container.name) && /Beta\s+Edit/.test(container.name),
      container?.name
    );
    const { status, hit } = await run(html, { id: "cr6a", type: "click", name: "Click Edit", locator: rtLocator(action) });
    check("bw9: captured row-scoped locator replays green (save/reload)", status === "passed", status);
    check("bw9: replay selected the intended (Beta) row", hit === "beta", hit ?? "null");
    // Negative control: the OLD no-space serialized row name must FAIL to replay.
    const broken: FlowStep = {
      id: "cr6a-neg",
      type: "click",
      name: "Click Edit",
      timeoutMs: 2500,
      locator: { strategy: "role", value: "button", name: "Edit", exact: true, context: { container: { type: "tableRow", strategy: "role", value: "row", name: "Customer BetaEdit", exact: false } } }
    };
    const negRes = await run(html, broken);
    check("bw9 negative: the old no-space row name FAILS to replay", negRes.status !== "passed", negRes.status);
  }
  // CR6b. Extra whitespace / line breaks in cells → normalized to single spaces, still replays.
  {
    const html = `<table><tbody>` +
      `<tr><td>  Order\n  1001  </td><td><button onclick="window.__hit='o1001'">Edit</button></td></tr>` +
      `<tr><td>  Order\n  1002  </td><td><button onclick="window.__hit='o1002'">Edit</button></td></tr>` +
      `</tbody></table>`;
    const action = await capture(html, (p) => p.getByRole("row", { name: /Order\s+1002/ }).getByRole("button", { name: "Edit" }).click());
    const name = (action?.locator?.context as { container?: { name?: string } } | undefined)?.container?.name ?? "";
    check("bw9: whitespace/newlines normalized to single spaces", !/\s{2,}|\n/.test(name) && /Order 1002/.test(name), JSON.stringify(name));
    const { status, hit } = await run(html, { id: "cr6b", type: "click", name: "Click Edit", locator: rtLocator(action) });
    check("bw9: whitespace-normalized row replays green", status === "passed", status);
    check("bw9: whitespace case selected the 1002 row", hit === "o1002", hit ?? "null");
  }
  // CR6c. Two rows with partially overlapping text (one name is a prefix of the other).
  {
    const html = `<table><tbody>` +
      `<tr><td>Customer Beta</td><td><button onclick="window.__hit='beta'">Edit</button></td></tr>` +
      `<tr><td>Customer Beta Prime</td><td><button onclick="window.__hit='beta-prime'">Edit</button></td></tr>` +
      `</tbody></table>`;
    const action = await capture(html, (p) => p.getByRole("button", { name: "Edit" }).first().click());
    const { status, hit } = await run(html, { id: "cr6c", type: "click", name: "Click Edit", locator: rtLocator(action) });
    check("bw9: partial-overlap row replays green", status === "passed", status);
    check("bw9: selected exact Beta row, not Beta Prime", hit === "beta", hit ?? "null");
  }
  // CR6d. role=row / role=cell markup (not <table>) with an interactive child alongside a link.
  {
    const html = `<div role="table">` +
      `<div role="row"><div role="cell">Ticket 7</div><div role="cell"><a href="/t7">view</a></div><div role="cell"><button onclick="window.__hit='t7'">Edit</button></div></div>` +
      `<div role="row"><div role="cell">Ticket 8</div><div role="cell"><a href="/t8">view</a></div><div role="cell"><button onclick="window.__hit='t8'">Edit</button></div></div>` +
      `</div>`;
    const action = await capture(html, (p) => p.getByRole("row", { name: /Ticket 8/ }).getByRole("button", { name: "Edit" }).click());
    const { status, hit } = await run(html, { id: "cr6d", type: "click", name: "Click Edit", locator: rtLocator(action) });
    check("bw9: ARIA role=row with interactive children replays green", status === "passed", status);
    check("bw9: selected the Ticket 8 row", hit === "t8", hit ?? "null");
  }

  // CR7. href discrimination (Inc2 href-scoped strategy): two same-text links with different hrefs.
  {
    const html = `` +
      `<div><a href="/alpha" onclick="window.__hit='alpha'; return false;">Open</a></div>` +
      `<div><a href="/beta" onclick="window.__hit='beta'; return false;">Open</a></div>`;
    const action = await capture(html, (p) => p.locator('a[href="/beta"]').click());
    check("href twins: unique locator generated", action?.locator?.quality?.isUnique === true, JSON.stringify(action?.locator));
    check(
      "href twins: locator discriminates by href",
      /\/beta/.test(action?.locator?.value ?? "") || /\/beta/.test(JSON.stringify(action?.locator?.context ?? {})),
      JSON.stringify(action?.locator)
    );
    const { status, hit } = await run(html, { id: "cr7", type: "click", name: "Click Open", locator: rtLocator(action) });
    check("href twins: recorded locator runs green", status === "passed", status);
    check("href twins: clicked the /beta link", hit === "beta", hit ?? "null");
  }

  console.log("Part F — Shadow DOM capture, persistence, preflight, and replay (Increment 6)");

  const recordedFlowStep = (action: RecordedAction | undefined, id: string): FlowStep | undefined => {
    if (!action) return undefined;
    const flow = buildRecordedFlow("Shadow verification", [{ ...action, id } as any]);
    return flow.nodes.find((node) => node.type !== "start" && node.type !== "end");
  };

  // F1. composedPath selects the actual inner control; the normal role locator replays twice.
  {
    const html = `<x-shadow-unique data-testid="unique-shadow-host"></x-shadow-unique><script>
      if (!customElements.get('x-shadow-unique')) customElements.define('x-shadow-unique', class extends HTMLElement {
        connectedCallback(){ if(this.shadowRoot)return; const r=this.attachShadow({mode:'open'}); r.innerHTML='<button type="button">Unique shadow action</button>'; r.querySelector('button').onclick=()=>window.__hit='unique'; }
      });
    </script>`;
    const action = await capture(html, (p) => p.getByRole("button", { name: "Unique shadow action" }).click());
    const shadow = action?.locator?.context?.shadow;
    check("shadow open: composedPath records the inner button name", action?.name === "Click Unique shadow action", action?.name);
    check("shadow open: semantic role locator is primary", action?.locator?.strategy === "role" && action.locator.name === "Unique shadow action", JSON.stringify(action?.locator));
    check("shadow open: ordered host context is persisted", shadow?.boundary === "open" && shadow.hosts?.length === 1 && shadow.hosts[0]?.value === "unique-shadow-host", JSON.stringify(shadow));
    const step = JSON.parse(JSON.stringify(recordedFlowStep(action, "shadow-open"))) as FlowStep;
    const report = validateFlowDefinition(buildRecordedFlow("Shadow open", [{ ...action!, id: "shadow-open" } as any]));
    check("shadow open: flow passes static preflight", !hasActivePathError(report), JSON.stringify(executionBlockingErrorsOf(report)));
    const first = step ? await run(html, step) : { status: "missing", hit: null };
    const second = step ? await run(html, step) : { status: "missing", hit: null };
    check("shadow open: real StepExecutor replay succeeds on two fresh documents", first.status === "passed" && second.status === "passed", `${first.status}/${second.status}`);
    check("shadow open: both replays reach the internal control", first.hit === "unique" && second.hit === "unique", `${first.hit}/${second.hit}`);
  }

  // F2. Two identical inner controls are globally ambiguous; stable host scope selects host B.
  {
    const html = `<x-shadow-card data-testid="shadow-host-a" data-hit="a"></x-shadow-card><x-shadow-card data-testid="shadow-host-b" data-hit="b"></x-shadow-card><script>
      if (!customElements.get('x-shadow-card')) customElements.define('x-shadow-card', class extends HTMLElement {
        connectedCallback(){ if(this.shadowRoot)return; const r=this.attachShadow({mode:'open'}); r.innerHTML='<button type="button">Select</button>'; r.querySelector('button').onclick=()=>window.__hit=this.getAttribute('data-hit'); }
      });
    </script>`;
    const action = await capture(html, (p) => p.getByTestId("shadow-host-b").getByRole("button", { name: "Select" }).click());
    const shadow = action?.locator?.context?.shadow;
    check("shadow duplicate: unscoped role has two live matches", (await page.getByRole("button", { name: "Select" }).count()) === 2);
    check("shadow duplicate: stable host scope proves one target", action?.locator?.quality?.isUnique === true && action.locator.quality.disambiguation === "shadow", JSON.stringify(action?.locator));
    check("shadow duplicate: selected host B is retained", shadow?.hosts?.length === 1 && shadow.hosts[0]?.value === "shadow-host-b", JSON.stringify(shadow));
    const step = recordedFlowStep(action, "shadow-duplicate");
    const replay = step ? await run(html, JSON.parse(JSON.stringify(step))) : { status: "missing", hit: null };
    check("shadow duplicate: replay reaches selected host B", replay.status === "passed" && replay.hit === "b", `${replay.status}/${replay.hit}`);
    const corrupted = step ? JSON.parse(JSON.stringify(step)) as FlowStep : undefined;
    if (corrupted?.locator?.context) delete corrupted.locator.context.shadow;
    const negative = corrupted ? await run(html, corrupted) : { status: "missing" };
    check("shadow duplicate negative: dropping host context makes replay fail", negative.status === "failed", negative.status);
  }

  // F3. Nested roots keep outer→inner host order through JSON and replay.
  {
    const html = `<x-shadow-outer data-testid="nested-outer"></x-shadow-outer><script>
      if (!customElements.get('x-shadow-inner')) customElements.define('x-shadow-inner', class extends HTMLElement {
        connectedCallback(){ if(this.shadowRoot)return; const r=this.attachShadow({mode:'open'}); r.innerHTML='<button type="button">Nested action</button>'; r.querySelector('button').onclick=()=>window.__hit='nested'; }
      });
      if (!customElements.get('x-shadow-outer')) customElements.define('x-shadow-outer', class extends HTMLElement {
        connectedCallback(){ if(this.shadowRoot)return; const r=this.attachShadow({mode:'open'}); r.innerHTML='<x-shadow-inner data-testid="nested-inner"></x-shadow-inner>'; }
      });
    </script>`;
    const action = await capture(html, (p) => p.getByRole("button", { name: "Nested action" }).click());
    const step = recordedFlowStep(action, "shadow-nested");
    const roundTrip = step ? JSON.parse(JSON.stringify(step)) as FlowStep : undefined;
    const hosts = roundTrip?.locator?.context?.shadow?.hosts ?? [];
    check("shadow nested: complete outer→inner chain survives save/reload", hosts.length === 2 && hosts[0]?.value === "nested-outer" && hosts[1]?.value === "nested-inner", JSON.stringify(hosts));
    const replay = roundTrip ? await run(html, roundTrip) : { status: "missing", hit: null };
    check("shadow nested: replay reaches nested internal control", replay.status === "passed" && replay.hit === "nested", `${replay.status}/${replay.hit}`);
    check("shadow nested: no XPath candidate is promoted or persisted", !JSON.stringify(roundTrip).includes('"strategy":"xpath"'), JSON.stringify(roundTrip?.locator));
  }

  // F4. Internal test IDs remain eligible for the normal preferred strategy.
  {
    const html = `<x-shadow-testid data-testid="testid-host"></x-shadow-testid><script>
      if (!customElements.get('x-shadow-testid')) customElements.define('x-shadow-testid', class extends HTMLElement {
        connectedCallback(){ if(this.shadowRoot)return; const r=this.attachShadow({mode:'open'}); r.innerHTML='<button type="button" data-testid="internal-shadow-testid">Testid action</button>'; r.querySelector('button').onclick=()=>window.__hit='testid'; }
      });
    </script>`;
    const action = await capture(html, (p) => p.getByTestId("internal-shadow-testid").click());
    check("shadow testId: internal data-testid is primary", action?.locator?.strategy === "testId" && action.locator.value === "internal-shadow-testid", JSON.stringify(action?.locator));
    const step = recordedFlowStep(action, "shadow-testid");
    const replay = step ? await run(html, step) : { status: "missing", hit: null };
    check("shadow testId: normal StepExecutor replay succeeds", replay.status === "passed" && replay.hit === "testid", `${replay.status}/${replay.hit}`);
  }

  // F5. A root attached after page load is discovered by the bounded per-event root snapshot.
  {
    const html = `<button id="attach">Attach</button><div id="mount"></div><script>
      if (!customElements.get('x-shadow-dynamic')) customElements.define('x-shadow-dynamic', class extends HTMLElement {
        connectedCallback(){ if(this.shadowRoot)return; const r=this.attachShadow({mode:'open'}); r.innerHTML='<button type="button">Dynamic shadow action</button>'; r.querySelector('button').onclick=()=>window.__hit='dynamic'; }
      });
      document.getElementById('attach').onclick=()=>{ const h=document.createElement('x-shadow-dynamic'); h.setAttribute('data-testid','dynamic-shadow-host'); document.getElementById('mount').appendChild(h); };
    </script>`;
    const action = await capture(html, async (p) => { await p.locator("#attach").click(); await p.getByRole("button", { name: "Dynamic shadow action" }).click(); });
    check("shadow dynamic: late open root is classified open", action?.locator?.context?.shadow?.boundary === "open", JSON.stringify(action?.locator));
    check("shadow dynamic: late target remains resolved", action?.locator?.quality?.isUnique === true, JSON.stringify(action?.locator?.quality));
  }

  // F6. Slotted controls remain light-DOM targets, not inaccessible shadow internals.
  {
    const html = `<x-shadow-slot data-testid="slot-host"><button slot="control" data-testid="slotted-light">Slotted light action</button></x-shadow-slot><script>
      if (!customElements.get('x-shadow-slot')) customElements.define('x-shadow-slot', class extends HTMLElement { connectedCallback(){ if(!this.shadowRoot)this.attachShadow({mode:'open'}).innerHTML='<slot name="control"></slot>'; } });
      document.querySelector('[data-testid="slotted-light"]').onclick=()=>window.__hit='slotted';
    </script>`;
    const action = await capture(html, (p) => p.getByTestId("slotted-light").click());
    check("shadow slot: composedPath still selects the light-DOM button", action?.name === "Click Slotted light action", action?.name);
    check("shadow slot: no open-shadow execution scope is persisted", !action?.locator?.context?.shadow, JSON.stringify(action?.locator?.context));
    const step = recordedFlowStep(action, "shadow-slot");
    const replay = step ? await run(html, step) : { status: "missing", hit: null };
    check("shadow slot: legacy light-DOM replay stays compatible", replay.status === "passed" && replay.hit === "slotted", `${replay.status}/${replay.hit}`);
  }

  // F7. Ambiguous host context becomes review-required; no positional host guess is stored.
  {
    const html = `<x-shadow-amb class="ambiguous-host"></x-shadow-amb><x-shadow-amb class="ambiguous-host"></x-shadow-amb><script>
      if (!customElements.get('x-shadow-amb')) customElements.define('x-shadow-amb', class extends HTMLElement {
        connectedCallback(){ if(this.shadowRoot)return; const r=this.attachShadow({mode:'open'}); r.innerHTML='<button type="button">Ambiguous shadow action</button>'; }
      });
    </script>`;
    const action = await capture(html, (p) => p.locator("x-shadow-amb").nth(1).getByRole("button").click());
    const step = recordedFlowStep(action, "shadow-ambiguous");
    check("shadow ambiguous host: locator is explicitly needs-review", action?.locator?.resolution === "needs-review" && /ambiguous shadow host/.test(action.locator.reviewReason ?? ""), JSON.stringify(action?.locator));
    check("shadow ambiguous host: no nth/positional host selector is persisted", !/:nth-|nth-of-type/.test(JSON.stringify(action?.locator?.context?.shadow?.hosts ?? [])), JSON.stringify(action?.locator?.context?.shadow));
    const report = validateFlowDefinition(buildRecordedFlow("Ambiguous host", [{ ...action!, id: "shadow-ambiguous" } as any]));
    check("shadow ambiguous host: static preflight blocks", !!step && hasActivePathError(report) && executionBlockingErrorsOf(report).some((issue) => issue.code === "locatorNeedsReview"), JSON.stringify(executionBlockingErrorsOf(report)));
  }

  // F8. Closed roots are captured as an instrumented host-chain locator (C2), resolved via the runtime
  //     bridge, while persisting no internal name/text and preserving native attachShadow behaviour.
  {
    const html = `<x-shadow-closed data-testid="closed-host"></x-shadow-closed><script>
      if (!customElements.get('x-shadow-closed')) customElements.define('x-shadow-closed', class extends HTMLElement {
        connectedCallback(){ if(this.__ready)return; this.__ready=true; const r=this.attachShadow({mode:'closed'}); const b=document.createElement('button'); b.textContent='Closed secret control'; b.onclick=()=>window.__hit='closed-internal'; r.appendChild(b); this.triggerInternal=()=>b.click(); }
      });
    </script>`;
    const action = await capture(html, (p) => p.locator("x-shadow-closed").evaluate((host: any) => host.triggerInternal()));
    const serialized = JSON.stringify(action);
    const flow = buildRecordedFlow("Closed shadow", [{ ...action!, id: "shadow-closed" } as any]);
    const report = validateFlowDefinition(flow);
    let guardedLaunches = 0;
    if (!hasActivePathError(report)) guardedLaunches += 1;
    // C2: a closed-shadow target is now captured as an INSTRUMENTED locator (host chain + target CSS) and
    // resolved via the runtime bridge — no longer review-required. It still persists NO internal name/text
    // (privacy), and the full replay + host-substitution refusal is gated by verify:closed-shadow.
    check("shadow closed: boundary is closed, instrumented, and resolved", action?.locator?.context?.shadow?.boundary === "closed" && action?.locator?.context?.shadow?.instrumented === true && action?.locator?.resolution === "resolved", serialized);
    check("shadow closed: persisted data exposes no internal node/name", !serialized.includes("Closed secret control") && !serialized.includes("triggerInternal"), serialized);
    check("shadow closed: preflight admits the instrumented flow", !hasActivePathError(report), JSON.stringify(executionBlockingErrorsOf(report)));
    check("shadow closed: the instrumented step is runnable (preflight passes)", guardedLaunches === 1, String(guardedLaunches));
    const step = flow.nodes.find((node) => node.type === "click");
    let directError = "";
    try { if (step) await new LocatorFactory(page).resolve(step); } catch (error) { directError = String(error); }
    check("shadow closed: LocatorFactory resolves the instrumented locator (no review throw)", directError === "", directError);

    const behavior = await page.evaluate(() => {
      const openHost = document.createElement("div"); document.body.appendChild(openHost);
      const openRoot = openHost.attachShadow({ mode: "open" });
      const closedHost = document.createElement("div"); document.body.appendChild(closedHost);
      const closedRoot = closedHost.attachShadow({ mode: "closed" });
      let secondThrows = false;
      try { openHost.attachShadow({ mode: "open" }); } catch { secondThrows = true; }
      return { openReturned: openHost.shadowRoot === openRoot, closedHidden: closedHost.shadowRoot === null && closedRoot.mode === "closed", secondThrows };
    });
    check("shadow closed: attachShadow return/visibility/exception behavior is unchanged", behavior.openReturned && behavior.closedHidden && behavior.secondThrows, JSON.stringify(behavior));
  }

  // F9. Same-origin frames preserve the existing strict frame model before the shadow host chain.
  {
    const child = `<x-frame-shadow data-testid='frame-host'></x-frame-shadow><script>if(!customElements.get('x-frame-shadow'))customElements.define('x-frame-shadow',class extends HTMLElement{connectedCallback(){if(this.shadowRoot)return;const r=this.attachShadow({mode:'open'});r.innerHTML='<button type="button">Frame shadow action</button>';r.querySelector('button').onclick=()=>window.__hit='frame-shadow';}});</script>`;
    const html = `<iframe name="shadow-frame" srcdoc="${child.replace(/&/g, "&amp;").replace(/\"/g, "&quot;")}"></iframe>`;
    const action = await capture(html, (p) => p.frameLocator('iframe[name="shadow-frame"]').getByRole("button", { name: "Frame shadow action" }).click());
    check("shadow frame: same-origin frame selector is retained", action?.locator?.context?.frame?.selector === 'iframe[name="shadow-frame"]', JSON.stringify(action?.locator?.context));
    check("shadow frame: open host chain is also retained", action?.locator?.context?.shadow?.hosts?.length === 1, JSON.stringify(action?.locator?.context));
    const step = recordedFlowStep(action, "shadow-frame");
    const replay = step ? await run(html, step) : { status: "missing" };
    const frameHit = await page.frameLocator('iframe[name="shadow-frame"]').locator("body").evaluate(() => (window as any).__hit ?? null).catch(() => null);
    check("shadow frame: normal frame→host→target replay succeeds", replay.status === "passed" && frameHit === "frame-shadow", `${replay.status}/${frameHit}`);
  }

  // F10. A real cross-origin child frame is captured without parent DOM access and guarded by the
  // production binding/RecorderService path, never retargeted against the main document.
  {
    recorded.length = 0;
    bindingRecorder.actions = [];
    bindingRecorder.ambiguityState = null;
    bindingRecorder.isRecording = true;
    bindingRecorder.lastActionAt = 0;
    bindingRecorder.lastActionPage = undefined;
    await page.route("http://localhost:4321/**", (route) => route.fulfill({
      contentType: "text/html",
      body: '<iframe title="Cross-origin shadow frame" src="http://127.0.0.1:4321/shadow-child"></iframe>'
    }));
    await page.route("http://127.0.0.1:4321/**", (route) => route.fulfill({
      contentType: "text/html",
      body: `<x-cross-shadow data-testid="cross-host"></x-cross-shadow><script>
        customElements.define('x-cross-shadow', class extends HTMLElement { connectedCallback(){ const r=this.attachShadow({mode:'open'}); r.innerHTML='<button type="button">Frame shadow action</button>'; } });
      </script>`
    }));
    await page.goto("http://localhost:4321/shadow-parent", { waitUntil: "load" });
    await page.frameLocator('iframe[title="Cross-origin shadow frame"]').getByRole("button", { name: "Frame shadow action" }).click();
    await page.waitForTimeout(120);
    const guarded = recorded.at(-1) as any;
    check("shadow cross-origin frame: safe origin evidence is retained", guarded?.locator?.interaction?.frame?.state === "cross-origin" && guarded.locator.interaction.frame.origin === "http://127.0.0.1:4321", JSON.stringify(guarded));
    check("shadow cross-origin frame: action is review-required, never main-page executable", guarded?.locator?.resolution === "needs-review" && guarded.locator.reviewReason === "unsupported cross-origin frame" && !guarded.locator.context?.frame, JSON.stringify(guarded));
    await page.unroute("http://localhost:4321/**");
    await page.unroute("http://127.0.0.1:4321/**");
  }

  // F11. The traversal cap is fail-closed: bounded work must never become false uniqueness.
  {
    const hosts = Array.from({ length: 130 }, (_, index) => `<x-shadow-cap data-testid="cap-host-${index}" data-index="${index}"></x-shadow-cap>`).join("");
    const html = `${hosts}<script>
      if (!customElements.get('x-shadow-cap')) customElements.define('x-shadow-cap', class extends HTMLElement {
        connectedCallback(){ if(this.shadowRoot)return; const r=this.attachShadow({mode:'open'}); r.innerHTML='<button type="button">Cap action '+this.getAttribute('data-index')+'</button>'; }
      });
    </script>`;
    const action = await capture(html, (p) => p.getByTestId("cap-host-0").getByRole("button").click());
    check(
      "shadow traversal cap: incomplete enumeration is review-required, never falsely unique",
      action?.locator?.resolution === "needs-review" && action.locator.reviewReason === "shadow traversal limit reached",
      JSON.stringify(action?.locator)
    );
  }

  // CR3. Runtime self-healing: a legacy non-unique step where two same-named buttons are visible but
  // only one is enabled → the runner clicks the actionable one instead of failing.
  {
    const html = `<button class="act" disabled onclick="window.__hit='disabled'">Go</button>
                  <button class="act" onclick="window.__hit='enabled'">Go</button>`;
    const { status, hit } = await run(html, { id: "cr3", type: "click", name: "Click Go", locator: { strategy: "css", value: "button.act" } });
    check("self-heal: disabled twin ignored, enabled one clicked", status === "passed" && hit === "enabled", status + " / " + (hit ?? "null"));
  }

  // CR4. Two identical, equally-actionable buttons → the runner refuses to guess and fails clearly
  // (clicking the wrong twin is worse than a clear error).
  {
    const html = `<button class="act" onclick="window.__hit='one'">Go</button>
                  <button class="act" onclick="window.__hit='two'">Go</button>`;
    const { status, error } = await run(html, { id: "cr4", type: "click", name: "Click Go", locator: { strategy: "css", value: "button.act" } });
    check("self-heal: two equal twins → fails (no wrong-element guess)", status === "failed", status);
    check("self-heal: failure stays a friendly message", /multiple elements|matched multiple/i.test(error ?? ""), error);
  }

  console.log("Part E — Persisted locator winner and bounded local recovery");

  const recoveryRoot = await mkdtemp(join(tmpdir(), "wfs-locator-memory-"));
  const recoveryStore = new FileLocatorRecoveryStore(recoveryRoot);
  const recoveryScope = { scenarioId: "scenario-recovery", flowId: "flow-recovery" };

  // E1. The recorded alternative that won is persisted and tried first by a fresh factory.
  {
    const step: FlowStep = {
      id: "winner-order",
      type: "click",
      name: "Click winning candidate",
      locator: {
        strategy: "id",
        value: "stale-primary",
        alternatives: [{ strategy: "id", value: "last-winner" }]
      }
    };
    await page.setContent(`<button id="last-winner" onclick="window.__hit='learned'">Continue</button>`);
    await (await new LocatorFactory(page, { recoveryStore, scope: recoveryScope, recoveryGraceMs: 0 }).resolve(step)).click();

    const events: string[] = [];
    await page.setContent(
      `<button id="stale-primary" onclick="window.__hit='primary'">Continue</button>` +
        `<button id="last-winner" onclick="window.__hit='remembered'">Continue</button>`
    );
    const freshFactory = new LocatorFactory(page, {
      recoveryStore,
      scope: recoveryScope,
      recoveryGraceMs: 0,
      onRecoveryEvent: (event) => events.push(event.type)
    });
    await (await freshFactory.resolve(step)).click();
    check(
      "winner memory: a fresh factory tries the persisted winner first",
      (await page.evaluate(() => (window as any).__hit)) === "remembered",
      JSON.stringify(events)
    );
    check("winner memory: preferred-candidate is observable", events.includes("preferred-candidate"), JSON.stringify(events));
  }

  // E2. Only after every saved candidate misses, a unique high-similarity local element can recover.
  {
    const step: FlowStep = {
      id: "bounded-recovery",
      type: "click",
      name: "Click Save order",
      locator: { strategy: "id", value: "save-order-old" }
    };
    await page.setContent(
      `<section data-testid="checkout"><button id="save-order-old" class="flex items-center" onclick="window.__hit='old'">Save order</button></section>`
    );
    await (await new LocatorFactory(page, { recoveryStore, scope: recoveryScope, recoveryGraceMs: 0 }).resolve(step)).click();

    const events: Array<{ type: string; message: string }> = [];
    await page.setContent(
      `<section data-testid="checkout"><button id="save-order-new" class="grid justify-center" onclick="window.__hit='recovered'">Save order</button></section>`
    );
    const factory = new LocatorFactory(page, {
      recoveryStore,
      scope: recoveryScope,
      recoveryGraceMs: 0,
      onRecoveryEvent: (event) => events.push(event)
    });
    const recovered = await factory.resolve(step);
    const recoveredCount = await recovered.count();
    if (recoveredCount === 1) await recovered.click();
    check(
      "local recovery: unique high-similarity element is clicked after all candidates miss",
      recoveredCount === 1 && (await page.evaluate(() => (window as any).__hit)) === "recovered",
      JSON.stringify(events)
    );
    check(
      "local recovery: warning explicitly tells the user to re-record",
      events.some((event) => event.type === "local-recovery" && /RECOVERED locator.+Re-record/i.test(event.message)),
      JSON.stringify(events)
    );
    const record = await recoveryStore.get("scenario-recovery\u0000flow-recovery\u0000bounded-recovery");
    check("local recovery: durable record marks the recovery source", record?.source === "local-recovery", JSON.stringify(record));
    check(
      "local recovery: fingerprint never stores utility or hashed classes",
      !JSON.stringify(record?.fingerprint).includes("flex") && !JSON.stringify(record?.fingerprint).includes("justify-center"),
      JSON.stringify(record?.fingerprint)
    );
    check(
      "local recovery: durable fingerprint does not store visible business text",
      !JSON.stringify(record?.fingerprint).toLocaleLowerCase().includes("save order"),
      JSON.stringify(record?.fingerprint)
    );
  }

  // E3. No successful history means no similarity scan: the legacy auto-wait locator is returned.
  {
    const events: string[] = [];
    const step: FlowStep = {
      id: "no-history",
      type: "click",
      name: "Click unlearned target",
      locator: { strategy: "id", value: "missing-recorded-id" }
    };
    await page.setContent(`<button id="similar-looking">Click unlearned target</button>`);
    const unresolved = await new LocatorFactory(page, {
      recoveryStore,
      scope: recoveryScope,
      recoveryGraceMs: 0,
      onRecoveryEvent: (event) => events.push(event.type)
    }).resolve(step);
    check("local recovery: no history preserves the missing recorded locator", (await unresolved.count()) === 0);
    check("local recovery: no history emits no recovery event", !events.includes("local-recovery"), JSON.stringify(events));
  }

  // E4. Two equally similar twins are below the uniqueness margin, so recovery refuses to guess.
  {
    const step: FlowStep = {
      id: "ambiguous-recovery",
      type: "click",
      name: "Click Approve",
      locator: { strategy: "id", value: "approve-old" }
    };
    await page.setContent(`<div><button id="approve-old">Approve</button></div>`);
    await new LocatorFactory(page, { recoveryStore, scope: recoveryScope, recoveryGraceMs: 0 }).resolve(step);
    await page.setContent(`<div><button id="approve-a">Approve</button><button id="approve-b">Approve</button></div>`);
    const events: string[] = [];
    const unresolved = await new LocatorFactory(page, {
      recoveryStore,
      scope: recoveryScope,
      recoveryGraceMs: 0,
      onRecoveryEvent: (event) => events.push(event.type)
    }).resolve(step);
    check("local recovery: equal twins remain unresolved", (await unresolved.count()) === 0);
    check("local recovery: equal twins emit no recovery claim", !events.includes("local-recovery"), JSON.stringify(events));
  }

  // E5. A still-valid recorded candidate always wins before recovery, even beside a close lookalike.
  {
    const step: FlowStep = {
      id: "recorded-still-valid",
      type: "click",
      name: "Click Publish",
      locator: { strategy: "id", value: "publish-recorded" }
    };
    await page.setContent(`<button id="publish-recorded">Publish</button>`);
    await new LocatorFactory(page, { recoveryStore, scope: recoveryScope, recoveryGraceMs: 0 }).resolve(step);
    const events: string[] = [];
    await page.setContent(
      `<button id="publish-recorded" onclick="window.__hit='recorded'">Publish</button>` +
        `<button id="publish-lookalike" onclick="window.__hit='lookalike'">Publish</button>`
    );
    const resolved = await new LocatorFactory(page, {
      recoveryStore,
      scope: recoveryScope,
      recoveryGraceMs: 0,
      onRecoveryEvent: (event) => events.push(event.type)
    }).resolve(step);
    await resolved.click();
    check(
      "local recovery: a valid recorded candidate is never replaced",
      (await page.evaluate(() => (window as any).__hit)) === "recorded",
      JSON.stringify(events)
    );
    check("local recovery: valid candidate emits no recovery event", !events.includes("local-recovery"), JSON.stringify(events));
  }

  console.log("Part D — Smart Wait recorder observation (Phase 2)");

  // D-unit: buildSmartWaits correlation/scoring on synthetic signals (deterministic).
  {
    const T0 = 1000;
    const T1 = 5000;

    // 1. POST completes before proceeding → response wait armed before the action.
    {
      const w = buildSmartWaits([{ kind: "request", method: "POST", path: "/api/save", status: 200, startedAt: 1100, endedAt: 1400 }], T0, T1);
      const r = w.find((x) => x.type === "response") as { type: "response"; method?: string; urlContains?: string; armBeforeAction?: boolean } | undefined;
      check("POST → response wait, armed before action", !!r && r.method === "POST" && r.urlContains === "/api/save" && r.armBeforeAction === true, JSON.stringify(w));
    }

    // 2. GET search returns rows → response + tableHasRows (response ranked first).
    {
      const w = buildSmartWaits(
        [
          { kind: "request", method: "GET", path: "/api/customers", status: 200, startedAt: 1100, endedAt: 1500 },
          { kind: "rows", container: { strategy: "id", value: "results" }, listLike: false, count: 5, ts: 1600 }
        ],
        T0,
        T1
      );
      check("GET search → response + tableHasRows", w.some((x) => x.type === "response") && w.some((x) => x.type === "tableHasRows"), JSON.stringify(w));
      check("response is ranked before tableHasRows", w.findIndex((x) => x.type === "response") < w.findIndex((x) => x.type === "tableHasRows"), JSON.stringify(w.map((x) => x.type)));
    }

    // 3. Card/list results appeared → listHasItems.
    {
      const w = buildSmartWaits([{ kind: "rows", container: { strategy: "css", value: ".cards" }, listLike: true, count: 3, ts: 1600 }], T0, T1);
      const list = w.find((x) => x.type === "listHasItems") as { type: "listHasItems"; listLocator: { value: string } } | undefined;
      check("card/list data appeared → listHasItems", !!list && list.listLocator.value === ".cards", JSON.stringify(w));
    }

    // 4. Spinner appeared then disappeared → loaderHidden.
    {
      const w = buildSmartWaits([{ kind: "loaderHidden", selector: ".ant-spin", shownAt: 1100, hiddenAt: 1800 }], T0, T1);
      const l = w.find((x) => x.type === "loaderHidden") as { type: "loaderHidden"; locator: { value: string } } | undefined;
      check("spinner shown→hidden → loaderHidden with selector", !!l && l.locator.value === ".ant-spin", JSON.stringify(w));
    }

    // 5. Success toast → toastVisible with text.
    {
      const w = buildSmartWaits([{ kind: "toast", text: "Saved successfully", role: "alert", ts: 1200 }], T0, T1);
      const t = w.find((x) => x.type === "toastVisible") as { type: "toastVisible"; text?: string } | undefined;
      check("toast → toastVisible with text", !!t && t.text === "Saved successfully", JSON.stringify(w));
    }

    // 6. Button became enabled → elementEnabled.
    {
      const w = buildSmartWaits([{ kind: "enabled", locator: { strategy: "id", value: "continue" }, ts: 1300 }], T0, T1);
      const e = w.find((x) => x.type === "elementEnabled") as { type: "elementEnabled"; locator: { value: string } } | undefined;
      check("enabled transition → elementEnabled locator", !!e && e.locator.value === "continue", JSON.stringify(w));
    }

    // 7. URL changed after submit → urlChanged with a query-free fragment.
    {
      const w = buildSmartWaits([{ kind: "url", url: "https://app.test/confirmation?token=SECRET", ts: 1400 }], T0, T1);
      const u = w.find((x) => x.type === "urlChanged") as { type: "urlChanged"; urlContains?: string } | undefined;
      check("url change → urlChanged (path only, no query/token)", !!u && u.urlContains === "/confirmation", JSON.stringify(w));
    }

    // 8. Background polling (same GET repeated) → ignored, no response wait.
    {
      const poll: RecordedSignal[] = [1100, 2100, 3100, 4100].map((t) => ({ kind: "request", method: "GET", path: "/api/poll", status: 200, startedAt: t, endedAt: t + 50 }));
      const w = buildSmartWaits(poll, T0, T1, { allowFixedDelayFallback: false });
      check("repeated GET (polling) → no response wait", !w.some((x) => x.type === "response"), JSON.stringify(w));
    }

    // 9. Nothing detected + long window + fallback allowed → single fixedDelay.
    {
      const w = buildSmartWaits([], T0, T1, { allowFixedDelayFallback: true });
      check("no signal + fallback on → fixedDelay", w.length === 1 && w[0].type === "fixedDelay", JSON.stringify(w));
    }

    // 10. Nothing detected + fallback disabled (captureWaitTime on) → empty.
    {
      const w = buildSmartWaits([], T0, T1, { allowFixedDelayFallback: false });
      check("no signal + fallback off (captureWaitTime) → no smart wait", w.length === 0, JSON.stringify(w));
    }

    // ── Adaptive dynamic timeout (async awareness) ─────────────────────────────
    const WIDE = 40_000; // wide window so long synthetic observations stay in-window
    // 11. A response wait derives timeoutMs = observed × 3 + 5000, clamped to [10000, 300000].
    {
      // observed 8000ms → 8000*3 + 5000 = 29000 (within bounds)
      const w = buildSmartWaits([{ kind: "request", method: "POST", path: "/api/orders", status: 201, startedAt: 1100, endedAt: 9100 }], T0, WIDE);
      const r = w.find((x) => x.type === "response") as { timeoutMs?: number } | undefined;
      check("adaptive: response timeout = observed×3+5000", r?.timeoutMs === 29000, JSON.stringify(w));
    }
    // 12. A very long observation is clamped to the maximum (never unbounded).
    {
      const w = buildSmartWaits([{ kind: "request", method: "POST", path: "/api/slow", status: 200, startedAt: 1100, endedAt: 1100 + 200_000 }], T0, 400_000);
      const r = w.find((x) => x.type === "response") as { timeoutMs?: number } | undefined;
      check("adaptive: long response clamped to maximum 300000", r?.timeoutMs === 300_000, JSON.stringify(w));
    }
    // 13. A short observation is clamped up to the minimum.
    {
      const w = buildSmartWaits([{ kind: "request", method: "POST", path: "/api/fast", status: 200, startedAt: 1100, endedAt: 1200 }], T0, WIDE);
      const r = w.find((x) => x.type === "response") as { timeoutMs?: number } | undefined;
      check("adaptive: short response clamped up to minimum 10000", r?.timeoutMs === 10_000, JSON.stringify(w));
    }
    // 14. adaptiveTimeouts:false → no timeoutMs is baked in (runner default applies).
    {
      const w = buildSmartWaits([{ kind: "request", method: "POST", path: "/api/orders", status: 201, startedAt: 1100, endedAt: 9100 }], T0, WIDE, { adaptiveTimeouts: false });
      const r = w.find((x) => x.type === "response") as { timeoutMs?: number } | undefined;
      check("adaptive off → response has no timeoutMs", !!r && r.timeoutMs === undefined, JSON.stringify(w));
    }
    // 15. Custom bounds are honored (min raised to 20000).
    {
      const w = buildSmartWaits([{ kind: "request", method: "POST", path: "/api/orders", status: 201, startedAt: 1100, endedAt: 2100 }], T0, WIDE, { minimumTimeoutMs: 20_000 });
      const r = w.find((x) => x.type === "response") as { timeoutMs?: number } | undefined;
      check("adaptive: custom minimum bound honored", r?.timeoutMs === 20_000, JSON.stringify(w));
    }
    // 16. A loader wait also gets an adaptive timeout from its visible duration.
    {
      const w = buildSmartWaits([{ kind: "loaderHidden", selector: ".spinner", shownAt: 1100, hiddenAt: 9100 }], T0, WIDE);
      const l = w.find((x) => x.type === "loaderHidden") as { timeoutMs?: number } | undefined;
      check("adaptive: loader timeout = observed×3+5000", l?.timeoutMs === 29000, JSON.stringify(w));
    }
  }

  // D-integration: the injected page script actually emits safe signals.
  {
    // 11. fetch POST with a secret query → a request signal with method + PATH ONLY (no query/token).
    {
      signals.length = 0;
      await page.route("**/api/save**", (route) => route.fulfill({ status: 200, contentType: "text/plain", body: "ok" }));
      await page.goto("data:text/html;charset=utf-8," + encodeURIComponent("<!doctype html><html><body><button id=b>Save</button></body></html>"), { waitUntil: "load" });
      await page.evaluate(() => fetch("http://awtkit.test/api/save?token=SECRET", { method: "POST", mode: "no-cors" }).catch(() => undefined));
      await page.waitForTimeout(250);
      const req = signals.find((s) => s.kind === "request") as { kind: "request"; method: string; path: string } | undefined;
      check("in-page: fetch emits a request signal", !!req, JSON.stringify(signals));
      check("in-page: request captures method + PATH only (no query/token)", !!req && req.method === "POST" && req.path === "/api/save", JSON.stringify(req));
      await page.unroute("**/api/save**");
    }

    // 12. Loader appears then disappears → a loaderHidden signal.
    {
      signals.length = 0;
      const html = `<div class="spinner" id="sp">loading…</div><button id="b" onclick="setTimeout(function(){document.getElementById('sp').style.display='none';},200)">Go</button>`;
      await page.goto("data:text/html;charset=utf-8," + encodeURIComponent("<!doctype html><html><body>" + html + "</body></html>"), { waitUntil: "load" });
      await page.click("#b");
      await page.waitForTimeout(600);
      check("in-page: loader shown→hidden emits loaderHidden signal", signals.some((s) => s.kind === "loaderHidden"), JSON.stringify(signals.map((s) => s.kind)));
    }

    // 13. URL hash change → a url signal (routed http page; hashchange doesn't fire on data: URLs).
    {
      signals.length = 0;
      await page.route("http://awtkit.test/urltest", (route) =>
        route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body><button id=b onclick=\"location.hash='done'\">Go</button></body></html>" })
      );
      await page.goto("http://awtkit.test/urltest", { waitUntil: "load" });
      await page.click("#b");
      await page.waitForTimeout(200);
      check("in-page: URL change emits a url signal", signals.some((s) => s.kind === "url"), JSON.stringify(signals.map((s) => s.kind)));
      await page.unroute("http://awtkit.test/urltest");
    }
  }

  console.log("Part P — Recorder popup lifecycle, identity, switching, and sanitation");
  {
    const popupServer = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/opener") {
        response.setHeader("content-type", "text/html");
        response.end(`<!doctype html><button id="open" onclick="const p=window.open('about:blank');setTimeout(()=>p.location=location.origin+'/redirect?token=SECRET#private',25)">Open report</button><button id="main-again">Main again</button>`);
      } else if (url.pathname === "/redirect") {
        response.statusCode = 302;
        response.setHeader("location", "/reports/daily?access_token=HIDDEN#result");
        response.end();
      } else if (url.pathname === "/js-opener") {
        response.setHeader("content-type", "text/html");
        response.end(`<!doctype html><button id="js-open" onclick="window.open('/js-hop')">Open via script redirect</button>`);
      } else if (url.pathname === "/js-hop") {
        // A CLIENT-side redirect, unlike /redirect above: this document COMMITS before replacing
        // itself, so a first-commit-wins identity rule locks onto this URL instead of the final one.
        response.setHeader("content-type", "text/html");
        response.end(`<!doctype html><title>hop</title><script>location.replace('/reports/final?token=LEAKED#frag');</script>`);
      } else if (url.pathname === "/reports/final") {
        response.setHeader("content-type", "text/html");
        response.end(`<!doctype html><title>Final</title><button id="final-action">Use final report</button>`);
      } else if (url.pathname === "/reports/daily") {
        response.setHeader("content-type", "text/html");
        response.end(`<!doctype html><title>Shared title</title><button id="popup-action" onclick="history.pushState({},'',location.pathname+'?token=ROTATED#done')">Use report</button>`);
      } else {
        response.statusCode = 404;
        response.end("not found");
      }
    });
    await new Promise<void>((resolve) => popupServer.listen(0, "127.0.0.1", resolve));
    const address = popupServer.address();
    if (!address || typeof address === "string") throw new Error("Popup verifier server did not bind a TCP port.");
    const popupBase = `http://127.0.0.1:${address.port}`;
    const popupContext = await browser.newContext();
    const popupMain = await popupContext.newPage();
    const popupRecorder = new RecorderService() as any;
    popupRecorder.isRecording = true;
    popupRecorder.captureWaitTime = false;
    popupRecorder.captureSmartWaits = false;
    popupRecorder.page = popupMain;
    popupRecorder.lastActionPage = popupMain;
    popupRecorder.actions = [];
    popupRecorder.scheduleDraftPersist = () => undefined;
    await popupRecorder.wireContext(popupContext);

    await popupMain.goto(`${popupBase}/opener`);
    const popupPromise = popupMain.waitForEvent("popup");
    await popupMain.getByRole("button", { name: "Open report" }).click();
    const opened = await popupPromise;
    await opened.waitForURL("**/reports/daily**");
    await opened.getByRole("button", { name: "Use report" }).click();
    await popupMain.getByRole("button", { name: "Main again" }).click();
    await popupMain.waitForTimeout(250);

    const popupActions = popupRecorder.getActions() as Array<any>;
    const opener = popupActions.find((action) => action.type === "click" && action.name.includes("Open report"));
    const popupClickIndex = popupActions.findIndex((action) => action.type === "click" && action.name.includes("Use report"));
    const switchStep = popupActions[popupClickIndex - 1];
    const mainClickIndex = popupActions.findIndex((action) => action.type === "click" && action.name.includes("Main again"));
    const routeStep = popupActions[mainClickIndex - 1];
    const serialized = JSON.stringify(popupActions);
    const persistedNavigation = JSON.stringify(popupActions.map((action) => ({
      type: action.type,
      name: action.type === "routeChange" ? action.name : undefined,
      pageAlias: action.pageAlias,
      popupExpectation: action.popupExpectation,
      routeValue: action.type === "routeChange" ? action.valueSource?.value : undefined
    })));
    check("popup: direct opener action is causally tagged", opener?.opensPopup === true, serialized);
    check("popup: expectation waits for meaningful post-redirect URL", opener?.popupExpectation?.urlContains === `${popupBase}/reports/daily`, JSON.stringify(opener));
    check("popup: deterministic alias is shared by opener, switch, and action", !!opener?.popupExpectation?.popupAlias && switchStep?.popupExpectation?.popupAlias === opener.popupExpectation.popupAlias && popupActions[popupClickIndex]?.pageAlias === opener.popupExpectation.popupAlias, serialized);
    check("popup: exactly one switch node precedes the first popup interaction", switchStep?.type === "switchToPopup" && popupActions.filter((action) => action.type === "switchToPopup").length === 1, serialized);
    check("popup: return to main is explicit before the next main interaction", routeStep?.type === "routeChange" && routeStep?.valueSource?.value === `${popupBase}/opener`, serialized);
    check("popup: persisted navigation contains no query, fragment, or secret value", !/[?#]|SECRET|HIDDEN|ROTATED|private/.test(persistedNavigation), persistedNavigation);
    check("popup: context init script instruments the current popup document", await opened.evaluate(() => Boolean((window as any).__awtkitCaptureInstalled)));
    check("popup: context and page events deduplicate one Page registration", popupRecorder.popupRegistrations.size === 1 && popupRecorder.popupPages.size === 1, `registrations=${popupRecorder.popupRegistrations.size}; pages=${popupRecorder.popupPages.size}`);

    const aliasA = deriveAliasForTest("http://popup.test/reports/daily?token=one#x");
    const aliasB = deriveAliasForTest("http://popup.test/reports/monthly?token=two#y");
    const aliasAChanged = deriveAliasForTest("http://popup.test/reports/daily?token=changed#z");
    check("popup: same titles on different paths retain distinct identities", aliasA !== aliasB, `${aliasA} / ${aliasB}`);
    check("popup: pushState/hash/query changes do not change identity", aliasA === aliasAChanged, `${aliasA} / ${aliasAChanged}`);
    // Two live popups on ONE origin+path: identity alone cannot separate them, so the arrival-order
    // fallback must still register BOTH. Before the fix this threw, leaving the second popup
    // unregistered and its actions silently mis-tagged as `main`.
    const twinUrl = `${popupBase}/reports/daily`;
    const twinA = await popupContext.newPage();
    await twinA.goto(twinUrl);
    const twinB = await popupContext.newPage();
    await twinB.goto(twinUrl);
    await popupRecorder.popupRegistrations.get(twinA);
    await popupRecorder.popupRegistrations.get(twinB);
    const twinAliases = [...(popupRecorder.popupPages as Map<string, any>).entries()]
      .filter(([, page]) => page === twinA || page === twinB)
      .map(([alias]) => alias);
    check(
      "popup: two live popups sharing one origin+path both register under distinct aliases",
      twinAliases.length === 2 && new Set(twinAliases).size === 2,
      JSON.stringify(twinAliases)
    );
    check("popup: identity collision is not reported as an instrumentation failure", !popupRecorder.instrumentationError, String(popupRecorder.instrumentationError));

    // A tab whose URL carries no safe identity (about:blank, data:, blob:) must STILL emit the
    // switch step — dropping it would replay the next action against the wrong page. Before the fix
    // the step was silently omitted whenever sanitisation returned nothing.
    const blankRecorder = new RecorderService() as any;
    blankRecorder.isRecording = true;
    blankRecorder.captureWaitTime = false;
    blankRecorder.captureSmartWaits = false;
    blankRecorder.actions = [];
    blankRecorder.signals = [];
    blankRecorder.scheduleDraftPersist = () => undefined;
    const blankTabOne = { url: () => "about:blank" } as any;
    const blankTabTwo = { url: () => "about:blank" } as any;
    blankRecorder.lastActionPage = blankTabOne;
    blankRecorder.recordActionFromPage(blankTabTwo, { type: "click", name: "Click in blank tab" });
    const blankActions = blankRecorder.getActions() as Array<any>;
    check(
      "popup: a tab with no safe URL still emits an unhinted switch step",
      blankActions[0]?.type === "routeChange" && blankActions[0]?.valueSource === undefined,
      JSON.stringify(blankActions)
    );
    // Bind this to the switch step itself, not to `[0]` — otherwise a missing switch step lets the
    // following click satisfy the assertion and the companion check passes against the defect.
    const unhintedSwitch = blankActions.find((entry) => entry.type === "routeChange");
    check(
      "popup: the unhinted switch step leaks no raw URL in its name",
      typeof unhintedSwitch?.name === "string" && !/about:blank/.test(unhintedSwitch.name),
      JSON.stringify(unhintedSwitch ?? null)
    );

    // A CLIENT-side redirect commits an intermediate document, so a first-commit-wins identity rule
    // locks onto the hop instead of the final URL. The 302 case above cannot catch this: a 302 never
    // commits a document at all.
    const jsContext = await browser.newContext();
    const jsMain = await jsContext.newPage();
    const jsRecorder = new RecorderService() as any;
    jsRecorder.isRecording = true;
    jsRecorder.captureWaitTime = false;
    jsRecorder.captureSmartWaits = false;
    jsRecorder.page = jsMain;
    jsRecorder.lastActionPage = jsMain;
    jsRecorder.actions = [];
    jsRecorder.scheduleDraftPersist = () => undefined;
    await jsRecorder.wireContext(jsContext);

    await jsMain.goto(`${popupBase}/js-opener`);
    const jsPopupPromise = jsMain.waitForEvent("popup");
    await jsMain.getByRole("button", { name: "Open via script redirect" }).click();
    const jsPopup = await jsPopupPromise;
    await jsPopup.waitForURL("**/reports/final**");
    await jsMain.waitForTimeout(600);

    const jsActions = jsRecorder.getActions() as Array<any>;
    const jsOpener = jsActions.find((action) => action.type === "click");
    check(
      "popup: a client-side redirect resolves to the FINAL url, not the committed hop",
      jsOpener?.popupExpectation?.urlContains === `${popupBase}/reports/final`,
      JSON.stringify(jsOpener?.popupExpectation)
    );
    check(
      "popup: the superseded hop is not persisted as the popup identity",
      !JSON.stringify(jsActions).includes("/js-hop"),
      JSON.stringify(jsActions)
    );
    check(
      "popup: the client-side redirect target's query and fragment are still stripped",
      !/LEAKED|frag|[?#]/.test(JSON.stringify(jsActions.map((a) => a.popupExpectation))),
      JSON.stringify(jsActions.map((a) => a.popupExpectation))
    );
    await jsContext.close();

    await popupContext.close();
    await new Promise<void>((resolve, reject) => popupServer.close((error) => error ? reject(error) : resolve()));
  }

  console.log("Part Q — source guards");
  {
    // The capture script is stringified into the browser, so it CANNOT import the shared constant.
    // The cap therefore exists as two literals that can silently drift apart: the recorder would
    // emit a chain the runtime then refuses. Assert they agree rather than trusting the comment.
    const { readFile } = await import("node:fs/promises");
    const initSource = await readFile("src/recorder/recorderInitScript.ts", "utf8");
    const profileSource = await readFile("src/profiles/FlowProfile.ts", "utf8");
    const captureCap = /MAX_CONTAINER_CHAIN_LENGTH\s*=\s*(\d+)/.exec(initSource)?.[1];
    const runtimeCap = /MAX_LOCATOR_CONTAINER_CHAIN\s*=\s*(\d+)/.exec(profileSource)?.[1];
    check("source guard: both container-chain caps were found", !!captureCap && !!runtimeCap, `capture=${captureCap}, runtime=${runtimeCap}`);
    check(
      "source guard: capture and runtime container-chain caps agree",
      !!captureCap && captureCap === runtimeCap,
      `capture=${captureCap}, runtime=${runtimeCap}`
    );
  }

  await browser.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

function deriveAliasForTest(raw: string): string {
  return derivePopupAlias(new URL(raw));
}
