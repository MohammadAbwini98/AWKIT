/**
 * verify:dom-intelligence-l12 — L12 Scrapling expansion (awkit-djnl.21) product wiring, in real Chromium
 * through the production LocatorFactory. The parser-only host itself is verify:dom-intelligence-host's;
 * here a recording fake stands in for it, so what each caller sends is checked directly.
 *
 *   A. L12.5 a step recorded before blueprints (no `blueprintId`) gets a DOM reference on its first
 *      passing run, under its flow-scoped step id, and a later failed lookup consults the provider with it;
 *      the diagnosis finds the same reference when told the flow; a blueprint id still wins when present.
 *   B. L12.4 diagnosis asks the provider with the diagnosis budget; a run's suggestion stays inside its own.
 *   C. L12.1 an authorized real run, a recorder session and an Element Spy session prewarm the host.
 *
 * Run: npm run verify:dom-intelligence-l12
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium, type Browser } from "playwright";

import type { FlowStep } from "@src/profiles/FlowProfile";
import { LocatorFactory, type LocatorRecoveryEvent } from "@src/runner/LocatorFactory";
import { FileLocatorRecoveryStore, stepCandidatesDigest } from "@src/runner/LocatorRecoveryStore";
import {
  DOM_INTELLIGENCE_LIMITS,
  NoopDomIntelligenceProvider,
  type DomIntelligenceProvider,
  type DomRecoveryRequest,
  type DomRecoveryResult,
  type DomSimilarRequest,
  type DomSimilarResult
} from "@src/runner/domIntelligence/DomIntelligenceProvider";
import { MemoryDomReferenceStore, domReferenceId } from "@src/runner/domIntelligence/domReference";
import { classifyDrift, similarRowsCsv } from "@src/runner/domIntelligence/DomIntelligenceApi";
import { commonRowSelector, extractSimilarRows } from "@src/runner/domIntelligence/similarRows";
import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";
import { similarRowsLoopAction } from "@src/recorder/RecorderService";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";
import { StepExecutor } from "@src/runner/StepExecutor";
import { ValueResolver } from "@src/runner/ValueResolver";
import { SemanticRedactor } from "@src/semantic/SemanticRedactor";
import { stageHost } from "./dom-intelligence/stagedHost.mts";
import { pageContextEnabled } from "@src/runner/domIntelligence/pageContext";
import { referenceStructurePresent } from "@src/runner/domIntelligence/repairSuggestion";
import { createPageFingerprint, hashFingerprint } from "@src/runner/locatorFingerprint";

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
}

const MOCK_PORT = 4437;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
async function waitForMock(): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    if (await fetch(`${MOCK}/`).then((res) => res.ok).catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Mock site did not start");
}

/** Records every request and proposes nothing. */
class RecordingProvider implements DomIntelligenceProvider {
  readonly requests: DomRecoveryRequest[] = [];
  readonly similarRequests: DomSimilarRequest[] = [];
  private readonly off = new NoopDomIntelligenceProvider("DISABLED", "recording fake");
  async findSimilar(request: DomSimilarRequest): Promise<DomSimilarResult> {
    this.similarRequests.push(request);
    return { ok: true, index: request.index, similar: [request.index + 1], count: 1, parseMs: 0, matchMs: 0 };
  }
  async getStatus() {
    return { available: true, provider: "scrapling" as const, mode: "parser-only" as const, browserAccess: false as const, networkAccess: false as const };
  }
  /** Scores to answer with, as (index into the request's candidateIndices, score); none by default. */
  answer: Array<[number, number]> = [];
  async findRecoveryCandidates(request: DomRecoveryRequest): Promise<DomRecoveryResult> {
    this.requests.push(request);
    const indices = request.candidateIndices ?? [];
    const candidates = this.answer.filter(([at]) => at < indices.length).map(([at, score]) => ({ index: indices[at], score }));
    return { ok: true, candidates, elements: 0, parseMs: 0, matchMs: 0 };
  }
  saveReference = () => this.off.saveReference();
  normalizeForAi = () => this.off.normalizeForAi();
  shutdown = () => this.off.shutdown();
}

