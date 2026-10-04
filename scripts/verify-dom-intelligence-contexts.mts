/**
 * L11.F dynamic browser contexts (awkit-djnl.19): locator recovery and DOM-intelligence repair
 * suggestions stay bound to the step's own frame, page and route, and never replace a virtualized,
 * delayed or changed target with a look-alike.
 *
 * Run with: npm run verify:dom-intelligence-contexts
 *
 * Drives the production LocatorFactory in real Chromium against the Feature Test Lab's /dom-context-lab
 * (mock-site/public/dom-context-lab*.html). Every case seeds winner memory with a real first resolve, then
 * changes the page so every recorded candidate misses:
 *   A. frame:       the target leaves its iframe while an identical control stays in the top document;
 *   B. SPA route:   pushState to another view whose control is structurally identical;
 *   C. popup:       the parent's target is removed while the popup shows the same control, and back;
 *   D. virtualized: the recorded row is recycled out of the window, with and without per-row ids, then
 *                   brought back by the scroll step's own semantics (element scroll, wheel at centre);
 *   E. delayed:     the target is replaced by a disabled skeleton until it renders;
 *   S. stale:       the page changes between the snapshot and the proof;
 *   R. race:        the page changes between the proof and the action (both engines).
 * Controls prove each case can pass: a same-context drift still recovers, the right element acts.
 *
 * A recording fake provider stands in for the parser-only host (its own gate is verify:dom-intelligence-host),
 * so the HTML each suggestion stage sees is checked directly. Mutation evidence: each boundary below was
 * removed in the source and this verifier failed (docs/plans/ai-upgrade-v5/evidence/L11-acceptance-2026-10-01.md).
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Frame, type Locator, type Page } from "playwright";
import type { FlowStep, StepLocator } from "@src/profiles/FlowProfile";
import { LocatorFactory, type LocatorRecoveryEvent, type LocatorRecoveryTrace } from "@src/runner/LocatorFactory";
import { FileLocatorRecoveryStore, stepCandidatesDigest } from "@src/runner/LocatorRecoveryStore";
import { MemoryDomReferenceStore } from "@src/runner/domIntelligence/domReference";
import { NoopDomIntelligenceProvider, type DomIntelligenceProvider, type DomRecoveryRequest, type DomRecoveryResult } from "@src/runner/domIntelligence/DomIntelligenceProvider";
import { RECOVERY_MIN_ANCESTRY, RECOVERY_SCORE_THRESHOLD, captureLocalSnapshot, rankLocalRecovery, recheckSnapshotWinner } from "@src/runner/recoverySnapshot";
import { ancestrySimilarity, createPageFingerprint, hashFingerprint, similarity } from "@src/runner/locatorFingerprint";
import type { LocatorElementFingerprint } from "@src/profiles/FlowProfile";
import { compareRoutes, routeKey } from "@src/runner/routeIdentity";
import { toRecoveryProvenance } from "@src/runner/domIntelligence/recoveryProvenance";
import { referenceStructurePresent } from "@src/runner/domIntelligence/repairSuggestion";

const PORT = 4437;
const BASE = `http://127.0.0.1:${PORT}`;
const LAB = `${BASE}/dom-context-lab`;

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Records every HTML snapshot a suggestion stage hands it, and proposes nothing. */
class RecordingProvider implements DomIntelligenceProvider {
  readonly requests: DomRecoveryRequest[] = [];
  private readonly off = new NoopDomIntelligenceProvider("DISABLED", "recording fake");
  async getStatus() {
    return { available: true, provider: "scrapling" as const, mode: "parser-only" as const, browserAccess: false as const, networkAccess: false as const };
  }
  async findRecoveryCandidates(request: DomRecoveryRequest): Promise<DomRecoveryResult> {
    this.requests.push(request);
    return { ok: true, candidates: [], elements: 0, parseMs: 0, matchMs: 0 };
  }
  saveReference = () => this.off.saveReference();
  normalizeForAi = () => this.off.normalizeForAi();
  shutdown = () => this.off.shutdown();
}

