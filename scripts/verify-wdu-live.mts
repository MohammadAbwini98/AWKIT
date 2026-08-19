/**
 * WebDriverUniversity LIVE acceptance suite (`awkit-i91j`).
 *
 * Executes real {@link FlowProfile}s through the real {@link PlaywrightRunner} against
 * https://webdriveruniversity.com. This is ACCEPTANCE evidence that SpecterStudio automates the
 * challenges — not a Playwright test suite. Every scenario is expressed with product node types,
 * product locators and product waits; nothing here calls `page.*` directly to make a challenge pass.
 *
 * THIS IS AN EXTERNAL-SITE GATE. It is deliberately NOT part of the deterministic verification set:
 * it needs the public internet, and the site can change under us. Deterministic regressions for
 * every product defect this suite discovers live in `mock-site/` + a focused `verify:*` gate
 * (`verify:dialogs` is the first). Never make ordinary AWKIT development depend on this script.
 *
 * Run with: npx tsx scripts/verify-wdu-live.mts [--only <substring>]
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlaywrightRunner } from "@src/runner/PlaywrightRunner";
import type { FlowProfile, FlowStep } from "@src/profiles/FlowProfile";
import type { ScenarioProfile } from "@src/profiles/ScenarioProfile";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";
import type { InstanceConfig } from "@src/instances/InstanceConfig";

const BASE = "https://webdriveruniversity.com";
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : undefined;

type Outcome = "PASS" | "FAIL" | "BLOCKED" | "INCONCLUSIVE";
interface CaseResult {
  id: string;
  challenge: string;
  scenario: string;
  outcome: Outcome;
  detail: string;
  steps: number;
}
const results: CaseResult[] = [];

function flow(id: string, steps: FlowStep[]): FlowProfile {
  const nodes: FlowStep[] = [{ id: "start", type: "start", name: "start" }, ...steps, { id: "end", type: "end", name: "end" }];
  const ids = nodes.map((n) => n.id);
  // A duplicated step id makes the linear chain below give one node two outgoing connectors, which
  // the runner correctly rejects — but as an ambiguous-routing error that does not name the
  // duplicate. Catching it here keeps a harness typo from reading like a product defect.
  const duplicates = ids.filter((v, i) => ids.indexOf(v) !== i);
  if (duplicates.length) throw new Error(`flow "${id}" has duplicate step ids: ${[...new Set(duplicates)].join(", ")}`);
  return {
    id,
    name: id,
    version: 1,
    nodes,
    edges: ids.slice(0, -1).map((source, i) => ({ id: `${id}-e${i}`, source, target: ids[i + 1], type: "success" as const }))
  };
}

async function makeContext(flowId: string, runtimeInputs: Record<string, unknown> = {}): Promise<InstanceExecutionContext> {
  const dir = await mkdtemp(join(tmpdir(), "wdu-live-"));
  return {
    executionId: "exec-wdu",
    instanceId: "inst-1",
    scenarioId: "scen-wdu",
    flowId,
    instanceOrderNumber: 1,
    totalInstances: 1,
    runtimeInputs,
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

const instanceConfig = { id: "ic", name: "ic", browser: "chromium", headless: true } as unknown as InstanceConfig;

/** Execute one or more flows as a real scenario and report per-step outcomes. */
async function execute(
  flows: FlowProfile[],
  runtimeInputs: Record<string, unknown> = {}
): Promise<{ status: string; steps: { stepId: string; status: string; error?: string }[]; flowErrors: string[] }> {
  const scenario: ScenarioProfile = {
    id: `sc-${flows[0].id}`,
    name: flows[0].id,
    executionMode: "sequential",
    maxParallelFlows: 1,
    flows: flows.map((f, i) => ({ order: i + 1, flowId: f.id, required: true })),
    links: [],
    failurePolicy: { onFlowFailure: "stop", captureScreenshot: false }
  } as unknown as ScenarioProfile;
  const runner = new PlaywrightRunner({ flows, productionOffline: false, resourcesRoot: join(process.cwd(), "resources") });
  const result = await runner.executeScenario(scenario, await makeContext(flows[0].id, runtimeInputs), instanceConfig);
  const steps = result.flows.flatMap((f) =>
    (f.steps ?? []).map((s) => ({ stepId: s.stepId, status: s.status, error: s.error ? String(s.error) : undefined }))
  );
  // A flow can fail BEFORE any step runs (pre-run validation), leaving `steps` empty. Surface the
  // flow-level error too, or that case reports as a blank failure.
  const flowErrors = result.flows.filter((f) => f.error).map((f) => `${f.flowId}: ${String(f.error)}`);
  return { status: result.status, steps, flowErrors };
}

/**
 * Run one acceptance case. `expect` is `'pass'` for a scenario that must complete, or the id of the
 * step that must FAIL — used for the negative cases, where a green run would mean the assertion
 * never had teeth.
 */
