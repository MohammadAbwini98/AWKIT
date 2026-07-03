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

  await browser.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
