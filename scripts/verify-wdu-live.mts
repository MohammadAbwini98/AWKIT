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