let stepCounter = 0;
function step(locator: StepLocator, extra: Partial<FlowStep> = {}): FlowStep {
  stepCounter += 1;
  return { id: `dcl-step-${stepCounter}`, name: `DOM context step ${stepCounter}`, type: "click", locator: { blueprintId: `dcl-ref-${stepCounter}`, ...locator }, ...extra } as FlowStep;
}

interface Harness {
  store: FileLocatorRecoveryStore;
  scopeKey: (stepId: string) => string;
  factory: (page: Page) => LocatorFactory;
  events: LocatorRecoveryEvent[];
  traces: () => LocatorRecoveryTrace[];
  provider: RecordingProvider;
  references: MemoryDomReferenceStore;
}

function harness(root: string, name: string, recoveryEngine?: "snapshot" | "legacy"): Harness {
  const events: LocatorRecoveryEvent[] = [];
  const provider = new RecordingProvider();
  const references = new MemoryDomReferenceStore();
  const store = new FileLocatorRecoveryStore(join(root, name));
  return {
    store,
    scopeKey: (stepId) => `dcl-${name}\u0000dcl\u0000${stepId}`,
    events,
    provider,
    references,
    traces: () => events.flatMap((event) => (event.trace ? [event.trace] : [])),
    factory: (page) =>
      new LocatorFactory(page, {
        recoveryStore: store,
        scope: { scenarioId: `dcl-${name}`, flowId: "dcl" },
        recoveryGraceMs: 0,
        recoveryEngine,
        domIntelligence: { provider, references, budgetMs: 2_000 },
        onRecoveryEvent: (event) => events.push(event)
      })
  };
}

type Outcome = "correct" | "WRONG" | "unresolved" | "ambiguous" | "error";

/** Resolve, then judge the returned locator against the truth element (never acting on it). */
async function judge(locator: Promise<Locator>, truth: (element: Element) => boolean): Promise<{ outcome: Outcome; detail?: string }> {
  let resolved: Locator;
  try {
    resolved = await locator;
  } catch (error) {
    const detail = (error instanceof Error ? error.message : String(error)).split("\n")[0];
    return { outcome: /matched multiple|matches \d+ elements|ambiguous/i.test(detail) ? "ambiguous" : "error", detail };
  }
  const count = await resolved.count().catch(() => 0);
  if (count !== 1) return { outcome: count === 0 ? "unresolved" : "ambiguous" };
  return { outcome: (await resolved.evaluate(truth).catch(() => false)) ? "correct" : "WRONG" };
}

const recovered = (h: Harness, stepId: string) => h.events.some((event) => event.type === "local-recovery" && event.stepId === stepId);

const printOf = async (locator: Locator) => hashFingerprint(await locator.evaluate(createPageFingerprint));

/**
 * A refusal only means something against a look-alike AWKIT's own gate would accept: it scores at least
 * 0.86 against the recorded identity and keeps at least half of its ancestry. Without this, "the decoy was
 * not recovered" could pass because the decoy was never similar enough (it happened: wrappers with test
 * ids put the first fixture version in the ancestry veto).
 */
function convincing(label: string, expected: LocatorElementFingerprint, decoy: LocatorElementFingerprint): void {
  const score = similarity(expected, decoy);
  const ancestry = ancestrySimilarity(expected.ancestry, decoy.ancestry);
  check(`precondition: ${label} would pass AWKIT's gate if its binding were ignored`, score >= RECOVERY_SCORE_THRESHOLD && ancestry >= RECOVERY_MIN_ANCESTRY, `score ${score.toFixed(3)}, ancestry ${ancestry.toFixed(2)}`);
}
const lastTrace = (h: Harness) => h.traces().at(-1);
const stageReason = (h: Harness) => lastTrace(h)?.stages.find((stage) => stage.stage === "provider")?.reason;