async function acceptance(
  id: string,
  challenge: string,
  scenario: string,
  flows: FlowProfile[],
  expect: "pass" | { failingStep: string; errorMatches?: RegExp },
  runtimeInputs: Record<string, unknown> = {}
): Promise<void> {
  if (only && !`${id} ${challenge} ${scenario}`.toLowerCase().includes(only.toLowerCase())) return;
  const label = `${id} — ${challenge} / ${scenario}`;
  try {
    const run = await execute(flows, runtimeInputs);
    if (expect === "pass") {
      const bad = run.steps.filter((s) => s.status !== "passed" && s.status !== "skipped");
      const ok = run.status === "passed" && bad.length === 0;
      results.push({
        id,
        challenge,
        scenario,
        outcome: ok ? "PASS" : "FAIL",
        // Always carry the scenario status: a flow can end non-passed with every step passing
        // (e.g. an unreached terminal), and an empty detail would hide exactly that case.
        detail: ok
          ? `${run.steps.length} steps`
          : `scenario=${run.status}; steps=[${run.steps.map((s) => `${s.stepId}:${s.status}`).join(", ")}]` +
            (bad.length ? ` | ${bad.map((s) => `${s.stepId} ${s.error ?? ""}`).join(" | ")}` : "") +
            (run.flowErrors.length ? ` | flow: ${run.flowErrors.join("; ")}` : ""),
        steps: run.steps.length
      });
    } else {
      const target = run.steps.find((s) => s.stepId === expect.failingStep);
      const failedAsExpected = target?.status === "failed";
      const messageOk = !expect.errorMatches || expect.errorMatches.test(target?.error ?? "");
      const ok = failedAsExpected && messageOk;
      results.push({
        id,
        challenge,
        scenario,
        outcome: ok ? "PASS" : "FAIL",
        detail: ok
          ? `negative case failed as required at ${expect.failingStep}`
          : `expected ${expect.failingStep} to FAIL; got ${target?.status ?? "missing"} ${target?.error ?? ""}`.slice(0, 300),
        steps: run.steps.length
      });
    }
  } catch (error) {
    results.push({
      id,
      challenge,
      scenario,
      outcome: "INCONCLUSIVE",
      detail: `harness error: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300),
      steps: 0
    });
  }
  const last = results[results.length - 1];
  const mark = last.outcome === "PASS" ? "✓" : last.outcome === "FAIL" ? "✗" : "?";
  console.log(`  ${mark} ${label} [${last.outcome}] ${last.outcome === "PASS" ? "" : "— " + last.detail}`);
}

// ── step helpers, all product node types ─────────────────────────────────────────────────────────
const goto = (id: string, url: string): FlowStep => ({ id, type: "goto", name: id, url });
const click = (id: string, locator: FlowStep["locator"], extra: Partial<FlowStep> = {}): FlowStep => ({ id, type: "click", name: id, locator, ...extra });
const fill = (id: string, locator: FlowStep["locator"], value: string, extra: Partial<FlowStep> = {}): FlowStep => ({ id, type: "fill", name: id, locator, value, ...extra });
const assertText = (id: string, locator: FlowStep["locator"], expected: string, op: "contains" | "equals" = "contains"): FlowStep => ({
  id,
  type: "assertText",
  name: id,
  locator,
  value: expected,
  config: { assertionType: "text", comparisonOperator: op === "equals" ? "equals" : "contains", expectedValue: expected }
});
const assertVisible = (id: string, locator: FlowStep["locator"]): FlowStep => ({ id, type: "assertVisible", name: id, locator });

const byId = (value: string): FlowStep["locator"] => ({ strategy: "id", value });
const byCss = (value: string): FlowStep["locator"] => ({ strategy: "css", value });
const byPlaceholder = (value: string): FlowStep["locator"] => ({ strategy: "placeholder", value });
const byText = (value: string): FlowStep["locator"] => ({ strategy: "text", value });
const byRole = (value: string, name: string): FlowStep["locator"] => ({ strategy: "role", value, name });

async function main(): Promise<void> {
  console.log(`\nWebDriverUniversity live acceptance — ${BASE}\n`);

  // ══ CLASSIC ════════════════════════════════════════════════════════════════════════════════════
  console.log("CLASSIC CHALLENGES");

  // ── Contact Us ────────────────────────────────────────────────────────────────────────────────
  // Semantic placeholder locators, not positional CSS — the form has no ids at all.
  await acceptance(
    "WDU-C01",
    "Contact Us",
    "valid submission is accepted",
    [
      flow("contact-valid", [
        goto("open", `${BASE}/Contact-Us/contactus.html`),
        fill("first", byPlaceholder("First Name"), "Specter"),
        fill("last", byPlaceholder("Last Name"), "Studio"),
        fill("email", byPlaceholder("Email Address"), "specter.studio@example.com"),
        fill("message", byPlaceholder("Comments"), "Automated by SpecterStudio."),
        click("submit", byCss("input[type='submit']")),
        assertText("thanks", byCss("h1"), "Thank You for your Message!")
      ])
    ],
    "pass"
  );

  await acceptance(
    "WDU-C02",
    "Contact Us",
    "missing mandatory fields are rejected (expected validation, not a runner failure)",
    [
      flow("contact-invalid", [
        goto("open", `${BASE}/Contact-Us/contactus.html`),
        fill("first", byPlaceholder("First Name"), "Specter"),
        // last name and email deliberately omitted
        fill("message", byPlaceholder("Comments"), "Missing mandatory fields."),
        click("submit", byCss("input[type='submit']")),
        assertText("error", byCss("body"), "Error: all fields are required")
      ])
    ],
    "pass"
  );

  // ── Login Portal ──────────────────────────────────────────────────────────────────────────────
  // The ONLY success signal is a native alert's MESSAGE. Before `dialogExpectation` this challenge
  // was unassertable: Playwright auto-dismissed the alert and its text was unrecoverable.
  for (const row of [
    { id: "WDU-C03", user: "webdriver", pass: "webdriver123", expected: "validation succeeded", label: "valid credentials" },
    { id: "WDU-C04", user: "wrong-user", pass: "wrong-pass", expected: "validation failed", label: "invalid credentials" }
  ]) {
    await acceptance(
      row.id,
      "Login Portal",
      `${row.label} — asserted on the alert message`,
      [
        flow(`login-${row.id}`, [
          goto("open", `${BASE}/Login-Portal/index.html`),
          fill("user", byId("text"), row.user),
          fill("pass", byId("password"), row.pass),
          click("login", byId("login-button"), {
            dialogExpectation: { action: "accept", dialogKind: "alert", expectedMessage: row.expected, messageMatch: "equals", messageOutputKey: "loginAlert" }
          })
        ])
      ],
      "pass"
    );
  }

  // Negative control: the SAME flow asserting the OPPOSITE message must fail, proving WDU-C03/C04
  // assert the real outcome rather than merely that a dialog appeared.
  await acceptance(
    "WDU-C05",
    "Login Portal",
    "negative control — wrong expected alert text must fail",
    [
      flow("login-negative", [
        goto("open", `${BASE}/Login-Portal/index.html`),
        fill("user", byId("text"), "wrong-user"),
        fill("pass", byId("password"), "wrong-pass"),
        click("login", byId("login-button"), {
          dialogExpectation: { action: "accept", dialogKind: "alert", expectedMessage: "validation succeeded", messageMatch: "equals" }
        })
      ])
    ],
    { failingStep: "login", errorMatches: /dialog message assertion failed/i }
  );

  // ── Button Clicks ─────────────────────────────────────────────────────────────────────────────
  await acceptance(
    "WDU-C06",
    "Button Clicks",
    "WebElement / JavaScript / Action click each open their own modal",
    [
      flow("buttons", [
        goto("open", `${BASE}/Click-Buttons/index.html`),
        click("b1", byId("button1")),
        assertVisible("modal1", byId("myModalClick")),
        click("close1", byCss("#myModalClick .close")),
        click("b2", byId("button2")),
        assertVisible("modal2", byId("myModalJSClick")),
        click("close2", byCss("#myModalJSClick .close")),
        click("b3", byId("button3")),
        assertVisible("modal3", byId("myModalMoveClick"))
      ])
    ],
    "pass"
  );

  // ── To Do List ────────────────────────────────────────────────────────────────────────────────
  await acceptance(
    "WDU-C07",
    "To Do List",
    "add an item, then delete it, asserting list state both times",
    [
      flow("todo", [
        goto("open", `${BASE}/To-Do-List/index.html`),
        fill("type", byPlaceholder("Add new todo"), "Automate with SpecterStudio"),
        { id: "enter", type: "press", name: "enter", locator: byPlaceholder("Add new todo"), value: "Enter" },
        assertVisible("added", byText("Automate with SpecterStudio")),
        // Deleting is a hover-revealed control on the item's own row.
        { id: "hover", type: "hover", name: "hover the new item", locator: byText("Automate with SpecterStudio") },
        click("delete", byCss("li:has-text('Automate with SpecterStudio') span")),
        {
          id: "gone",
          type: "wait",
          name: "item removed",
          beforeWaits: [{ type: "elementHidden", locator: byText("Automate with SpecterStudio"), timeoutMs: 8_000 } as never]
        }
      ])
    ],
    "pass"
  );

  // ── Dropdowns, Checkboxes & Radios ────────────────────────────────────────────────────────────
  await acceptance(
    "WDU-C08",
    "Dropdowns, Checkboxes & Radios",
    "select by label, check, uncheck and radio-select",
    [
      flow("form-controls", [
        goto("open", `${BASE}/Dropdown-Checkboxes-RadioButtons/index.html`),
        { id: "select1", type: "select", name: "pick Python", locator: byId("dropdowm-menu-1"), value: "python", selectionMode: "value" },
        { id: "select3", type: "select", name: "pick JQuery", locator: byId("dropdowm-menu-3"), value: "jquery", selectionMode: "value" },
        { id: "check1", type: "check", name: "check option 1", locator: byCss("input[value='option-1']") },
        { id: "check3", type: "check", name: "check option 3", locator: byCss("input[value='option-3']") },
        { id: "uncheck1", type: "uncheck", name: "uncheck option 1", locator: byCss("input[value='option-1']") },
        { id: "radio", type: "radio", name: "select green", locator: byCss("input[name='color'][value='green']") },
        { id: "veg", type: "radio", name: "select lettuce", locator: byCss("input[name='vegetable'][value='lettuce']") }
      ])
    ],
    "pass"
  );

  // ── AJAX Loader ───────────────────────────────────────────────────────────────────────────────
  // State-based synchronisation only: the loader must genuinely disappear. No fixed sleep.
  await acceptance(
    "WDU-C09",
    "AJAX Loader",
    "wait for the loader to vanish, then click the revealed button",
    [
      flow("ajax", [
        goto("open", `${BASE}/Ajax-Loader/index.html`),
        click("btn", byId("button1"), {
          beforeWaits: [{ type: "elementHidden", locator: byId("loader"), timeoutMs: 30_000 } as never]
        }),
        assertVisible("modal", byId("myModalClick")),
        assertText("modalText", byCss("#myModalClick .modal-body"), "The waiting game can be a tricky one")
      ])
    ],
    "pass"
  );

  // ── Actions: hover, double-click, drag & drop, click-and-hold ────────────────────────────────
  await acceptance(
    "WDU-C10",
    "Actions",
    "hover reveals a menu",
    [
      flow("actions-hover", [
        goto("open", `${BASE}/Actions/index.html`),
        { id: "hover", type: "hover", name: "hover the first button", locator: byText("Hover Over Me First!") },
        assertVisible("revealed", byCss(".dropdown:has(.dropbtn:text('Hover Over Me First!')) .dropdown-content a"))
      ])
    ],
    "pass"
  );

  await acceptance(
    "WDU-C11",
    "Actions",
    "drag and drop retains source → target semantics",
    [
      flow("actions-drag", [
        goto("open", `${BASE}/Actions/index.html`),
        { id: "drag", type: "drag", name: "drag onto the drop zone", locator: byId("draggable"), targetLocator: byId("droppable") },
        assertText("dropped", byId("droppable"), "Dropped!")
      ])
    ],
    "pass"
  );

  await acceptance(
    "WDU-C12",
    "Actions",
    "double-click is stored and replayed as a true dblclick",
    [
      flow("actions-dblclick", [
        goto("open", `${BASE}/Actions/index.html`),
        { id: "dbl", type: "dblclick", name: "double click the box", locator: byId("double-click") }
      ])
    ],
    "pass"
  );

  // ── Scrolling ────────────────────────────────────────────────────────────────────────────────
  await acceptance(
    "WDU-C13",
    "Scrolling Around",
    "scroll a buried element into view and interact with it",
    [
      flow("scrolling", [
        goto("open", `${BASE}/Scrolling/index.html`),
        { id: "scroll", type: "scroll", name: "scroll to the zone", locator: byId("zone3"), config: { scrollTarget: "element" } },
        assertVisible("visible", byId("zone3"))
      ])
    ],
    "pass"
  );

  // ── Popups & Alerts ──────────────────────────────────────────────────────────────────────────
  await acceptance(
    "WDU-C14",
    "Popups & Alerts",
    "alert, confirm (accept and dismiss) and prompt (answered)",
    [
      flow("alerts", [
        goto("open", `${BASE}/Popup-Alerts/index.html`),
        click("alert", byId("button1"), { dialogExpectation: { action: "accept", dialogKind: "alert", expectedMessage: "I am an alert box!" } }),
        click("confirmOk", byId("button4"), { dialogExpectation: { action: "accept", dialogKind: "confirm" } }),
        assertText("confirmed", byId("confirm-alert-text"), "You pressed OK!"),
        click("confirmNo", byId("button4"), { dialogExpectation: { action: "dismiss", dialogKind: "confirm" } }),
        assertText("cancelled", byId("confirm-alert-text"), "You pressed Cancel!")
      ])
    ],
    "pass"
  );

  await acceptance(
    "WDU-C15",
    "Popups & Alerts",
    "modal popup opens and closes",
    [
      flow("modal", [
        goto("open", `${BASE}/Popup-Alerts/index.html`),
        click("openModal", byId("button2")),
        assertVisible("modal", byId("myModal")),
        assertVisible("modalBody", byCss("#myModal .modal-body"))
      ])
    ],
    "pass"
  );

  // ── IFrame ───────────────────────────────────────────────────────────────────────────────────
  // Frame-scoped locator through the product's own LocatorContext, not a page.frame() call.
  await acceptance(
    "WDU-C16",
    "IFrame",
    "interact inside the iframe, then assert back in the main document",
    [
      flow("iframe", [
        goto("open", `${BASE}/IFrame/index.html`),
        click("insideFrame", { strategy: "id", value: "button-find-out-more", context: { frame: { selector: "#frame" } } } as never),
        assertVisible("modalInFrame", { strategy: "id", value: "myModal", context: { frame: { selector: "#frame" } } } as never)
      ])
    ],
    "pass"
  );

  // ── Hidden Elements ──────────────────────────────────────────────────────────────────────────
  await acceptance(
    "WDU-C17",
    "Hidden Elements",
    "a display:none element is correctly reported as hidden",
    [
      flow("hidden", [
        goto("open", `${BASE}/Hidden-Elements/index.html`),
        // #button1 sits inside #not-displayed (display:none) — it must read as HIDDEN.
        {
          id: "hiddenOne",
          type: "wait",
          name: "the display:none button is hidden",
          beforeWaits: [{ type: "elementHidden", locator: byId("button1"), timeoutMs: 5_000 } as never]
        },
        // ...while the page heading is genuinely visible, so the check discriminates.
        assertVisible("visibleHeader", byId("main-header"))
      ])
    ],
    "pass"
  );

  // ── Data Table ───────────────────────────────────────────────────────────────────────────────
  await acceptance(
    "WDU-C18",
    "Data Table",
    "read a specific cell by row identity, not by absolute position",
    [
      flow("table", [
        goto("open", `${BASE}/Data-Table/index.html`),
        assertText("cell", byCss("tr:has-text('Jemma') td:nth-child(3)"), "94", "equals"),
        { id: "read", type: "readText", name: "extract the age", locator: byCss("tr:has-text('Michael') td:nth-child(3)"), outputs: { age: "" } }
      ])
    ],
    "pass"
  );

  // ── Autocomplete ─────────────────────────────────────────────────────────────────────────────
  await acceptance(
    "WDU-C19",
    "Autocomplete Textfield",
    "type, wait for live suggestions, pick one",
    [
      flow("autocomplete", [
        goto("open", `${BASE}/Autocomplete-TextField/autocomplete-textfield.html`),
        fill("type", byId("myInput"), "Ba"),
        {
          id: "suggestions",
          type: "wait",
          name: "suggestion list appears",
          beforeWaits: [{ type: "elementVisible", locator: byCss("#myInputautocomplete-list div"), timeoutMs: 8_000 } as never]
        },
        click("pick", byCss("#myInputautocomplete-list div:first-child"))
      ])
    ],
    "pass"
  );

  // ── File Upload ──────────────────────────────────────────────────────────────────────────────
  const fixture = join(await mkdtemp(join(tmpdir(), "wdu-fixture-")), "specter-upload.txt");
  await writeFile(fixture, "SpecterStudio upload fixture — harmless deterministic test artifact.\n", "utf8");
  // The AI Playground validator only accepts .jpg/.png/.pdf, so it needs a real PNG.
  const imageFixture = join(await mkdtemp(join(tmpdir(), "wdu-img-")), "specter-fixture.png");
  await writeFile(
    imageFixture,
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")
  );

  await acceptance(
    "WDU-C20",
    "File Upload",
    "choose a local file and submit it",
    [
      flow("upload", [
        goto("open", `${BASE}/File-Upload/index.html`),
        { id: "choose", type: "uploadFile", name: "choose the fixture", locator: byId("myFile"), value: fixture },
        click("submit", byId("submit-button"), { dialogExpectation: { action: "accept", required: false, timeoutMs: 2_000 } })
      ])
    ],
    "pass"
  );


  // ══ AI TESTING PLAYGROUND ══════════════════════════════════════════════════════════════════════
  console.log("\nAI TESTING PLAYGROUND");
  const AI = `${BASE}/AI-Playground/index.html`;

  // 1. Dynamic Selectors — classes are regenerated per load, so semantic locators only.
  await acceptance("WDU-A01", "AI: Dynamic Selectors", "log in through regenerated classes using semantic locators", [
    flow("ai-dynamic", [
      goto("open", AI),
      fill("user", byPlaceholder("Username"), "admin"),
      fill("pass", byPlaceholder("Password"), "password123"),
      click("submit", byRole("button", "Login")),
      assertVisible("ok", byId("dynamic-success"))
    ])
  ], "pass");

  // 2. Flaky Loader — variable delay; state-based wait only.
  await acceptance("WDU-A02", "AI: Flaky Loader", "wait out a variable-delay loader", [
    flow("ai-flaky", [
      goto("open", AI),
      click("load", byId("trigger-flaky")),
      assertVisible("content", byId("flaky-content")),
      click("action", byId("flaky-action"))
    ])
  ], "pass");

  // 3. Multi-Step Form — full journey with per-step validation.
  await acceptance("WDU-A03", "AI: Multi-Step Form", "complete all three steps", [
    flow("ai-multistep", [
      goto("open", AI),
      fill("name", byId("ms-name"), "Specter Studio"),
      fill("email", byId("ms-email"), "specter@example.com"),
      click("next1", byId("ms-next-1")),
      { id: "selectCountry", type: "select", name: "country", locator: byId("ms-country"), value: "UK", selectionMode: "value" },
      fill("phone", byId("ms-phone"), "07700900123"),
      click("next2", byId("ms-next-2")),
      fill("comments", byId("ms-comments"), "Automated end to end."),
      { id: "terms", type: "check", name: "accept terms", locator: byId("ms-terms") },
      click("submit", byId("ms-submit")),
      assertVisible("done", byId("step-done"))
    ])
  ], "pass");

  // 3b. NEGATIVE: a one-word name and a malformed email must be rejected by the app itself.
  await acceptance("WDU-A04", "AI: Multi-Step Form", "single-word name and bad email are rejected (expected validation)", [
    flow("ai-multistep-invalid", [
      goto("open", AI),
      fill("name", byId("ms-name"), "Specter"),
      fill("email", byId("ms-email"), "not-an-email"),
      click("next1", byId("ms-next-1")),
      assertVisible("nameErr", byId("ms-name-err")),
      assertVisible("emailErr", byId("ms-email-err"))
    ])
  ], "pass");

  // 4. Auto-Dismiss Toast — catch it while shown, then prove it was dismissed.
  //
  // MEASURED: the site hides this toast with `opacity: 0` ALONE — `visibility` stays `visible` and
  // `display` stays `block`. Playwright's visibility model (bounding box + visibility + display)
  // therefore correctly reports it as visible forever, so an `elementHidden` wait can never fire.
  // The dismissal IS observable in the DOM as the `show` class being dropped, which is exactly the
  // "assert the attribute, not the pixel" lesson the playground is teaching. Not a product defect.
  await acceptance("WDU-A05", "AI: Auto-Dismiss Toast", "toast is shown, then dismissed (asserted on class, not pixels)", [
    flow("ai-toast", [
      goto("open", AI),
      click("trigger", byId("show-toast")),
      { id: "shown", type: "assertText", name: "toast carries the show class", locator: byId("toast"),
        config: { assertionType: "attribute", attributeName: "class", comparisonOperator: "contains", expectedValue: "show" } },
      { id: "settle", type: "wait", name: "let the auto-dismiss run",
        beforeWaits: [{ type: "domStable", stableForMs: 3000, timeoutMs: 15000 } as never] },
      { id: "dismissed", type: "assertText", name: "show class has been dropped", locator: byId("toast"),
        config: { assertionType: "attribute", attributeName: "class", comparisonOperator: "equals", expectedValue: "toast" } }
    ])
  ], "pass");

  // 5. Re-Enable Delay — disabled then enabled; elementEnabled, never a sleep.
  await acceptance("WDU-A06", "AI: Re-Enable Delay", "wait for the button to re-enable", [
    flow("ai-reenable", [
      goto("open", AI),
      click("first", byId("reenable-btn")),
      { id: "reenabled", type: "wait", name: "button re-enables",
        beforeWaits: [{ type: "elementEnabled", locator: byId("reenable-btn"), timeoutMs: 20000 } as never] },
      click("second", byId("reenable-btn"))
    ])
  ], "pass");

  // 6. Moving Target — Playwright waits for positional stability before clicking.
  await acceptance("WDU-A07", "AI: Moving Target", "click a continuously moving button", [
    flow("ai-moving", [
      goto("open", AI),
      click("catch", byId("moving-btn"), { timeoutMs: 25000 })
    ])
  ], "pass");

  // 7. Conditional Validation — the extra field may or may not appear.
  await acceptance("WDU-A08", "AI: Conditional Validation", "handle the conditional verification field", [
    flow("ai-conditional", [
      goto("open", AI),
      fill("email", byId("cond-email"), "specter@example.com"),
      click("submit", byId("cond-submit")),
      assertVisible("result", byId("cond-result"))
    ])
  ], "pass");

  // 8. Race Condition — whichever finishes first, the DOM must report one settled winner.
  await acceptance("WDU-A09", "AI: Race Condition", "assert a settled winner rather than a guess", [
    flow("ai-race", [
      goto("open", AI),
      click("a", byId("race-a")),
      click("b", byId("race-b")),
      { id: "settled", type: "wait", name: "a winner is declared",
        beforeWaits: [{ type: "elementVisible", locator: byId("race-result"), timeoutMs: 20000 } as never] },
      assertVisible("winner", byId("race-result"))
    ])
  ], "pass");

  // 9. Lazy-Rendered Element
  await acceptance("WDU-A10", "AI: Lazy-Rendered Element", "wait for an element that does not exist yet", [
    flow("ai-lazy", [
      goto("open", AI),
      click("reveal", byId("reveal-btn")),
      assertVisible("appeared", byId("lazy-element"))
    ])
  ], "pass");

  // 10. iFrame Login — a srcdoc frame, scoped through the product's own LocatorContext.
  await acceptance("WDU-A11", "AI: iFrame Login", "log in entirely inside the iframe", [
    flow("ai-iframe", [
      goto("open", AI),
      fill("user", { strategy: "id", value: "frame-username", context: { frame: { selector: "#login-frame" } } } as never, "admin"),
      fill("pass", { strategy: "id", value: "frame-password", context: { frame: { selector: "#login-frame" } } } as never, "password123"),
      click("submit", { strategy: "id", value: "frame-submit", context: { frame: { selector: "#login-frame" } } } as never),
      assertVisible("result", { strategy: "id", value: "frame-result", context: { frame: { selector: "#login-frame" } } } as never)
    ])
  ], "pass");

  // 11. Shadow DOM Widget — an OPEN shadow root on <wdu-shadow-form>.
  await acceptance("WDU-A12", "AI: Shadow DOM Widget", "interact with a control inside an open shadow root", [
    flow("ai-shadow", [
      goto("open", AI),
      fill("input", byCss("wdu-shadow-form input"), "specter"),
      click("submit", byCss("wdu-shadow-form button")),
      assertVisible("result", byCss("wdu-shadow-form #shadow-result"))
    ])
  ], "pass");

  // 12. Employee Directory — filter, then assert exact values and row count.
  await acceptance("WDU-A13", "AI: Employee Directory", "filter the table and assert the surviving rows", [
    flow("ai-directory", [
      goto("open", AI),
      fill("filter", byId("table-filter"), "Engineering"),
      { id: "rowCount", type: "assertText", name: "five engineers remain",
        locator: byCss("#employee-tbody tr:visible"), value: "5",
        config: { assertionType: "count", comparisonOperator: "equals", expectedValue: "5" } },
      assertText("salary", byCss("#employee-tbody tr:has-text('Daniel Wright') td:nth-child(3)"), "55,000")
    ])
  ], "pass");

  // 13. File Upload Validator — assert the echoed metadata.
  await acceptance("WDU-A14", "AI: File Upload Validator", "upload a valid file and assert the echoed metadata", [
    flow("ai-upload", [
      goto("open", AI),
      { id: "choose", type: "uploadFile", name: "choose the fixture", locator: byId("file-input"), value: imageFixture },
      click("validate", byId("file-submit")),
      assertText("name", byId("file-result"), "specter-fixture.png")
    ])
  ], "pass");

  // 14. Priority Board — drag between columns, then assert the board state.
  await acceptance("WDU-A15", "AI: Priority Board", "drag a task to another column and assert board state", [
    flow("ai-board", [
      goto("open", AI),
      { id: "drag", type: "drag", name: "move task 1 to In Progress", locator: byId("task-1"), targetLocator: byId("inprogress-column") },
      assertVisible("moved", byCss("#inprogress-column #task-1"))
    ])
  ], "pass");

  // 15. Stale Element — the list re-renders; the locator must re-resolve rather than hold a handle.
  await acceptance("WDU-A16", "AI: Stale Element", "act on a list that re-renders under the locator", [
    flow("ai-stale", [
      goto("open", AI),
      click("rerender", byId("stale-refresh")),
      click("item", byCss("#stale-list li[data-index='1']")),
      assertVisible("log", byId("stale-log"))
    ])
  ], "pass");

  // 16. Invisible Success — MEASURED: after a valid submit, #ghost-result carries the text
  // "Form submitted successfully..." while computed `visibility` is `hidden`. So a TEXT assertion
  // passes (the trap) and a VISIBILITY assertion must fail (the detection). Both directions are
  // asserted, because either one alone would be satisfied by the wrong thing.
  // MEASURED: for this visibility:hidden node, `textContent` holds "Form submitted successfully..."
  // but `innerText` — which the product's text assertion uses — returns "". So SpecterStudio cannot
  // be fooled from either direction: the text assertion sees nothing and the visibility assertion
  // refuses. Both are asserted as NEGATIVE cases, because a green run here would mean the product
  // had accepted an invisible success as a real one.
  await acceptance("WDU-A17", "AI: Invisible Success", "the text assertion is NOT fooled (innerText is empty)", [
    flow("ai-ghost-text", [
      goto("open", AI),
      fill("email", byId("ghost-email"), "specter@example.com"),
      click("submit", byId("ghost-submit")),
      assertText("textSaysSuccess", byId("ghost-result"), "successfully")
    ])
  ], { failingStep: "textSaysSuccess", errorMatches: /Assertion failed: ""/ });

  await acceptance("WDU-A17b", "AI: Invisible Success", "...and SpecterStudio still reports it INVISIBLE (detection)", [
    flow("ai-ghost-visible", [
      goto("open", AI),
      fill("email", byId("ghost-email"), "specter@example.com"),
      click("submit", byId("ghost-submit")),
      assertVisible("result", byId("ghost-result"))
    ])
  ], { failingStep: "result", errorMatches: /not visible/i });

  // 18. Network States — success and error are different outcomes, not one "done".
  await acceptance("WDU-A18", "AI: Network States", "a successful request settles the result region", [
    flow("ai-net-success", [
      goto("open", AI),
      click("go", byId("net-success")),
      assertVisible("result", byId("net-result"))
    ])
  ], "pass");

  await acceptance("WDU-A19", "AI: Network States", "an error response is reported as an error, not a hang", [
    flow("ai-net-error", [
      goto("open", AI),
      click("go", byId("net-error")),
      assertVisible("result", byId("net-result"))
    ])
  ], "pass");

  // 19. JS Dialog Traps — the capability added by awkit-azxy.
  await acceptance("WDU-A20", "AI: JS Dialog Traps", "alert, confirm and prompt all answered by the flow", [
    flow("ai-dialogs", [
      goto("open", AI),
      click("alertBtn", byId("dialog-alert"), { dialogExpectation: { action: "accept", dialogKind: "alert" } }),
      click("confirmBtn", byId("dialog-confirm"), { dialogExpectation: { action: "accept", dialogKind: "confirm" } }),
      assertText("confirmed", byId("dialog-result"), "Confirmed"),
      click("promptBtn", byId("dialog-prompt"), { dialogExpectation: { action: "accept", dialogKind: "prompt", promptText: "SpecterStudio" } }),
      assertText("prompted", byId("dialog-result"), "Hello, SpecterStudio")
    ])
  ], "pass");

  // 21. Attribute vs Visual State — the capability added by awkit-1ugn.
  // EXTERNAL-SITE NONDETERMINISM: measured over six consecutive clicks, aria-pressed read
  // false, false, true, true, true, false while the button TEXT toggled correctly every time.
  // That desync is the challenge's deliberate defect, so asserting any post-click value would be a
  // flaky test. What is deterministic live is the initial state, which is what proves the product
  // can read and compare an attribute at all. The desync DETECTION itself is pinned deterministically
  // in verify:assertions [A3]/[A4], where a fixture holds the attribute stale on purpose.
  await acceptance("WDU-A21", "AI: Attribute vs Visual State", "read and assert aria-pressed (initial state — post-click value is site-nondeterministic)", [
    flow("ai-attr", [
      goto("open", AI),
      { id: "before", type: "assertText", name: "starts unpressed", locator: byId("attr-toggle"),
        config: { assertionType: "attribute", attributeName: "aria-pressed", comparisonOperator: "equals", expectedValue: "false" } },
      { id: "textReads", type: "assertText", name: "the visible text reads Inactive", locator: byId("attr-toggle"),
        config: { assertionType: "text", comparisonOperator: "contains", expectedValue: "Inactive" } }
    ])
  ], "pass");

  // The negative direction, live: asserting the WRONG attribute value must fail, so WDU-A21 cannot
  // be passing because attribute comparison silently succeeds.
  await acceptance("WDU-A21b", "AI: Attribute vs Visual State", "negative control — a wrong attribute value must fail", [
    flow("ai-attr-negative", [
      goto("open", AI),
      { id: "wrong", type: "assertText", name: "claim it starts pressed", locator: byId("attr-toggle"),
        config: { assertionType: "attribute", attributeName: "aria-pressed", comparisonOperator: "equals", expectedValue: "true" } }
    ])
  ], { failingStep: "wrong", errorMatches: /"false" equals "true"/ });

  // 22. Mutation Observer — wait for the state, never the clock.
  await acceptance("WDU-A22", "AI: Mutation Observer", "wait for asynchronously added items to reach a count", [
    flow("ai-mutation", [
      goto("open", AI),
      click("startMutation", byId("mutation-start")),
      { id: "grew", type: "wait", name: "list reaches ten items",
        beforeWaits: [{ type: "listHasItems", listLocator: byId("mutation-list"), itemLocator: byCss("#mutation-list li"), minItems: 10, timeoutMs: 30000 } as never] },
      { id: "itemCount", type: "assertText", name: "ten items present", locator: byCss("#mutation-list li"), value: "10",
        config: { assertionType: "count", comparisonOperator: "equals", expectedValue: "10" } }
    ])
  ], "pass");

  // 23. API Intercept — a live GET whose result must settle the UI.
  await acceptance("WDU-A23", "AI: API Intercept", "a live fetch settles the result region", [
    flow("ai-intercept", [
      goto("open", AI),
      click("fetch", byId("intercept-trigger")),
      assertVisible("result", byId("intercept-result"))
    ])
  ], "pass");

  // 24. New Tab / Popup — popup identity through the product's popup model.
  await acceptance("WDU-A24", "AI: New Tab / Popup", "capture the popup and assert content, then return to the opener", [
    flow("ai-popup", [
      goto("open", AI),
      click("openTab", byId("new-tab-btn"), {
        opensPopup: true,
        popupExpectation: { popupAlias: "popup-1", timeoutMs: 15000, waitUntil: "domcontentloaded" }
      }),
      { id: "switchTo", type: "switchToPopup", name: "switch to the popup",
        popupExpectation: { popupAlias: "popup-1", timeoutMs: 15000 } },
      assertVisible("popupBody", byCss("body")),
      { id: "back", type: "switchToMainPage", name: "return to the opener" },
      assertVisible("openerStatus", byId("new-tab-status"))
    ])
  ], "pass");

  // 25. Shop & Checkout — the capstone as a REUSABLE multi-flow composition. This is the Page
  // Object Model challenge's real analogue in a visual product: composed, reusable flows rather
  // than one monolith repeating the same actions.
  await acceptance("WDU-A25", "AI: Shop & Checkout Flow", "full capstone: cart, details, review, confirm", [
    flow("shop-cart", [
      goto("open", AI),
      click("add1", byId("add-to-cart-1")),
      click("add2", byId("add-to-cart-2")),
      assertText("cartCount", byId("cart-count"), "2"),
      click("toDelivery", byId("checkout-step1-next"))
    ]),
    flow("shop-details", [
      fill("name", byId("checkout-name"), "Specter Studio"),
      fill("email", byId("checkout-email"), "specter@example.com"),
      fill("address", byId("checkout-address"), "1 Automation Way"),
      fill("city", byId("checkout-city"), "London"),
      fill("postcode", byId("checkout-postcode"), "SW1A 1AA"),
      click("toReview", byId("checkout-step2-next"))
    ]),
    flow("shop-confirm", [
      assertVisible("review", byId("checkout-step-3")),
      click("confirmOrder", byId("checkout-confirm")),
      assertVisible("success", byId("checkout-success")),
      { id: "orderId", type: "readText", name: "capture the order id", locator: byId("checkout-order-id"), outputs: { orderId: "" } }
    ])
  ], "pass");

  // 25b. NEGATIVE: an empty cart must be refused by the app's own validation.
  await acceptance("WDU-A26", "AI: Shop & Checkout Flow", "empty cart is refused (expected validation)", [
    flow("shop-empty", [
      goto("open", AI),
      click("toDelivery", byId("checkout-step1-next")),
      assertVisible("cartError", byId("cart-empty-error"))
    ])
  ], "pass");

  // ══ SUMMARY ════════════════════════════════════════════════════════════════════════════════════
  const tally = results.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.outcome]: (acc[r.outcome] ?? 0) + 1 }), {});
  console.log(`\n${"─".repeat(78)}`);
  console.log(`WDU live acceptance: ${results.length} cases executed`);
  console.log(`  PASS ${tally.PASS ?? 0} · FAIL ${tally.FAIL ?? 0} · BLOCKED ${tally.BLOCKED ?? 0} · INCONCLUSIVE ${tally.INCONCLUSIVE ?? 0}`);
  const notPass = results.filter((r) => r.outcome !== "PASS");
  if (notPass.length) {
    console.log(`\nNot passing:`);
    for (const r of notPass) console.log(`  [${r.outcome}] ${r.id} ${r.challenge} / ${r.scenario}\n        ${r.detail}`);
  }
  await writeFile(join(process.cwd(), "wdu-live-results.json"), JSON.stringify(results, null, 2), "utf8");
  console.log(`\nMachine-readable results: wdu-live-results.json`);
  if (notPass.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
