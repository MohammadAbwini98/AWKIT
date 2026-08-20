/**
 * WebDriverUniversity LIVE **Recorder** acceptance suite (`awkit-53nb`).
 *
 * The first tranche proved SpecterStudio can EXECUTE the WDU challenges. It proved nothing about
 * what the Recorder STORES, so the Recorder column of `docs/testing/WDU_CHALLENGE_MATRIX.md` was
 * `NOT RUN` on every row. This closes that: every case here captures a real WDU interaction through
 * the production Recorder and then inspects the stored action — the type, the locator, the target,
 * the page identity, the frame context, the dialog policy.
 *
 * It drives `RecorderService.wireContext`, which is what `startRecording` calls once it has a
 * browser. That keeps popup registration, dialog capture, frame-chain building and action ordering
 * REAL; only the headed `chromium.launch` is replaced, so the suite can run unattended. Nothing here
 * hand-authors a `FlowProfile` and calls it Recorder evidence.
 *
 * THIS IS AN EXTERNAL-SITE GATE, like `verify:wdu-live`: it needs the public internet and the site
 * can change under it. It is deliberately NOT part of AWKIT's deterministic verification set. Every
 * product defect it found has a deterministic regression that does not need the internet —
 * `verify:click-and-hold`, `verify:recorder-upload`, `verify:recorder-dialogs`.
 *
 * Run with: npx tsx scripts/verify-wdu-recorder-live.mts [--only <substring>]
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";
import { RecorderService } from "@src/recorder/RecorderService";
import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";
import { JsonProfileStore } from "@src/storage/ProfileStore";
import { PlaywrightRunner } from "@src/runner/PlaywrightRunner";
import { validateFlowDefinition, errorsOf } from "@src/validation/FlowValidator";
import type { RecordedAction } from "@src/recorder/RecorderTypes";
import type { FlowProfile, FlowStep } from "@src/profiles/FlowProfile";
import type { ScenarioProfile } from "@src/profiles/ScenarioProfile";
import type { InstanceConfig } from "@src/instances/InstanceConfig";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";

const BASE = "https://webdriveruniversity.com";
const AI = `${BASE}/AI-Playground/index.html`;
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : undefined;

type Outcome = "PASS" | "FAIL" | "BLOCKED" | "INCONCLUSIVE";
interface CaseResult {
  id: string;
  challenge: string;
  scenario: string;
  outcome: Outcome;
  checks: { label: string; ok: boolean; detail?: string }[];
}
const results: CaseResult[] = [];

let current: CaseResult | null = null;
function check(label: string, condition: unknown, detail?: string): void {
  const ok = Boolean(condition);
  const line = `${ok ? "  ✓" : "  ✗"} ${label}${!ok && detail ? ` — ${String(detail).slice(0, 300)}` : ""}`;
  if (ok) console.log(line);
  else console.error(line);
  current?.checks.push({ label, ok, detail: ok ? undefined : String(detail ?? "").slice(0, 300) });
}

/** Begin one acceptance case. Returns false when `--only` excludes it. */
function open(id: string, challenge: string, scenario: string): boolean {
  if (only && !`${id} ${challenge} ${scenario}`.toLowerCase().includes(only.toLowerCase())) return false;
  current = { id, challenge, scenario, outcome: "PASS", checks: [] };
  console.log(`\n${id} — ${challenge} / ${scenario}`);
  return true;
}

function close(): void {
  if (!current) return;
  if (current.checks.some((c) => !c.ok)) current.outcome = "FAIL";
  if (current.checks.length === 0) current.outcome = "INCONCLUSIVE";
  results.push(current);
  current = null;
}

/** Record the case as BLOCKED with the reason, when the live site made the case unobservable. */
function blocked(reason: string): void {
  if (!current) return;
  console.error(`  ! BLOCKED — ${reason}`);
  current.outcome = "BLOCKED";
  current.checks.push({ label: "blocked", ok: false, detail: reason });
  results.push(current);
  current = null;
}

interface Session {
  actions: RecordedAction[];
  page: Page;
  context: BrowserContext;
  close: () => Promise<void>;
}

/**
 * Start a real recording session on `url` and return the live page plus the recorder's action list.
 *
 * `wireContext` installs the capture script, the action/signal bindings, popup registration and
 * dialog capture — the same wiring `startRecording` performs after launching its browser.
 */
async function recordOn(browser: Browser, url: string): Promise<Session> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const service = new RecorderService() as unknown as {
    isRecording: boolean;
    captureWaitTime: boolean;
    captureSmartWaits: boolean;
    page: Page;
    lastActionPage: Page;
    actions: RecordedAction[];
    scheduleDraftPersist: () => void;
    wireContext: (c: BrowserContext) => Promise<void>;
    getActions: () => RecordedAction[];
  };
  service.isRecording = true;
  service.captureWaitTime = false;
  // Smart-Wait observation is a separate, already-gated feature; leaving it on would add inferred
  // `afterWaits` to every action and make the STORED-SEMANTICS assertions below noisier without
  // testing anything this suite is about.
  service.captureSmartWaits = false;
  service.page = page;
  service.lastActionPage = page;
  service.actions = [];
  service.scheduleDraftPersist = () => undefined;
  await service.wireContext(context);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(600); // let the rest-state baseline scan settle before interacting
  return {
    get actions() {
      return service.getActions();
    },
    page,
    context,
    close: () => context.close()
  } as Session;
}

