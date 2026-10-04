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
import { classifyDrift } from "@src/runner/domIntelligence/DomIntelligenceApi";
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
  async findRecoveryCandidates(request: DomRecoveryRequest): Promise<DomRecoveryResult> {
    this.requests.push(request);
    return { ok: true, candidates: [], elements: 0, parseMs: 0, matchMs: 0 };
  }
  saveReference = () => this.off.saveReference();
  normalizeForAi = () => this.off.normalizeForAi();
  shutdown = () => this.off.shutdown();
}

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

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
