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
import type { Page } from "playwright";
import { getRecorderInitScriptContent } from "@src/recorder/recorderInitScript";
import { buildSmartWaits, type RecordedSignal } from "@src/recorder/smartWaitObservation";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { ValueResolver } from "@src/runner/ValueResolver";
import { StepExecutor } from "@src/runner/StepExecutor";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";
import type { FlowStep } from "@src/profiles/FlowProfile";

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
  locator?: { strategy: string; value: string; name?: string; exact?: boolean; quality?: any };
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

const UTILITY_CLASS = /\.(flex|items-center|justify-center|relative|absolute|grid|block|hidden)\b/;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  const recorded: RecordedAction[] = [];
  await context.exposeBinding("__awtkit_recordAction", (_source, action: RecordedAction) => {
    recorded.push(action);
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

  console.log("Part C — Runner fallback resolution (alternatives, visibility, context scoping)");

  // Run one step against `html` and return the execution result + the id of the element the
  // click/check landed on (candidate elements set `window.__hit` via onclick).
  async function run(html: string, step: FlowStep): Promise<{ status: string; error?: string; hit: string | null }> {
    await page.setContent(html);
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

  await browser.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