async function frameOf(page: Page): Promise<Frame> {
  const handle = await page.locator('[data-testid="dcl-frame"]').elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error("the lab frame did not attach");
  await frame.waitForSelector("text=Save settings");
  return frame;
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "awkit-dcl-"));
  const server = spawn(process.execPath, ["mock-site/server.mjs"], { env: { ...process.env, MOCK_SITE_PORT: String(PORT) }, stdio: ["ignore", "ignore", "inherit"], windowsHide: true });
  let browser: Browser | undefined;
  try {
    for (let attempt = 0; attempt < 80 && !(await fetch(LAB).then((r) => r.ok, () => false)); attempt += 1) await new Promise((r) => setTimeout(r, 100));
    browser = await chromium.launch();
    const fresh = async (path = "/dom-context-lab"): Promise<{ page: Page; close: () => Promise<void> }> => {
      const context = await browser!.newContext();
      const page = await context.newPage();
      await page.goto(`${BASE}${path}`);
      return { page, close: () => context.close() };
    };

    // ── A. Frames ────────────────────────────────────────────────────────────────────────────────
    console.log("A. Frames: candidates come only from the step's own frame");
    {
      const frameStep = step({ strategy: "testId", value: "dcl-frame-save", context: { frameChain: [{ selector: '[data-testid="dcl-frame"]' }] } });
      const isFrameButton = (el: Element) => el.ownerDocument.defaultView !== el.ownerDocument.defaultView?.top && el.textContent === "Save settings";

      const control = harness(root, "frame-control");
      const a = await fresh();
      await frameOf(a.page);
      const seeded = await judge(control.factory(a.page).resolve(frameStep), isFrameButton);
      check("control: the recorded frame step resolves inside the frame", seeded.outcome === "correct", seeded.outcome);
      check("the seed refreshed a DOM reference bound to the frame document's route", (await control.references.get(frameStep.locator!.blueprintId!, stepCandidatesDigest(frameStep.locator!)))?.route === routeKey(`${BASE}/dom-context-lab/frame`));
      // Winner memory binds the same document, so a frame that navigates under an unchanged top page is
      // another route for the step (independent review, 2026-10-01).
      check("the seed's winner memory is bound to the frame document's route, not the top page's", (await control.store.get(control.scopeKey(frameStep.id)))?.route === routeKey(`${BASE}/dom-context-lab/frame`), (await control.store.get(control.scopeKey(frameStep.id)))?.route);
      await (await frameOf(a.page)).evaluate(() => (window as unknown as { __dclFrame: { dropTestId: () => void } }).__dclFrame.dropTestId());
      const drift = await judge(control.factory(a.page).resolve(frameStep), isFrameButton);
      check("control: a drifted target inside the frame is still recovered there", drift.outcome === "correct" && recovered(control, frameStep.id), drift.outcome);
      check("the trace names a child frame at depth 1 on page main", lastTrace(control)?.context.frame === "child" && lastTrace(control)?.context.frameDepth === 1 && lastTrace(control)?.context.page === "main");
      await a.close();

      // A new step (and blueprint id): reference seeding is memoized per process by id and binding.
      const goneStep = step({ strategy: "testId", value: "dcl-frame-save", context: { frameChain: [{ selector: '[data-testid="dcl-frame"]' }] } });
      const h = harness(root, "frame");
      const b = await fresh();
      await frameOf(b.page);
      await h.factory(b.page).resolve(goneStep);
      const framePrint = await printOf((await frameOf(b.page)).getByTestId("dcl-frame-save"));
      convincing("the top-document 'Save settings' decoy", framePrint, await printOf(b.page.locator(".dcl-frame-decoy button")));
      await (await frameOf(b.page)).evaluate(() => (window as unknown as { __dclFrame: { removeTarget: () => void } }).__dclFrame.removeTarget());
      const decoyPresent = await b.page.locator(".dcl-frame-decoy button").count();
      check("the top document still holds an identical 'Save settings' control", decoyPresent === 1);
      const gone = await judge(h.factory(b.page).resolve(goneStep), () => false);
      check("target gone from the frame: unresolved, the top-document decoy is never used", gone.outcome === "unresolved" && !recovered(h, goneStep.id), gone.outcome);
      // L12.11: with the target gone, the frame no longer holds the structure the reference was recorded in, so
      // the suggestion stage stops before any HTML leaves the page. That decision must be the FRAME's: the top
      // document holds the same structure, so a check made there would have let the stage run.
      const frameReference = await h.references.get(goneStep.locator!.blueprintId!, stepCandidatesDigest(goneStep.locator!));
      check("the suggestion stage stopped as a different page, before any HTML left the frame", stageReason(h) === "page-variant" && h.provider.requests.length === 0, `${stageReason(h)}, ${h.provider.requests.length} request(s)`);
      check(
        "...decided on the frame's own document (the top document still holds that structure)",
        Boolean(frameReference) &&
          (await referenceStructurePresent(b.page.mainFrame(), frameReference!.element.path)) &&
          !(await referenceStructurePresent((await (await b.page.locator('[data-testid="dcl-frame"]').elementHandle())!.contentFrame())!, frameReference!.element.path)),
        frameReference?.element.path.join(">")
      );
      await b.close();
    }

    // ── B. SPA routes ────────────────────────────────────────────────────────────────────────────
    console.log("B. SPA routes: a remembered identity never recovers on another route");
    {
      const bound = routeKey(`${BASE}/dom-context-lab/route/orders`);
      check("a bound step on a route-less document (blank or error page) is on another route", compareRoutes(bound, routeKey("about:blank")) === "mismatch" && compareRoutes(bound, routeKey("chrome-error://chromewebdata/")) === "mismatch");
      check("only a binding that was never recorded is unbound", compareRoutes(undefined, bound) === "unbound" && compareRoutes(undefined, undefined) === "unbound" && compareRoutes(bound, bound) === "match");
    }
    {
      const routeStep = step({ strategy: "testId", value: "dcl-route-export" });
      const isOrdersExport = (el: Element) => location.pathname.endsWith("/orders") && el.textContent === "Export list";

      const control = harness(root, "route-control");
      const a = await fresh("/dom-context-lab/route/orders");
      await control.factory(a.page).resolve(routeStep);
      await a.page.evaluate(() => (window as unknown as { __dcl: { dropRouteTestId: () => void } }).__dcl.dropRouteTestId());
      const drift = await judge(control.factory(a.page).resolve(routeStep), isOrdersExport);
      check("control: a drifted control on the SAME route is recovered", drift.outcome === "correct" && recovered(control, routeStep.id), drift.outcome);
      check("its trace records the route as matching", lastTrace(control)?.context.route === "match");
      await a.close();

      const movedStep = step({ strategy: "testId", value: "dcl-route-export" });
      const h = harness(root, "route");
      const b = await fresh("/dom-context-lab/route/orders");
      await h.factory(b.page).resolve(movedStep);
      check("the seed bound the step's DOM reference to the orders route", (await h.references.get(movedStep.locator!.blueprintId!, stepCandidatesDigest(movedStep.locator!)))?.route === routeKey(`${BASE}/dom-context-lab/route/orders`));
      const ordersPrint = await printOf(b.page.getByTestId("dcl-route-export"));
      await b.page.getByTestId("dcl-go-archive").click();
      check("the page moved to the archive route by pushState (no navigation)", (await b.page.getByTestId("dcl-route-status").textContent()) === "archive");
      convincing("the archive view's 'Export list'", ordersPrint, await printOf(b.page.getByRole("button", { name: "Export list" })));
      const moved = await judge(h.factory(b.page).resolve(movedStep), () => false);
      check("on another route: unresolved, the archive view's identical control is never recovered", moved.outcome === "unresolved" && !recovered(h, movedStep.id), moved.outcome);
      const trace = lastTrace(h);
      check("the trace refuses with route-mismatch before any layer scores", trace?.context.route === "mismatch" && trace.stages.length === 1 && trace.stages[0].reason === "route-mismatch", JSON.stringify(trace?.stages));
      check("no suggestion stage ran on the other route", h.provider.requests.length === 0);
      // The reference alone (no winner-memory route) must already refuse: the reference's own binding.
      const diagnosis = await h.factory(b.page).diagnose(movedStep, { provider: h.provider, references: h.references });
      check("diagnosis reports the reference's route mismatch and skips the provider", diagnosis.route === "mismatch" && diagnosis.provider.reason === "route-mismatch", `${diagnosis.route} ${JSON.stringify(diagnosis.provider)}`);
      const memoryOnly = await h.factory(b.page).diagnose(movedStep, { provider: h.provider, references: new MemoryDomReferenceStore(), expectedRoute: routeKey(`${BASE}/dom-context-lab/route/orders`) });
      check("diagnosis reports the winner memory's route mismatch too", memoryOnly.route === "mismatch" && memoryOnly.provider.reason === "route-mismatch", `${memoryOnly.route} ${JSON.stringify(memoryOnly.provider)}`);
      check("no provider was consulted by either diagnosis", h.provider.requests.length === 0);
      const provenance = trace ? toRecoveryProvenance(trace) : undefined;
      check("report provenance: route-mismatch then fallback, nothing acted on", provenance?.events.map((e) => e.event).join(",") === "primary-failed,route-mismatch,fallback-used" && provenance.actedOn === undefined);
      await b.close();

      // A winner-memory record written before routes were kept has none: the step's routed DOM reference
      // still binds recovery to its route.
      const legacyStep = step({ strategy: "testId", value: "dcl-route-export" });
      const l = harness(root, "route-legacy");
      const c = await fresh("/dom-context-lab/route/orders");
      await l.factory(c.page).resolve(legacyStep);
      const record = await l.store.get(l.scopeKey(legacyStep.id));
      check("the seed wrote a routed winner-memory record", Boolean(record?.route && record.fingerprint), JSON.stringify(record?.route));
      const { route: _dropped, ...legacy } = record!;
      await l.store.put(legacy);
      check("the record is now route-less, as a pre-2026-10-01 record would be", (await l.store.get(l.scopeKey(legacyStep.id)))?.route === undefined);
      await c.page.getByTestId("dcl-go-archive").click();
      const legacyMoved = await judge(l.factory(c.page).resolve(legacyStep), () => false);
      check("route-less memory on another route: still refused through the step's routed reference", legacyMoved.outcome === "unresolved" && !recovered(l, legacyStep.id) && lastTrace(l)?.stages[0]?.reason === "route-mismatch", `${legacyMoved.outcome} ${JSON.stringify(lastTrace(l)?.stages)}`);
      await c.page.getByTestId("dcl-go-orders").click();
      await l.factory(c.page).resolve(legacyStep);
      check("the next successful resolve binds the record to its route again", (await l.store.get(l.scopeKey(legacyStep.id)))?.route === routeKey(`${BASE}/dom-context-lab/route/orders`));
      await c.close();
    }

    // ── C. Popups ────────────────────────────────────────────────────────────────────────────────
    console.log("C. Popups: each page recovers only from itself");
    {
      const parentStep = step({ strategy: "testId", value: "dcl-parent-confirm" });
      const popupStep = step({ strategy: "testId", value: "dcl-popup-confirm" }, { pageAlias: "popup-1" });
      const isConfirm = (el: Element) => el.textContent === "Confirm transfer";

      const h = harness(root, "popup-parent");
      const a = await fresh();
      await h.factory(a.page).resolve(parentStep);
      const [popup] = await Promise.all([a.page.waitForEvent("popup"), a.page.getByTestId("dcl-open-popup").click()]);
      await popup.waitForLoadState();
      convincing("the popup's 'Confirm transfer' (for the parent step)", await printOf(a.page.getByTestId("dcl-parent-confirm")), await printOf(popup.getByTestId("dcl-popup-confirm")));
      await a.page.evaluate(() => (window as unknown as { __dcl: { removeParentTarget: () => void } }).__dcl.removeParentTarget());
      check("the popup shows the same 'Confirm transfer' control", (await popup.getByRole("button", { name: "Confirm transfer" }).count()) === 1);
      // The parent's target is gone: ANY element it resolves to is a wrong one.
      const parent = await judge(h.factory(a.page).resolve(parentStep), () => false);
      check("parent step with its target gone: unresolved, the popup's control never satisfies it", parent.outcome === "unresolved" && !recovered(h, parentStep.id), parent.outcome);
      check("the suggestion stage saw the parent's document only", (h.provider.requests.at(-1)?.html ?? "").includes("dcl-popup-section") && !(h.provider.requests.at(-1)?.html ?? "").includes("dcl-popup-result"));
      await a.close();

      const p = harness(root, "popup-child");
      const b = await fresh();
      const [child] = await Promise.all([b.page.waitForEvent("popup"), b.page.getByTestId("dcl-open-popup").click()]);
      await child.waitForLoadState();
      const seeded = await judge(p.factory(child).resolve(popupStep), isConfirm);
      check("control: the popup step resolves in the popup", seeded.outcome === "correct", seeded.outcome);
      convincing("the parent's 'Confirm transfer' (for the popup step)", await printOf(child.getByTestId("dcl-popup-confirm")), await printOf(b.page.getByTestId("dcl-parent-confirm")));
      await child.evaluate(() => (window as unknown as { __dclPopup: { removeTarget: () => void } }).__dclPopup.removeTarget());
      const onPopup = await judge(p.factory(child).resolve(popupStep), () => false);
      check("popup step with its target gone: unresolved, the parent's control never satisfies it", onPopup.outcome === "unresolved" && !recovered(p, popupStep.id), onPopup.outcome);
      check("the popup trace carries the popup's page alias", lastTrace(p)?.context.page === "popup-1");
      // L12.11: as for the frame, the popup without its target is a different page for the step, decided on the
      // popup itself: the parent still holds that structure.
      const popupReference = await p.references.get(popupStep.locator!.blueprintId!, stepCandidatesDigest(popupStep.locator!));
      check("the popup's suggestion stage stopped as a different page, with no HTML sent", stageReason(p) === "page-variant" && p.provider.requests.length === 0, `${stageReason(p)}, ${p.provider.requests.length} request(s)`);
      check(
        "...decided on the popup's own document (the parent still holds that structure)",
        Boolean(popupReference) && (await referenceStructurePresent(b.page.mainFrame(), popupReference!.element.path)) && !(await referenceStructurePresent(child.mainFrame(), popupReference!.element.path)),
        popupReference?.element.path.join(">")
      );
      await b.close();
    }

    // ── D. Virtualized list ─────────────────────────────────────────────────────────────────────
    console.log("D. Virtualized list: an unmounted or recycled row is never replaced by a look-alike");
    {
      const scrollTo = (page: Page, top: number) => page.evaluate((value) => (window as unknown as { __dcl: { virtual: { scrollTo: (n: number) => void } } }).__dcl.virtual.scrollTo(value), top);
      const setIds = (page: Page, value: boolean) => page.evaluate((flag) => (window as unknown as { __dcl: { virtual: { setIds: (b: boolean) => void } } }).__dcl.virtual.setIds(flag), value);
      const isRow = (id: string) => new Function("el", `return el.closest(".dcl-vrow") && el.closest(".dcl-vrow").dataset.order === ${JSON.stringify(id)};`) as (el: Element) => boolean;

      const rowStep = step({ strategy: "testId", value: "dcl-view-ORD-1003" });
      const h = harness(root, "virtual");
      const a = await fresh();
      await a.page.setViewportSize({ width: 900, height: 320 });
      const seeded = await judge(h.factory(a.page).resolve(rowStep), isRow("ORD-1003"));
      check("control: the recorded row's View resolves while mounted", seeded.outcome === "correct", seeded.outcome);
      await scrollTo(a.page, 6_000);
      const unmounted = await judge(h.factory(a.page).resolve(rowStep), isRow("ORD-1003"));
      check("target not mounted: unresolved (no scrolling, no sleeping, no look-alike row)", unmounted.outcome === "unresolved" && !recovered(h, rowStep.id), unmounted.outcome);
      check("the mounted rows' identical View buttons were refused as a tie, not scored as a match", lastTrace(h)?.stages[0]?.reason === "ambiguous-margin", JSON.stringify(lastTrace(h)?.stages[0]));
      // The runner's scroll step: scrollTarget=element scrolls the container into view, then a page
      // scroll is a mouse wheel at the viewport centre (StepExecutor, case "scroll").
      await (await h.factory(a.page).resolve(step({ strategy: "testId", value: "dcl-virtual-list" }))).scrollIntoViewIfNeeded();
      const viewport = a.page.viewportSize()!;
      await a.page.mouse.move(Math.round(viewport.width / 2), Math.round(viewport.height / 2));
      await a.page.mouse.wheel(0, -8_000);
      await a.page.waitForFunction(() => document.querySelector('[data-testid="dcl-view-ORD-1003"]') !== null);
      const back = await judge(h.factory(a.page).resolve(rowStep), isRow("ORD-1003"));
      check("mounted after an authorized scroll step: the recorded locator itself resolves the right row", back.outcome === "correct", back.outcome);

      // Recycled duplicates: rows without ids, identical View buttons in every mounted row.
      const dupStep = step({ strategy: "css", value: '[data-order="ORD-1004"] button' });
      await scrollTo(a.page, 0);
      await setIds(a.page, false);
      const dupSeed = await judge(h.factory(a.page).resolve(dupStep), isRow("ORD-1004"));
      check("control: the duplicate-row step resolves its own row while mounted", dupSeed.outcome === "correct", dupSeed.outcome);
      const dupPrint = await printOf(a.page.locator('[data-order="ORD-1004"] button'));
      await scrollTo(a.page, 6_000);
      convincing("a recycled row's View (for the unmounted row)", dupPrint, await printOf(a.page.locator(".dcl-vrow:not([hidden]) button").first()));
      const recycled = await judge(h.factory(a.page).resolve(dupStep), isRow("ORD-1004"));
      check("virtualized duplicates: the recycled row nodes are refused, unresolved, never another order's View", recycled.outcome === "unresolved" && !recovered(h, dupStep.id), recycled.outcome);
      await a.close();
    }

    // ── E. Delayed rendering ────────────────────────────────────────────────────────────────────
    console.log("E. Delayed rendering: a disabled skeleton never stands in for the target");
    {
      const delayedStep = step({ strategy: "testId", value: "dcl-delayed-download" });
      const h = harness(root, "delayed");
      const a = await fresh();
      await a.page.getByTestId("dcl-delayed-load").click();
      await a.page.getByTestId("dcl-delayed-download").waitFor();
      await h.factory(a.page).resolve(delayedStep);
      await a.page.getByTestId("dcl-delayed-load").click();
      check("the skeleton is showing (disabled, same name) and the target is not yet rendered", (await a.page.getByTestId("dcl-delayed-status").textContent()) === "loading" && (await a.page.locator(".dcl-skeleton").isDisabled()));
      const during = await judge(h.factory(a.page).resolve(delayedStep), (el) => el.getAttribute("data-testid") === "dcl-delayed-download");
      check("while loading: the skeleton is not recovered (the recorded locator is returned to auto-wait)", during.outcome === "unresolved" && !recovered(h, delayedStep.id), `${during.outcome}; stages ${JSON.stringify(lastTrace(h)?.stages)}`);
      check("it was the actionability rule that refused the look-alike (it does score as the target)", lastTrace(h)?.stages[0]?.reason === "not-actionable" && (lastTrace(h)?.stages[0]?.score ?? 0) >= 0.86, JSON.stringify(lastTrace(h)?.stages[0]));
      const locator = await h.factory(a.page).resolve(delayedStep);
      await locator.click({ timeout: 5_000 });
      check("the action auto-waits and lands on the rendered target", (await a.page.getByTestId("dcl-delayed-status").textContent()) === "downloaded");
      await a.close();
    }

    // ── S. Stale snapshot ───────────────────────────────────────────────────────────────────────
    console.log("S. Stale snapshot: the proof refuses when the page changed after the snapshot");
    {
      const a = await fresh("/dom-context-lab/route/orders");
      const target = a.page.getByTestId("dcl-route-export");
      const expected = hashFingerprint(await target.evaluate(createPageFingerprint));
      await target.evaluate((el) => el.removeAttribute("data-testid"));
      const visible = a.page.locator("*:visible");
      const snapshot = await captureLocalSnapshot(visible, expected);
      const decision = rankLocalRecovery({ type: "click" }, expected, snapshot.candidates);
      check("control: the snapshot proves a winner", decision.winner !== undefined, decision.refusal);
      check("control: re-checked at once, the same winner holds", decision.winner ? await recheckSnapshotWinner(visible, a.page, decision.winner) : false);
      // An identical twin inserted before the winner shifts its index onto the twin.
      await a.page.evaluate(() => {
        const button = document.querySelector('[data-testid="dcl-route-view"] button')!;
        const form = button.parentElement!;
        const twinForm = form.cloneNode(true);
        form.parentElement!.insertBefore(twinForm, form);
      });
      check("after the page changed: the proof refuses (stale snapshot), nothing is recovered", decision.winner ? !(await recheckSnapshotWinner(visible, a.page, decision.winner)) : false);
      await a.close();
    }

    // ── R. Proof to action ──────────────────────────────────────────────────────────────────────
    console.log("R. Proof to action: the step acts on the node that was proven, never on its index");
    for (const engine of ["snapshot", "legacy"] as const) {
      const raceStep = step({ strategy: "testId", value: "dcl-route-export" });
      const h = harness(root, `race-${engine}`, engine);
      const a = await fresh("/dom-context-lab/route/orders");
      await h.factory(a.page).resolve(raceStep);
      await a.page.evaluate(() => {
        const w = window as unknown as { __proven: Element | null; __clicked: EventTarget | null; __dcl: { dropRouteTestId: () => void } };
        w.__proven = document.querySelector('[data-testid="dcl-route-export"]');
        document.addEventListener("click", (event) => (w.__clicked = event.target), true);
        w.__dcl.dropRouteTestId();
      });
      const isProven = (el: Node) => el === (window as unknown as { __proven: Node }).__proven;
      const locator = await h.factory(a.page).resolve(raceStep);
      check(`[${engine}] control: the drifted control is recovered, as the proven node`, recovered(h, raceStep.id) && (await locator.evaluate(isProven).catch(() => false)));
      const visible = a.page.locator("*:visible");
      const index = await visible.evaluateAll((els: Element[]) => els.indexOf((window as unknown as { __proven: Element }).__proven));
      // Between the proof and the action, an identical twin is inserted before the proven node.
      await a.page.evaluate(() => {
        const form = (window as unknown as { __proven: Element }).__proven.parentElement!;
        form.parentElement!.insertBefore(form.cloneNode(true), form);
      });
      const shifted = await visible.nth(index).evaluate((el) => el !== (window as unknown as { __proven: Element }).__proven && el.textContent === "Export list").catch(() => false);
      check(`[${engine}] precondition: the proof's index now names the identical twin`, shifted);
      await locator.click({ timeout: 5_000 });
      check(`[${engine}] the action lands on the proven node, not on the twin at its index`, await a.page.evaluate(() => (window as unknown as { __clicked: unknown; __proven: unknown }).__clicked === (window as unknown as { __proven: unknown }).__proven));
      // The proven node is replaced by an identical clone: the step must not act on the clone.
      await a.page.evaluate(() => {
        const proven = (window as unknown as { __proven: Element }).__proven;
        proven.replaceWith(proven.cloneNode(true));
      });
      check(`[${engine}] the proven node replaced by an identical clone: the locator resolves to nothing (fail closed)`, (await locator.count()) === 0);
      await a.close();
    }
  } finally {
    await browser?.close().catch(() => undefined);
    server.kill();
    await rm(root, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