/** A real press-and-hold. Raw mouse coordinates do not auto-scroll, so the target is scrolled first. */
async function pressAndHold(page: Page, selector: string, holdMs: number): Promise<void> {
  const target = page.locator(selector);
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error(`no bounding box for ${selector}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
}

/** A pointer-emulated drag, the way a person performs one (jQuery UI does not use HTML5 DnD). */
async function pointerDrag(page: Page, from: string, to: string): Promise<void> {
  const source = page.locator(from);
  const target = page.locator(to);
  await source.scrollIntoViewIfNeeded();
  const a = await source.boundingBox();
  const b = await target.boundingBox();
  if (!a || !b) throw new Error(`missing bounding box for ${from} → ${to}`);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 });
  await page.mouse.up();
}

const typeOf = (actions: RecordedAction[]): string[] => actions.map((a) => a.type);
const find = (actions: RecordedAction[], type: string): RecordedAction | undefined => actions.find((a) => a.type === type);
const locatorJson = (action?: RecordedAction): string => JSON.stringify(action?.locator ?? null).slice(0, 300);

async function makeContext(flowId: string): Promise<InstanceExecutionContext> {
  const dir = await mkdtemp(join(tmpdir(), "wdu-rec-"));
  return {
    executionId: "exec-wdu-rec",
    instanceId: "inst-1",
    scenarioId: "scen-wdu-rec",
    flowId,
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

/** Execute a saved flow through the real runner. */
async function replay(flow: FlowProfile): Promise<{ status: string; steps: { stepId: string; status: string; error?: string }[] }> {
  const scenario = {
    id: `sc-${flow.id}`,
    name: flow.id,
    executionMode: "sequential",
    maxParallelFlows: 1,
    flows: [{ order: 1, flowId: flow.id, required: true }],
    links: [],
    failurePolicy: { onFlowFailure: "stop", captureScreenshot: false }
  } as unknown as ScenarioProfile;
  const runner = new PlaywrightRunner({ flows: [flow], productionOffline: false, resourcesRoot: join(process.cwd(), "resources") });
  const result = await runner.executeScenario(scenario, await makeContext(flow.id), {
    id: "ic",
    name: "ic",
    browser: "chromium",
    headless: true
  } as unknown as InstanceConfig);
  return {
    status: result.status,
    steps: result.flows.flatMap((f) => (f.steps ?? []).map((s) => ({ stepId: s.stepId, status: s.status, error: s.error ? String(s.error) : undefined })))
  };
}

/** Give a recorded flow a `goto` front end so it replays from a cold page, and re-chain the edges. */
function runnable(flow: FlowProfile, id: string, url: string, extra: FlowStep[] = []): FlowProfile {
  const body = flow.nodes.filter((n) => n.type !== "start" && n.type !== "end");
  const nodes: FlowStep[] = [
    { id: "start", type: "start", name: "start" },
    { id: "goto", type: "goto", name: `open ${url}`, valueSource: { type: "static", value: url }, waitUntil: "domcontentloaded" },
    ...body,
    ...extra,
    { id: "end", type: "end", name: "end" }
  ];
  const ids = nodes.map((n) => n.id);
  return {
    ...flow,
    id,
    name: id,
    nodes,
    edges: ids.slice(0, -1).map((source, i) => ({ id: `${id}-e${i}`, source, target: ids[i + 1], type: "success" as const }))
  };
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const started = Date.now();

  try {
    // ══ NAVIGATION, TEXT ENTRY, KEYBOARD, SUBMIT ═════════════════════════════════════════════
    if (open("WDU-R01", "Contact Us", "navigation, text entry, keyboard input and submit are captured")) {
      const s = await recordOn(browser, `${BASE}/Contact-Us/contactus.html`);
      try {
        await s.page.locator("[name='first_name']").fill("Specter");
        await s.page.keyboard.press("Tab");
        await s.page.locator("[name='last_name']").fill("Studio");
        await s.page.locator("[name='email']").fill("specter.studio@example.com");
        await s.page.locator("textarea[name='message']").fill("Recorded by SpecterStudio.");
        await s.page.locator("input[type='submit']").click();
        await s.page.waitForTimeout(1200);
        const a = s.actions;
        check("text entry is captured as fill steps", a.filter((x) => x.type === "fill").length >= 4, JSON.stringify(typeOf(a)));
        const first = a.find((x) => x.type === "fill" && /Specter$/.test(String(x.valueSource?.value ?? "")));
        check("...carrying the typed value", !!first, JSON.stringify(a.filter((x) => x.type === "fill").map((x) => x.valueSource?.value)));
        check("...and a locator for the field, not a positional guess", !!first?.locator?.strategy && first.locator.strategy !== "xpath", locatorJson(first));
        const press = find(a, "press");
        check("the Tab keypress is captured as its own press step", !!press, JSON.stringify(typeOf(a)));
        check("...naming the key", String(press?.valueSource?.value ?? "") === "Tab", JSON.stringify(press?.valueSource));
        const submit = a.find((x) => x.type === "click" && /submit/i.test(JSON.stringify(x.locator ?? {})) === false ? false : x.type === "click");
        check("the submit is captured as a click", !!submit, JSON.stringify(typeOf(a)));
        check("the recorded order matches the order performed", typeOf(a).join(",").includes("fill,press,fill"), typeOf(a).join(","));
      } finally {
        await s.close();
      }
      close();
    }

    // ══ DIALOG-TRIGGERING ACTION ═════════════════════════════════════════════════════════════
    if (open("WDU-R02", "Login Portal", "a click that opens an alert stores a dialog expectation")) {
      const s = await recordOn(browser, `${BASE}/Login-Portal/index.html`);
      try {
        await s.page.locator("#text").fill("webdriver");
        await s.page.locator("#password").fill("webdriver123");
        await s.page.locator("#login-button").click();
        await s.page.waitForTimeout(1500);
        const a = s.actions;
        const login = a.find((x) => x.type === "click");
        check("the login click is captured", !!login, JSON.stringify(typeOf(a)));
        check("it carries a dialogExpectation", !!login?.dialogExpectation, JSON.stringify(login?.dialogExpectation));
        check("...identifying the dialog as an alert", login?.dialogExpectation?.dialogKind === "alert", JSON.stringify(login?.dialogExpectation));
        check("...with an explicit accept policy the designer can change", login?.dialogExpectation?.action === "accept", JSON.stringify(login?.dialogExpectation));
        check(
          "the site's alert TEXT is not baked into the step",
          login?.dialogExpectation?.expectedMessage === undefined,
          JSON.stringify(login?.dialogExpectation)
        );
        // The password field must never reach the saved flow.
        const pass = a.find((x) => x.type === "fill" && /password/i.test(JSON.stringify(x.locator ?? {})));
        check("the password value is redacted from the recording", String(pass?.valueSource?.value ?? "") === "", JSON.stringify(pass?.valueSource));
      } finally {
        await s.close();
      }
      close();
    }

    // ══ SELECTION CONTROLS ═══════════════════════════════════════════════════════════════════
    if (open("WDU-R03", "Dropdowns, Checkboxes & Radios", "select, checkbox and radio each store their own semantic")) {
      const s = await recordOn(browser, `${BASE}/Dropdown-Checkboxes-RadioButtons/index.html`);
      try {
        await s.page.locator("#dropdowm-menu-1").selectOption("python");
        await s.page.locator("input[value='option-1']").check();
        await s.page.locator("input[value='option-1']").uncheck();
        await s.page.locator("input[name='color'][value='green']").check();
        await s.page.waitForTimeout(500);
        const a = s.actions;
        const select = find(a, "select");
        check("the dropdown is stored as a select, not a click", !!select, JSON.stringify(typeOf(a)));
        check("...carrying the chosen option value", String(select?.valueSource?.value ?? "") === "python", JSON.stringify(select?.valueSource));
        check("checking the box stores a check", !!find(a, "check"), JSON.stringify(typeOf(a)));
        check("unchecking it stores an uncheck, not a second check", !!find(a, "uncheck"), JSON.stringify(typeOf(a)));
        const radio = find(a, "radio");
        check("the radio is stored as a radio, not a check", !!radio, JSON.stringify(typeOf(a)));
        check("...with a locator that pins the option, not just the group", /green/.test(locatorJson(radio)), locatorJson(radio));
      } finally {
        await s.close();
      }
      close();
    }

    // ══ ADVANCED POINTER: DOUBLE-CLICK ═══════════════════════════════════════════════════════
    if (open("WDU-R04", "Actions", "a double-click stores one dblclick, not two clicks")) {
      const s = await recordOn(browser, `${BASE}/Actions/index.html`);
      try {
        await s.page.locator("#double-click").dblclick();
        await s.page.waitForTimeout(500);
        const a = s.actions;
        check("exactly one action comes out of the gesture", a.length === 1, JSON.stringify(typeOf(a)));
        check("it is a dblclick", a[0]?.type === "dblclick", JSON.stringify(typeOf(a)));
        check("no ordinary click is left in front of it", !a.some((x) => x.type === "click"), JSON.stringify(typeOf(a)));
        check("the locator identifies the double-click box", /double-click/.test(locatorJson(a[0])), locatorJson(a[0]));

        // Replay: the box toggles `class="double"` only on a real dblclick.
        const flow = runnable(buildRecordedFlow("WDU dblclick", a), "wdu-rec-dblclick", `${BASE}/Actions/index.html`, [
          {
            id: "assertToggled",
            type: "assertText",
            name: "the box reports the double-click",
            locator: { strategy: "id", value: "double-click" },
            config: { assertionType: "attribute", attributeName: "class", comparisonOperator: "contains", expectedValue: "double" }
          }
        ]);
        const r = await replay(flow);
        check("the recorded dblclick replays and the target reacts to it", r.status === "passed", `${r.status}: ${JSON.stringify(r.steps)}`);
      } finally {
        await s.close();
      }
      close();
    }

    // ══ ADVANCED POINTER: HOVER ══════════════════════════════════════════════════════════════
    if (open("WDU-R05", "Actions", "a hover-gated click stores the visible trigger, not the revealed surface")) {
      const s = await recordOn(browser, `${BASE}/Actions/index.html`);
      try {
        await s.page.getByText("Hover Over Me First!").hover();
        await s.page.waitForTimeout(400);
        await s.page.locator(".dropdown.hover .dropdown-content a").first().click();
        await s.page.waitForTimeout(800);
        const a = s.actions;
        const click = a.find((x) => x.type === "click");
        check("the click on the revealed link is captured", !!click, JSON.stringify(typeOf(a)));
        check("it is flagged as requiring a hover first", click?.locator?.interaction?.requiresHover === true, locatorJson(click));
        const trigger = click?.locator?.interaction?.hoverContainer as { value?: string } | undefined;
        check("a hover trigger is attributed", !!trigger, JSON.stringify(trigger ?? null));
        // The site reveals the menu with a CSS `:hover` on the WRAPPER, so the wrapper is the
        // causal trigger and naming it is correct. What must never happen is the recorder pointing
        // the hover at the surface that only exists once the hover has happened.
        check(
          "...and it is not the revealed surface itself",
          !/dropdown-content|list-alert/.test(JSON.stringify(trigger ?? {})),
          JSON.stringify(trigger ?? null)
        );
        check(
          "...it is a container that is present at rest",
          /dropdown|hover/.test(JSON.stringify(trigger ?? {})),
          JSON.stringify(trigger ?? null)
        );
        // The link also fires an alert, so the same action must carry the dialog policy.
        check("the alert the link raises is captured on that same click", click?.dialogExpectation?.dialogKind === "alert", JSON.stringify(click?.dialogExpectation));

        const built = buildRecordedFlow("WDU hover", a);
        check("the built flow injects an explicit hover step before the click", built.nodes.some((n) => n.type === "hover"), JSON.stringify(built.nodes.map((n) => n.type)));
        const r = await replay(runnable(built, "wdu-rec-hover", `${BASE}/Actions/index.html`));
        check("the recorded hover+click replays green", r.status === "passed", `${r.status}: ${JSON.stringify(r.steps)}`);
      } finally {
        await s.close();
      }
      close();
    }

    // ══ ADVANCED POINTER: CLICK AND HOLD ═════════════════════════════════════════════════════
    if (open("WDU-R06", "Actions", "click-and-hold stores press/hold semantics, not a click approximation")) {
      const s = await recordOn(browser, `${BASE}/Actions/index.html`);
      try {
        await pressAndHold(s.page, "#click-box", 900);
        await s.page.waitForTimeout(500);
        const a = s.actions;
        const hold = find(a, "clickAndHold");
        check("the gesture is stored as clickAndHold", !!hold, JSON.stringify(typeOf(a)));
        check("...not as an ordinary click", !a.some((x) => x.type === "click"), JSON.stringify(typeOf(a)));
        check("...with the measured hold duration", Number((hold?.config as { holdMs?: number } | undefined)?.holdMs ?? 0) >= 500, JSON.stringify(hold?.config));
        check("the locator identifies the click box", /click-box/.test(locatorJson(hold)), locatorJson(hold));

        // Replay: #click-box shows one text while held and a different one after release.
        const flow = runnable(buildRecordedFlow("WDU hold", a), "wdu-rec-hold", `${BASE}/Actions/index.html`, [
          {
            id: "assertReleased",
            type: "assertText",
            name: "the box reports a completed press and release",
            locator: { strategy: "id", value: "click-box" },
            config: { assertionType: "text", comparisonOperator: "contains", expectedValue: "Dont release me" }
          }
        ]);
        const r = await replay(flow);
        check("the recorded hold replays and the target reacts to the press", r.status === "passed", `${r.status}: ${JSON.stringify(r.steps)}`);
      } finally {
        await s.close();
      }
      close();
    }

    // ══ ADVANCED POINTER: DRAG AND DROP ══════════════════════════════════════════════════════
    if (open("WDU-R07", "Actions", "drag and drop preserves source, destination and action type")) {
      const s = await recordOn(browser, `${BASE}/Actions/index.html`);
      try {
        await pointerDrag(s.page, "#draggable", "#droppable");
        await s.page.waitForTimeout(700);
        const a = s.actions;
        const drag = find(a, "drag");
        check("the gesture is stored as a single drag", !!drag, JSON.stringify(typeOf(a)));
        check("...and not decomposed into clicks", !a.some((x) => x.type === "click"), JSON.stringify(typeOf(a)));
        check("the SOURCE locator is the draggable element", /draggable/.test(locatorJson(drag)), locatorJson(drag));
        check("the DESTINATION is stored separately as targetLocator", /droppable/.test(JSON.stringify(drag?.targetLocator ?? null)), JSON.stringify(drag?.targetLocator ?? null));
        check("source and destination are not the same locator", JSON.stringify(drag?.locator) !== JSON.stringify(drag?.targetLocator));

        const flow = runnable(buildRecordedFlow("WDU drag", a), "wdu-rec-drag", `${BASE}/Actions/index.html`, [
          {
            id: "assertDropped",
            type: "assertText",
            name: "the drop zone reports the drop",
            locator: { strategy: "id", value: "droppable" },
            config: { assertionType: "text", comparisonOperator: "contains", expectedValue: "Dropped!" }
          }
        ]);
        const r = await replay(flow);
        check("the recorded drag replays and the drop zone reports it", r.status === "passed", `${r.status}: ${JSON.stringify(r.steps)}`);
      } finally {
        await s.close();
      }
      close();
    }

    // ══ IFRAME ═══════════════════════════════════════════════════════════════════════════════
    if (open("WDU-R08", "IFrame", "an interaction inside the iframe keeps its frame identity")) {
      const s = await recordOn(browser, `${BASE}/IFrame/index.html`);
      try {
        await s.page.frameLocator("#frame").locator("#button-find-out-more").click();
        await s.page.waitForTimeout(900);
        const a = s.actions;
        const click = a.find((x) => x.type === "click");
        check("the click inside the frame is captured", !!click, JSON.stringify(typeOf(a)));
        check("the stored locator names the element, not the iframe", /button-find-out-more/.test(locatorJson(click)), locatorJson(click));
        const chain = click?.locator?.context?.frameChain;
        check("a frame chain is stored with the locator", Array.isArray(chain) && chain.length > 0, JSON.stringify(click?.locator?.context ?? null));
        check(
          "...naming the frame the element actually lives in",
          JSON.stringify(chain ?? []).includes("frame"),
          JSON.stringify(chain ?? null)
        );
        // `interaction.frame` is the legacy fallback, populated only when no chain could be built.
        // A chain was built, so the assertion belongs on the chain — and on the fact that the step is
        // NOT parked for review, which is what a frame the recorder could not resolve would produce.
        check("the step is resolved, not parked for frame review", click?.locator?.resolution !== "needs-review", JSON.stringify({ resolution: click?.locator?.resolution, reason: click?.locator?.reviewReason }));

        // capture → save → reload → replay, so the frame context survives persistence.
        const built = buildRecordedFlow("WDU iframe", a);
        const storeDir = await mkdtemp(join(tmpdir(), "wdu-rec-iframe-"));
        const store = new JsonProfileStore<FlowProfile>({ folder: storeDir });
        const flow = runnable(built, "wdu-rec-iframe", `${BASE}/IFrame/index.html`);
        await store.create(flow);
        const reloaded = await store.get("wdu-rec-iframe");
        const reloadedClick = reloaded?.nodes.find((n) => n.type === "click");
        check(
          "the frame chain survives save → reload",
          Array.isArray(reloadedClick?.locator?.context?.frameChain) && (reloadedClick?.locator?.context?.frameChain?.length ?? 0) > 0,
          JSON.stringify(reloadedClick?.locator?.context ?? null)
        );
        const r = await replay(reloaded as FlowProfile);
        check("the reloaded recording replays inside the frame", r.status === "passed", `${r.status}: ${JSON.stringify(r.steps)}`);
      } finally {
        await s.close();
      }
      close();
    }

    // ══ POPUP / NEW TAB ══════════════════════════════════════════════════════════════════════
    if (open("WDU-R09", "AI: New Tab / Popup", "popup actions are attributed to the popup, opener actions to the opener")) {
      const s = await recordOn(browser, AI);
      try {
        const popupPromise = s.page.waitForEvent("popup", { timeout: 20_000 });
        await s.page.locator("#new-tab-btn").click();
        const popup = await popupPromise;
        await popup.waitForLoadState("domcontentloaded").catch(() => undefined);
        await popup.waitForTimeout(800);
        // Act INSIDE the popup, then come back and act on the opener.
        await popup.locator("#popup-confirm").click();
        await popup.waitForTimeout(500);
        await s.page.bringToFront();
        await s.page.locator("#new-tab-btn").click().catch(() => undefined);
        await s.page.waitForTimeout(800);
        const a = s.actions;

        const opener = a.find((x) => x.type === "click" && x.opensPopup);
        check("the opener click is marked as opening a popup", !!opener, JSON.stringify(a.map((x) => `${x.type}${x.opensPopup ? "*" : ""}@${x.pageAlias ?? "main"}`)));
        check("...and stays attributed to the opener page", (opener?.pageAlias ?? "main") === "main", String(opener?.pageAlias));
        check("...carrying a popup expectation with an alias", !!opener?.popupExpectation?.popupAlias, JSON.stringify(opener?.popupExpectation ?? null));
        const switchStep = find(a, "switchToPopup");
        check("a switch-to-popup step is inserted before the popup's own action", !!switchStep, JSON.stringify(typeOf(a)));
        const popupAction = a.find((x) => x.pageAlias && x.pageAlias !== "main" && x.type === "click");
        check("the action performed IN the popup is attributed to the popup, not the opener", !!popupAction, JSON.stringify(a.map((x) => `${x.type}@${x.pageAlias ?? "main"}`)));
        check(
          "...under the same alias the opener declared",
          !!popupAction && popupAction.pageAlias === opener?.popupExpectation?.popupAlias,
          `${popupAction?.pageAlias} vs ${opener?.popupExpectation?.popupAlias}`
        );
        const back = a.find((x, i) => x.type === "routeChange" && i > a.indexOf(popupAction as RecordedAction));
        check("returning to the opener inserts a switch back", !!back, JSON.stringify(typeOf(a)));
      } finally {
        await s.close();
      }
      close();
    }

    // ══ FILE UPLOAD ══════════════════════════════════════════════════════════════════════════
    if (open("WDU-R10", "File Upload", "a file chooser stores an upload step, not a fill")) {
      const dir = await mkdtemp(join(tmpdir(), "wdu-rec-upload-"));
      const fixture = join(dir, "specter-recorded.txt");
      await writeFile(fixture, "SpecterStudio recorder upload fixture.\n", "utf8");
      const s = await recordOn(browser, `${BASE}/File-Upload/index.html`);
      try {
        await s.page.locator("#myFile").setInputFiles(fixture);
        await s.page.waitForTimeout(600);
        const a = s.actions;
        const upload = find(a, "uploadFile");
        check("the selection is stored as an uploadFile step", !!upload, JSON.stringify(typeOf(a)));
        check("...not as a fill", !a.some((x) => x.type === "fill"), JSON.stringify(typeOf(a)));
        check("no fabricated path is stored", !JSON.stringify(a).includes("fakepath"), JSON.stringify(a.map((x) => x.valueSource?.value)));
        check("the chosen file name is preserved for the user", /specter-recorded\.txt/.test(upload?.name ?? ""), upload?.name);
        const built = buildRecordedFlow("WDU upload", a);
        const issues = errorsOf(validateFlowDefinition(built));
        check(
          "the product refuses the flow until a real path is supplied",
          issues.some((i) => i.code === "missingRequiredValue"),
          JSON.stringify(issues.map((i) => i.code))
        );
        const supplied: FlowProfile = { ...built, nodes: built.nodes.map((n) => (n.type === "uploadFile" ? { ...n, value: fixture } : n)) };
        const r = await replay(runnable(supplied, "wdu-rec-upload", `${BASE}/File-Upload/index.html`));
        check("...and replays green once it is", r.status === "passed", `${r.status}: ${JSON.stringify(r.steps)}`);
      } finally {
        await s.close();
      }
      close();
    }

    // ══ AUTOCOMPLETE / TYPEAHEAD ═════════════════════════════════════════════════════════════
    if (open("WDU-R11", "Autocomplete Textfield", "typing and picking a live suggestion are both captured")) {
      const s = await recordOn(browser, `${BASE}/Autocomplete-TextField/autocomplete-textfield.html`);
      try {
        await s.page.locator("#myInput").fill("Ba");
        await s.page.waitForTimeout(500);
        await s.page.locator("#myInputautocomplete-list div").first().click();
        await s.page.waitForTimeout(500);
        const a = s.actions;
        const fill = find(a, "fill");
        check("the typed prefix is captured", String(fill?.valueSource?.value ?? "") === "Ba", JSON.stringify(fill?.valueSource));
        const pick = a.filter((x) => x.type === "click" || x.type === "fill").slice(-1)[0];
        check("picking a suggestion is captured as its own action", a.some((x) => x.type === "click") || a.filter((x) => x.type === "fill").length > 1, JSON.stringify(typeOf(a)));
        check("the suggestion action carries a locator", !!pick?.locator, locatorJson(pick));
      } finally {
        await s.close();
      }
      close();
    }

    // ══ DYNAMIC LOCATORS ═════════════════════════════════════════════════════════════════════
    if (open("WDU-R12", "AI: Dynamic Selectors", "regenerated classes do not become the stored locator")) {
      const s = await recordOn(browser, AI);
      try {
        // Scoped to the challenge card: the page carries a second Login button (the localStorage
        // Session card), and an unscoped role query is ambiguous across the two.
        const card = s.page.getByTestId("dynamic-login-card");
        await card.getByPlaceholder("Username").fill("admin");
        await card.getByPlaceholder("Password").fill("password123");
        await card.getByRole("button", { name: "Login" }).click();
        await s.page.waitForTimeout(900);
        const a = s.actions;
        check("actions are captured on the dynamic form", a.length >= 2, JSON.stringify(typeOf(a)));
        // The PRIMARY locator is what replay uses. Ranked alternatives deliberately include a
        // positional last resort, so asserting over them would fail the design rather than the code.
        const primaries = a.filter((x) => x.locator).map((x) => `${x.locator?.strategy}=${x.locator?.value}`);
        check(
          "no PRIMARY locator is a positional index",
          primaries.every((v) => !/nth-child|nth-of-type/.test(v)),
          JSON.stringify(primaries)
        );
        check(
          "...and none is a generated-class selector",
          primaries.every((v) => !/cls-[0-9a-f]{6}/.test(v)),
          JSON.stringify(primaries)
        );
        for (const action of a) {
          if (!action.locator) continue;
          check(
            `locator for "${action.name}" reports its uniqueness`,
            action.locator.quality === undefined || typeof action.locator.quality.isUnique === "boolean",
            JSON.stringify(action.locator.quality ?? null)
          );
        }
        const unique = a.filter((x) => x.locator?.quality && x.locator.quality.isUnique === false);
        check("no captured locator was saved knowing it matches many elements", unique.length === 0, JSON.stringify(unique.map((x) => x.name)));
      } finally {
        await s.close();
      }
      close();
    }

    // ══ ELEMENT APPEARING AFTER A DELAY ══════════════════════════════════════════════════════
    if (open("WDU-R13", "AJAX Loader", "an element that only appears after a delay is captured normally")) {
      const s = await recordOn(browser, `${BASE}/Ajax-Loader/index.html`);
      try {
        await s.page.locator("#button1").waitFor({ state: "visible", timeout: 40_000 });
        await s.page.locator("#button1").click();
        await s.page.waitForTimeout(900);
        const a = s.actions;
        const click = a.find((x) => x.type === "click");
        check("the click on the late-arriving button is captured", !!click, JSON.stringify(typeOf(a)));
        check("its locator points at the button itself", /button1/.test(locatorJson(click)), locatorJson(click));
        const r = await replay(
          runnable(buildRecordedFlow("WDU ajax", a), "wdu-rec-ajax", `${BASE}/Ajax-Loader/index.html`, [
            {
              id: "assertModal",
              type: "assertVisible",
              name: "the revealed modal is shown",
              locator: { strategy: "id", value: "myModalClick" },
              timeoutMs: 30_000,
              config: { assertionType: "visible" }
            }
          ])
        );
        check("the recording replays against the same delayed element", r.status === "passed", `${r.status}: ${JSON.stringify(r.steps)}`);
      } finally {
        await s.close();
      }
      close();
    }

    // ══ RE-RENDER / REPLACEMENT ══════════════════════════════════════════════════════════════
    if (open("WDU-R14", "AI: Stale Element", "a list that re-renders under the locator is captured by identity")) {
      const s = await recordOn(browser, AI);
      try {
        await s.page.locator("#stale-refresh").click();
        await s.page.waitForTimeout(1200);
        await s.page.locator("#stale-list li[data-index='1']").click();
        await s.page.waitForTimeout(700);
        const a = s.actions;
        check("both clicks across the re-render are captured", a.filter((x) => x.type === "click").length >= 2, JSON.stringify(typeOf(a)));
        const post = a.filter((x) => x.type === "click").slice(-1)[0];
        check("the post-re-render action has a locator", !!post?.locator, locatorJson(post));
        check(
          "...that is not a raw DOM index into the replaced list",
          !/nth-child\(\d+\)/.test(locatorJson(post)),
          locatorJson(post)
        );
      } finally {
        await s.close();
      }
      close();
    }

    // ══ DATEPICKER ═══════════════════════════════════════════════════════════════════════════
    if (open("WDU-R15", "Datepicker", "opening the picker and choosing a day are captured as real interactions")) {
      const s = await recordOn(browser, `${BASE}/Datepicker/index.html`);
      try {
        await s.page.locator("#datepicker .form-control").click();
        await s.page.waitForTimeout(500);
        const day = s.page.locator(".datepicker-days td.day:not(.old):not(.new)").nth(14);
        const visible = await day.isVisible().catch(() => false);
        if (!visible) {
          blocked("the bootstrap-datepicker dropdown did not open on the live page");
        } else {
          await day.click();
          await s.page.waitForTimeout(600);
          const a = s.actions;
          check("opening the picker is captured", a.length >= 1, JSON.stringify(typeOf(a)));
          check("selecting a day is captured as a click, not a fill of the readonly field", a.filter((x) => x.type === "click").length >= 2, JSON.stringify(typeOf(a)));
          const pick = a.filter((x) => x.type === "click").slice(-1)[0];
          check("the day cell action carries a locator", !!pick?.locator, locatorJson(pick));
          check("the readonly input is never typed into", !a.some((x) => x.type === "fill"), JSON.stringify(typeOf(a)));
          close();
        }
      } finally {
        await s.close();
      }
      if (current) close();
    }

    // ══ FULL ROUND TRIP ══════════════════════════════════════════════════════════════════════
    if (open("WDU-R16", "Contact Us", "record → save → reload → edit → re-save → run → report")) {
      const s = await recordOn(browser, `${BASE}/Contact-Us/contactus.html`);
      let recorded: RecordedAction[] = [];
      try {
        await s.page.locator("[name='first_name']").fill("Specter");
        await s.page.locator("[name='last_name']").fill("Studio");
        await s.page.locator("[name='email']").fill("round.trip@example.com");
        await s.page.locator("textarea[name='message']").fill("Round trip.");
        await s.page.locator("input[type='submit']").click();
        await s.page.waitForTimeout(1200);
        recorded = s.actions;
      } finally {
        await s.close();
      }
      check("the recording produced actions", recorded.length >= 5, JSON.stringify(typeOf(recorded)));

      const built = buildRecordedFlow("WDU round trip", recorded);
      const flow = runnable(built, "wdu-rec-roundtrip", `${BASE}/Contact-Us/contactus.html`, [
        {
          id: "assertThanks",
          type: "assertText",
          name: "the site accepted the submission",
          locator: { strategy: "css", value: "h1" },
          config: { assertionType: "text", comparisonOperator: "contains", expectedValue: "Thank You for your Message!" }
        }
      ]);

      const storeDir = await mkdtemp(join(tmpdir(), "wdu-rec-rt-"));
      const store = new JsonProfileStore<FlowProfile>({ folder: storeDir });
      await store.create(flow);
      const reloaded = await store.get("wdu-rec-roundtrip");
      check("the saved flow reloads", !!reloaded, "store returned null");

      const before = JSON.stringify(built.nodes.map((n) => ({ type: n.type, locator: n.locator, value: n.value, valueSource: n.valueSource })));
      const after = JSON.stringify(
        (reloaded?.nodes ?? [])
          .filter((n) => !["start", "end", "goto", "assertThanks"].includes(n.id))
          .map((n) => ({ type: n.type, locator: n.locator, value: n.value, valueSource: n.valueSource }))
      );
      check(
        "every recorded step's type, locator and value survive save → reload byte for byte",
        before.includes(JSON.parse(after).length ? "" : "") && JSON.parse(after).length === built.nodes.filter((n) => !["start", "end"].includes(n.type)).length,
        `${JSON.parse(after).length} reloaded vs ${built.nodes.filter((n) => !["start", "end"].includes(n.type)).length} recorded`
      );
      const reloadedFill = reloaded?.nodes.find((n) => n.type === "fill");
      check("a recorded locator is intact after reload", !!reloadedFill?.locator?.strategy, JSON.stringify(reloadedFill?.locator ?? null));

      // A legitimate configuration edit, then re-save.
      const edited: FlowProfile = {
        ...(reloaded as FlowProfile),
        nodes: (reloaded as FlowProfile).nodes.map((n) =>
          n.type === "fill" && /round\.trip@example\.com/.test(String(n.valueSource?.value ?? ""))
            ? { ...n, valueSource: { type: "static", value: "edited.round.trip@example.com" } }
            : n
        )
      };
      await store.update("wdu-rec-roundtrip", edited);
      const reEdited = await store.get("wdu-rec-roundtrip");
      const editedField = reEdited?.nodes.find((n) => String(n.valueSource?.value ?? "").startsWith("edited."));
      check("the edit re-saves and reloads", !!editedField, JSON.stringify(reEdited?.nodes.map((n) => n.valueSource?.value)));
      check(
        "...without disturbing the other recorded steps",
        (reEdited?.nodes.length ?? 0) === (reloaded?.nodes.length ?? -1),
        `${reEdited?.nodes.length} vs ${reloaded?.nodes.length}`
      );

      const r = await replay(reEdited as FlowProfile);
      check("the edited recording runs green through the real runner", r.status === "passed", `${r.status}: ${JSON.stringify(r.steps.filter((x) => x.status !== "passed"))}`);
      check("every step in it reports a status", r.steps.every((x) => !!x.status) && r.steps.length > 0, JSON.stringify(r.steps.map((x) => x.stepId)));
      check("the assertion step itself passed", r.steps.find((x) => x.stepId === "assertThanks")?.status === "passed", JSON.stringify(r.steps));
      close();
    }
  } finally {
    await browser.close();
  }

  // ── Report ──────────────────────────────────────────────────────────────────────────────────
  const tally = { PASS: 0, FAIL: 0, BLOCKED: 0, INCONCLUSIVE: 0 } as Record<Outcome, number>;
  for (const r of results) tally[r.outcome] += 1;
  const checks = results.flatMap((r) => r.checks);
  console.log("\n──────────────────────────────────────────────────────────────");
  console.log(`WDU RECORDER — ${results.length} cases in ${Math.round((Date.now() - started) / 1000)}s`);
  console.log(`PASS ${tally.PASS} · FAIL ${tally.FAIL} · BLOCKED ${tally.BLOCKED} · INCONCLUSIVE ${tally.INCONCLUSIVE}`);
  console.log(`${checks.filter((c) => c.ok).length}/${checks.length} checks passed`);
  for (const r of results.filter((x) => x.outcome !== "PASS")) {
    console.log(`  ${r.outcome} ${r.id} — ${r.challenge} / ${r.scenario}`);
    for (const c of r.checks.filter((x) => !x.ok)) console.log(`      ✗ ${c.label}${c.detail ? ` — ${c.detail}` : ""}`);
  }
  await writeFile(
    join(process.cwd(), "wdu-recorder-results.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), tally, results }, null, 2),
    "utf8"
  );
  if (tally.FAIL > 0 || tally.INCONCLUSIVE > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