const SIGN_IN_ROWS =
  '<!doctype html><html><head><title>L12 lab</title></head><body><main><ul><li class="order">Order #1</li><li class="order">Order #2</li></ul><form><input type="password" name="pw"></form></main></body></html>';

const PAGE = (id: string) =>
  `<!doctype html><html><head><title>L12 lab</title></head><body><main><section class="orders"><form class="order-form"><div class="actions"><button type="button" id="${id}" class="btn">Save changes</button><button type="button" class="btn">Cancel</button></div></form></section></main></body></html>`;

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "awkit-l12-"));
  let html = PAGE("save-order");
  const server: Server = createServer((_request, response) => response.writeHead(200, { "content-type": "text/html" }).end(html));
  const base = await new Promise<string>((done) => server.listen(0, "127.0.0.1", () => done(`http://127.0.0.1:${(server.address() as { port: number }).port}`)));
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(`${base}/orders`);

    const provider = new RecordingProvider();
    const references = new MemoryDomReferenceStore();
    const events: LocatorRecoveryEvent[] = [];
    const store = new FileLocatorRecoveryStore(join(root, "memory"));
    const factory = () =>
      new LocatorFactory(page, {
        recoveryStore: store,
        scope: { scenarioId: "l12", flowId: "flow-a" },
        recoveryGraceMs: 0,
        domIntelligence: { provider, references, budgetMs: 800 },
        onRecoveryEvent: (event) => events.push(event)
      });

    console.log("A. L12.5 references for steps recorded before blueprints");
    const legacy: FlowStep = { id: "old-step", name: "Save changes", type: "click", locator: { strategy: "css", value: "#save-order" } } as FlowStep;
    const referenceId = domReferenceId(legacy, "flow-a");
    check("a step without a blueprint id gets a flow-scoped reference id", referenceId === "step:flow-a:old-step", referenceId);
    check("a step with a blueprint id keeps it", domReferenceId({ id: "x", locator: { blueprintId: "bp-1" } }, "flow-a") === "bp-1");
    check("a step without any id gets none", domReferenceId({ locator: {} }, "flow-a") === undefined);
    check("precondition: no reference before the first run", !(await references.get(referenceId!, stepCandidatesDigest(legacy.locator!))));
    await factory().resolve(legacy);
    const seeded = await references.get(referenceId!, stepCandidatesDigest(legacy.locator!));
    check("the first passing run stored a reference under the flow-scoped id", Boolean(seeded), seeded);
    check("...bound to the step's own candidates and the page's route", seeded?.bindingDigest === stepCandidatesDigest(legacy.locator!) && typeof seeded?.route === "string");
    check("...describing the recorded element", seeded?.element.tag === "button" && seeded.element.attributes.id === "save-order");
    check("a refresh was reported for it", events.some((event) => event.type === "reference-refreshed" && event.stepId === "old-step"));

    html = PAGE("save-order-v2");
    await page.goto(`${base}/orders`);
    provider.requests.length = 0;
    await factory()
      .resolve(legacy)
      .catch(() => undefined);
    const trace = events.findLast((event) => event.trace)?.trace;
    check("after drift the recovery ran for the old step", Boolean(trace), events.map((event) => event.type));
    // The id drift is AWKIT's own recovery (0.95); the provider is consulted only after both layers refuse.
    // So force the provider stage with a recorded identity that no layer accepts.
    const unrecoverable: FlowStep = { ...legacy, id: "old-step-2", locator: { strategy: "css", value: "#nowhere" } } as FlowStep;
    const unrecoverableId = domReferenceId(unrecoverable, "flow-a")!;
    await references.put({ ...seeded!, referenceId: unrecoverableId, bindingDigest: stepCandidatesDigest(unrecoverable.locator!) });
    await store.put({
      version: 1,
      scopeKey: "l12\u0000flow-a\u0000old-step-2",
      candidatesDigest: stepCandidatesDigest(unrecoverable.locator!),
      winningCandidateSignature: "css:#nowhere",
      fingerprint: { ...hashFingerprint(await page.locator("button").first().evaluate(createPageFingerprint)), name: "zz", text: "zz", tag: "a", role: "link" },
      route: seeded?.route,
      source: "recorded-candidate",
      updatedAt: new Date().toISOString()
    });
    provider.requests.length = 0;
    await factory()
      .resolve(unrecoverable)
      .catch(() => undefined);
    check("a failed lookup on a pre-blueprint step consults the provider", provider.requests.length === 1, provider.requests.length);
    check("...with the reference stored under its flow-scoped id", provider.requests[0]?.reference.referenceId === unrecoverableId, provider.requests[0]?.reference.referenceId);

    console.log("B. L12.4 diagnosis budget");
    provider.requests.length = 0;
    await new LocatorFactory(page).diagnose(unrecoverable, { provider, references, expected: undefined, flowId: "flow-a" });
    check("the diagnosis finds the flow-scoped reference when told the flow", provider.requests.length === 1, provider.requests.length);
    check(`...and asks with the ${DOM_INTELLIGENCE_LIMITS.diagnosisTimeoutMs} ms diagnosis budget`, provider.requests[0]?.timeoutMs === DOM_INTELLIGENCE_LIMITS.diagnosisTimeoutMs, provider.requests[0]?.timeoutMs);
    provider.requests.length = 0;
    await new LocatorFactory(page).diagnose(unrecoverable, { provider, references, expected: undefined });
    check("without the flow it does not borrow another flow's reference", provider.requests.length === 0, provider.requests.length);
    provider.requests.length = 0;
    await factory()
      .resolve(unrecoverable)
      .catch(() => undefined);
    check("a run's suggestion stage stays inside its own 800 ms budget", (provider.requests[0]?.timeoutMs ?? Infinity) <= 800, provider.requests[0]?.timeoutMs);

    console.log("D. L12.8 Element Spy look-alikes");
    const saved: FlowStep = { id: "spy-step", name: "Save changes", type: "click", locator: { strategy: "css", value: "#save-order-v2" } } as FlowStep;
    provider.similarRequests.length = 0;
    const withLookAlikes = await new LocatorFactory(page).diagnose(saved, { provider, references });
    const expectedIndex = await page.locator("#save-order-v2").evaluate((el) => Array.prototype.indexOf.call(document.body.querySelectorAll("*"), el) as number);
    check("the diagnosis asks find_similar for the element the saved locator finds", provider.similarRequests.length === 1 && provider.similarRequests[0].index === expectedIndex, { asked: provider.similarRequests.map((r) => r.index), expectedIndex });
    check("...with the diagnosis budget", provider.similarRequests[0]?.timeoutMs === DOM_INTELLIGENCE_LIMITS.diagnosisTimeoutMs);
    check("...on a snapshot that stamps that index", provider.similarRequests[0]?.html.includes(`data-awkit-v="${expectedIndex}"`) === true);
    check("...and reports the count", withLookAlikes.similar?.outcome === "ok" && withLookAlikes.similar.count === 1, withLookAlikes.similar);
    provider.similarRequests.length = 0;
    const missing = await new LocatorFactory(page).diagnose({ ...saved, id: "spy-missing", locator: { strategy: "css", value: "#nowhere" } } as FlowStep, { provider, references });
    check("nothing is counted when the saved locator finds nothing", provider.similarRequests.length === 0 && missing.similar === undefined, missing.similar);
    const noSimilar = new RecordingProvider();
    (noSimilar as { findSimilar?: unknown }).findSimilar = undefined;
    const without = await new LocatorFactory(page).diagnose(saved, { provider: noSimilar, references });
    check("a provider without find_similar leaves the field out", without.similar === undefined, without.similar);

    console.log("E. L12.9 pre-run drift check");
    html = PAGE("save-order-v2").replace('<button type="button" class="btn">Cancel</button>', '<button type="button" class="btn">Cancel</button><a href="/x" class="row">Open</a><a href="/y" class="row">Open</a>');
    await page.goto(`${base}/orders`);
    const identityOf = async (selector: string) => hashFingerprint(await page.locator(selector).evaluate(createPageFingerprint));
    const savedIdentity = await identityOf("#save-order-v2");
    const driftOf = async (step: FlowStep, expected?: Awaited<ReturnType<typeof identityOf>>) =>
      classifyDrift(await new LocatorFactory(page).diagnose(step, { provider, references, expected }));
    const ok = await driftOf({ id: "d-ok", name: "Save", type: "click", locator: { strategy: "css", value: "#save-order-v2" } } as FlowStep, savedIdentity);
    const recoverable = await driftOf({ id: "d-rec", name: "Save", type: "click", locator: { strategy: "css", value: "#save-order-gone" } } as FlowStep, savedIdentity);
    const drifted = await driftOf({ id: "d-gone", name: "Gone", type: "click", locator: { strategy: "css", value: "#nothing" } } as FlowStep, { ...savedIdentity, tag: "select", role: "combobox", name: "zz", text: "zz" });
    const ambiguous = await driftOf({ id: "d-amb", name: "Open", type: "click", locator: { strategy: "css", value: "a.row" } } as FlowStep);
    check("a step whose saved locator finds its element is ok", ok === "ok", ok);
    check("a missed step AWKIT's proof would recover is recoverable", recoverable === "recoverable", recoverable);
    check("a missed step nothing recovers is drifted", drifted === "drifted", drifted);
    check("a step matching several elements is ambiguous", ambiguous === "ambiguous", ambiguous);
    const missed = { recorded: { status: "missing" as const }, provider: { outcome: "ok" as const, candidates: [] } };
    check("classify: a route mismatch is not-here", classifyDrift({ ...missed, route: "mismatch" }) === "not-here");
    check("classify: a protected surface is not-here", classifyDrift({ ...missed, provider: { outcome: "skipped", reason: "protected-surface", candidates: [] } }) === "not-here");
    check("classify: an agreed provider candidate makes a miss recoverable", classifyDrift({ ...missed, provider: { outcome: "ok", candidates: [{ index: 1, providerScore: 98, proof: "agreed" }] } }) === "recoverable");
    check("classify: a rejected provider candidate does not", classifyDrift({ ...missed, provider: { outcome: "ok", candidates: [{ index: 1, providerScore: 98, proof: "below-threshold" }] } }) === "drifted");

    console.log("H. L12.11 structural page identity");
    const recordedPath = ["html", "body", "main", "section", "form", "div", "button"];
    check("the recorded structure is present on the recorded page", (await referenceStructurePresent(page.mainFrame(), recordedPath)) === true);
    html = '<!doctype html><html><head><title>L12 lab</title></head><body><main><div class="empty-state"><h1>Order not found</h1><button type="button">Back to orders</button></div></main></body></html>';
    await page.goto(`${base}/orders`);
    check("an 'order not found' page at the same URL lacks it (a different page)", (await referenceStructurePresent(page.mainFrame(), recordedPath)) === false);
    check("a path shorter than three levels is never used to refuse", (await referenceStructurePresent(page.mainFrame(), ["body", "button"])) === true);
    check("a malformed tag is never turned into a selector (treated as present)", (await referenceStructurePresent(page.mainFrame(), ["div", "form", "button,x"])) === true);
    const variantStep: FlowStep = { id: "variant-step", name: "Save", type: "click", locator: { strategy: "css", value: "#save-order-v2" } } as FlowStep;
    await references.put({ ...seeded!, referenceId: domReferenceId(variantStep, "flow-a")!, bindingDigest: stepCandidatesDigest(variantStep.locator!), element: { ...seeded!.element, path: recordedPath } });
    provider.requests.length = 0;
    const variant = await new LocatorFactory(page).diagnose(variantStep, { provider, references, flowId: "flow-a" });
    check("the diagnosis skips the provider on a different page, as page-variant", variant.provider.reason === "page-variant" && provider.requests.length === 0, variant.provider);
    check("...and the drift check reports the step as not on this page", classifyDrift(variant) === "not-here", classifyDrift(variant));

    console.log("I. L12.12 identical list rows: the recorded row is not mounted");
    const rows = (ids: number[]) =>
      `<!doctype html><html><head><title>L12 lab</title></head><body><main><section class="orders"><ul class="rows">${ids
        .map((id) => `<li class="row"><span class="ref">Order</span><button type="button" class="view" data-row="${id}">View</button></li>`)
        .join("")}</ul></section></main></body></html>`;
    html = rows([1, 2, 3, 4]);
    await page.goto(`${base}/orders`);
    const rowStep: FlowStep = { id: "row-step", name: "View", type: "click", locator: { strategy: "css", value: 'button[data-row="4"]' } } as FlowStep;
    const listEvents: LocatorRecoveryEvent[] = [];
    const listFactory = () =>
      new LocatorFactory(page, { recoveryStore: store, scope: { scenarioId: "l12-list", flowId: "flow-a" }, recoveryGraceMs: 0, domIntelligence: { provider, references, budgetMs: 2_000 }, onRecoveryEvent: (event) => listEvents.push(event) });
    await listFactory().resolve(rowStep);
    html = rows([1, 2, 3]);
    await page.goto(`${base}/orders`);
    const providerStage = () => listEvents.findLast((event) => event.trace)?.trace?.stages.find((stage) => stage.stage === "provider");
    provider.answer = [[0, 96.43], [1, 96.43], [2, 96.43]];
    await listFactory().resolve(rowStep).catch(() => undefined);
    check("tied identical rows with the recorded one gone are reported as list-row-not-mounted", providerStage()?.reason === "list-row-not-mounted" && providerStage()?.outcome === "refused", providerStage());
    check("...and nothing was recovered", !listEvents.some((event) => event.type === "local-recovery"));
    provider.answer = [[0, 94.3], [1, 93.13], [2, 93.13]];
    listEvents.length = 0;
    await listFactory().resolve(rowStep).catch(() => undefined);
    check("control: a provider top that does not tie is not called an unmounted row", providerStage()?.reason !== "list-row-not-mounted", providerStage());
    provider.answer = [];

    console.log("G. L12.15 AI page context follows the local-AI switch");
    check("no override, AI off: no page context", pageContextEnabled({}, false) === false);
    check("no override, AI on: page context", pageContextEnabled({}, true) === true);
    check("override on wins over AI off", pageContextEnabled({ AWKIT_AI_PAGE_CONTEXT: "on" }, false) === true);
    check("override off wins over AI on", pageContextEnabled({ AWKIT_AI_PAGE_CONTEXT: "off" }, true) === false);
    const savedOverride = process.env.AWKIT_AI_PAGE_CONTEXT;
    delete process.env.AWKIT_AI_PAGE_CONTEXT;
    try {
      const contextFactory = (on: boolean | "throws") =>
        new LocatorFactory(page, { domIntelligence: { provider, references, pageContextDefault: async () => (on === "throws" ? Promise.reject(new Error("settings unreadable")) : on) } });
      const off = await contextFactory(false).capturePageContext();
      const on = await contextFactory(true).capturePageContext();
      const broken = await contextFactory("throws").capturePageContext();
      check("the factory skips the capture when the injected default is off", !off.ok && off.reason === "disabled", off);
      check("the factory attempts the capture when the injected default is on", !(!on.ok && on.reason === "disabled"), on);
      check("an unreadable default fails closed (off)", !broken.ok && broken.reason === "disabled", broken);
    } finally {
      if (savedOverride === undefined) delete process.env.AWKIT_AI_PAGE_CONTEXT;
      else process.env.AWKIT_AI_PAGE_CONTEXT = savedOverride;
    }
    console.log("J. L12.13 similar rows, through the real parser-only host");
    const staged = stageHost("awkit-l12-rows-");
    if (!staged) {
      console.log("  NOT RUN: the pinned runtime inputs are absent (npm run benchmark:dom-intelligence-runtime-setup).");
    } else {
      const host = staged.provider();
      try {
        html =
          '<!doctype html><html><head><title>L12 lab</title></head><body><main><h1>Orders</h1><ul class="orders">' +
          ["Order #1001 Alice", "Order #1002 Bob", "Order #1003 token=sk_live_1234567890abcdefXYZ", "Order #1004 Dana", "Order #1005 =SUM(A1)"]
            .map((text, i) => `<li class="order"><span class="ref">${text}</span><a class="view" href="/o/${1001 + i}">View</a><span style="display:none">hidden-${i}</span></li>`)
            .join("") +
          '</ul><aside><ul class="links"><li class="nav">Help</li></ul></aside></main></body></html>';
        await page.goto(`${base}/orders`);
        const picked = page.locator("li.order").nth(1);
        const result = await extractSimilarRows(page.mainFrame(), picked, host, (text) => new SemanticRedactor({ maxContentLength: 120 }).redactText(text));
        check("picking one row returns every row like it, in page order", result.ok && result.rows.length === 5 && result.rows[0].startsWith("Order #1001") && result.rows[4].startsWith("Order #1005"), result);
        check("...and nothing from another list", result.ok && !result.rows.some((row) => row.includes("Help")), result);
        check("...and no hidden text", result.ok && !result.rows.some((row) => row.includes("hidden-")), result);
        check("...with secrets redacted before they leave main", result.ok && !result.rows.some((row) => row.includes("sk_live_1234567890")), result.ok ? result.rows[2] : result);
        check("...and the total counts the picked row too", result.ok && result.total === 5, result);
        const csv = similarRowsCsv(result.ok ? result.rows : []);
        check("CSV: one quoted column with a header", csv.split("\r\n")[0] === '"Row"' && csv.split("\r\n").length === 6, csv);
        check("cells keep a space between adjacent inline elements", result.ok && result.rows[0] === "Order #1001 Alice View", result.ok ? result.rows[0] : result);
        check("CSV: a cell that starts with a formula character is neutralized", similarRowsCsv(["=SUM(A1)", "+1", "-2", "@x"]).split("\r\n").slice(1).every((cell) => cell.startsWith(`"'`)));
        check("CSV: an ordinary cell is left as it is", similarRowsCsv(["Order #1005 =SUM(A1)"]).endsWith('"Order #1005 =SUM(A1)"'));
        check("CSV: quotes are doubled", similarRowsCsv(['say "hi"']).endsWith('"say ""hi"""'));
        html = SIGN_IN_ROWS;
        await page.goto(`${base}/orders`);
        const guarded = await extractSimilarRows(page.mainFrame(), page.locator("li.order").first(), host, (text) => text);
        check("a page with a password field is never read for rows", !guarded.ok && guarded.reason === "protected-surface", guarded);

        console.log("K. L12.19 a for-each loop from one row's similar rows, on the mock-site Element Spy lab");
        const mock = spawn(process.execPath, ["mock-site/server.mjs"], { env: { ...process.env, MOCK_SITE_PORT: String(MOCK_PORT) }, stdio: "ignore" });
        try {
          await waitForMock();
          const lab = await browser.newPage();
          await lab.goto(`${MOCK}/recorder-lab/element-spy`);
          const rows = await extractSimilarRows(lab.mainFrame(), lab.locator('[data-spy="call-backup"]'), host, (text) => text);
          check("one Call button's similar rows are the four Call buttons", rows.ok && rows.total === 4 && rows.rows.every((row) => row === "Call"), rows);
          const loop = rows.ok ? rows.loop : undefined;
          check("...and one selector is proven for exactly those rows", typeof loop === "string" && (await lab.locator(loop).count()) === 4, loop);
          check("...anchored on the list, never on a row's own identity", typeof loop === "string" && !/slot-|contact-|dan@|Night shift/.test(loop), loop);
          const step = buildRecordedFlow("Contacts", [similarRowsLoopAction(loop ?? "", 4, "main")]).nodes.find((node) => node.type === "loop");
          check("the saved flow keeps an element loop that clicks, on that selector", step?.config?.loopType === "elements" && step.config.loopActionType === "click" && step.locator?.value === loop, step);
          const runDir = await mkdtemp(join(tmpdir(), "awkit-l12-loop-"));
          const ctx: InstanceExecutionContext = {
            executionId: "exec-l12", instanceId: "inst-l12", scenarioId: "scen-l12", flowId: "flow-l12", instanceOrderNumber: 1, totalInstances: 1,
            runtimeInputs: {}, instanceInputs: {}, flowOutputs: {},
            paths: { downloads: join(runDir, "d"), screenshots: join(runDir, "s"), logs: join(runDir, "l"), reports: join(runDir, "r"), sessions: join(runDir, "x") }
          };
          const ran = step ? await new StepExecutor(lab, new LocatorFactory(lab), new ValueResolver(ctx), ctx).execute(step) : undefined;
          check("running it passes with one iteration per row", ran?.status === "passed" && ran.outputs.iterations === 4, ran);
          check("...clicking every Call button once, in page order", (await lab.getByTestId("spy-log").textContent()) === "call-primary,call-backup,call-night,call-dan", await lab.getByTestId("spy-log").textContent());
          await rm(runDir, { recursive: true, force: true });
          // No loop when the rows differ in structure, or when no named container isolates exactly them.
          const buttons = async () => lab.locator("body *").evaluateAll((elements) => elements.map((element, i) => (element.localName === "button" ? i : -1)).filter((i) => i >= 0));
          await lab.setContent('<ul aria-label="Mixed"><li><button>Go</button></li><li><span><button>Go</button></span></li></ul>');
          check("rows with different tag paths get no loop", (await commonRowSelector(lab.mainFrame(), await buttons())) === null);
          await lab.setContent("<div><ul><li><button>A</button></li><li><button>B</button></li></ul><ul><li><button>C</button></li></ul></div>");
          check("rows no named container isolates get no loop", (await commonRowSelector(lab.mainFrame(), (await buttons()).slice(0, 2))) === null);
          await lab.close();
        } finally {
          mock.kill();
        }
      } finally {
        await host.shutdown().catch(() => undefined);
        staged.cleanup();
      }
    }
  } finally {
    await browser?.close().catch(() => undefined);
    server.close();
    await rm(root, { recursive: true, force: true });
  }

  console.log("C. L12.1 the host is prewarmed when work starts");
  const execution = readFileSync("app/main/ipc/execution.ipc.ts", "utf8");
  const runHandler = execution.slice(execution.indexOf('ipcMain.handle("execution:runWorkflow"'), execution.indexOf("applicationService.runWorkflow(request"));
  const realRun = runHandler.slice(runHandler.indexOf("if (request.dryRun === false)"));
  check("an authorized real run prewarms, after its permission checks", /assertSenderPermission\(event, Permission\.WORKFLOW_EXECUTE\);\s*\}\s*\/\/[^\n]*\n\s*prewarmDomIntelligence\(\);/.test(realRun), realRun.slice(-400));
  check("a dry run never prewarms (the call sits inside the dryRun === false block)", runHandler.indexOf("prewarmDomIntelligence()") > runHandler.indexOf("if (request.dryRun === false)"));
  const recorder = readFileSync("app/main/ipc/recorder.ipc.ts", "utf8");
  const handler = (name: string) => recorder.slice(recorder.indexOf(`ipcMain.handle("${name}"`), recorder.indexOf("ipcMain.handle(", recorder.indexOf(`ipcMain.handle("${name}"`) + 10));
  check("a recorder session prewarms after its browser is authorized", /resolveRecorderBrowser\(event, "recorder:start"\);\s*prewarmDomIntelligence\(\);/.test(handler("recorder:start")));
  check("an Element Spy session prewarms after its permission check", /RECORDER_ELEMENT_SPY\);[\s\S]*prewarmDomIntelligence\(\);[\s\S]*startInspection/.test(handler("recorder:startInspection")));
  const runtime = readFileSync("app/main/domIntelligence/domIntelligenceRuntime.ts", "utf8");
  check("prewarm is fire-and-forget and swallows failures", /export function prewarmDomIntelligence\(\): void \{\s*void getDomIntelligenceProvider\(\)\s*\.getStatus\(\)\s*\.catch\(\(\) => undefined\);/.test(runtime));

  console.log("F. L12.9 drift-check channel");
  const ipc = readFileSync("app/main/ipc/domIntelligence.ipc.ts", "utf8");
  const drift = ipc.slice(ipc.indexOf('ipcMain.handle("domIntelligence:checkDrift"'));
  check("the drift channel exists", drift.length > 0 && drift.includes("classifyDrift(diagnosis)"));
  check("it requires page.recorder and page.flows before reading anything", /assertSenderPermission\(event, Permission\.PAGE_RECORDER\);\s*await assertSenderPermission\(event, Permission\.PAGE_FLOWS\);\s*const request = sanitizeDriftRequest\(raw\)/.test(drift));
  check("it only diagnoses (no resolve, click or fill)", !/\.(resolve|click|fill|press)\(/.test(drift.slice(0, drift.indexOf("});") + 3)));
  check("it is bounded to DRIFT_MAX_STEPS", drift.includes(".slice(0, DRIFT_MAX_STEPS)"));
  check("step names are redacted before they cross the bridge", drift.includes("labelRedactor.redactText(step.name"));
  const preload = readFileSync("app/main/preload.ts", "utf8");
  check("the preload exposes checkDrift with a flow id only", /checkDrift: \(request: DomDriftRequest\) => invoke\("domIntelligence:checkDrift", request\)/.test(preload));
  const rowsHandler = ipc.slice(ipc.indexOf('ipcMain.handle("domIntelligence:similarRows"'), ipc.indexOf('ipcMain.handle("domIntelligence:checkDrift"'));
  check("L12.13 similar rows require page.recorder and the Element Spy permission first", /assertSenderPermission\(event, Permission\.PAGE_RECORDER\);\s*await assertSenderPermission\(event, Permission\.RECORDER_ELEMENT_SPY\);\s*similarRowsLoop = null;\s*const live = recorderService\.getInspectionTarget\(\)/.test(rowsHandler));
  const loopHandler = ipc.slice(ipc.indexOf('ipcMain.handle("domIntelligence:addSimilarRowsLoop"'), ipc.indexOf('ipcMain.handle("domIntelligence:checkDrift"'));
  check(
    "L12.19 the loop channel takes no request body and needs page.recorder and the Element Spy permission first",
    /handle\("domIntelligence:addSimilarRowsLoop", async \(event\)[^\n]*\n\s*await assertSenderPermission\(event, Permission\.PAGE_RECORDER\);\s*await assertSenderPermission\(event, Permission\.RECORDER_ELEMENT_SPY\);/.test(loopHandler)
  );
  check("L12.19 ...uses only main's own proven selector, for the same inspection", loopHandler.includes("inspection.inspectedAt !== loop.inspectedAt") && /addSimilarRowsLoop\(loop\.selector, loop\.rows, loop\.pageAlias\)/.test(loopHandler));
  check("L12.19 ...and every similarRows call clears the previous selector first", /similarRowsLoop = null;\s*const live = recorderService\.getInspectionTarget\(\)/.test(rowsHandler));
  check("L12.13 ...take no request body and redact every row in main",/handle\("domIntelligence:similarRows", async \(event\)/.test(rowsHandler) && rowsHandler.includes("labelRedactor.redactText(text)"));
  check("L12.15 main injects the local-AI switch as the run's page-context default", /setDomIntelligence\(\{ \.\.\.domIntelligenceRecoveryOptions\(\), pageContextDefault: localAiEnabled \}\)/.test(execution));
  const aiRuntime = readFileSync("app/main/ai/aiRuntime.ts", "utf8");
  check("L12.15 the switch reader never throws (an unreadable file reads as off)", /export async function localAiEnabled\(\): Promise<boolean> \{[\s\S]{0,160}\.then\(\(current\) => current\.enabled\)\s*\.catch\(\(\) => false\);/.test(aiRuntime));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
