/**
 * L11.E (awkit-djnl.19): the Element Spy / Designer "Find current element" diagnosis never rewrites a
 * locator silently, and offers "Use this locator" only for an element AWKIT's own identity proof picked.
 *
 * Run with: npm run verify:locator-diagnosis
 *
 *   A. Contract     the renderer's apply gate (`isApplicableSuggestion`) and the IPC request sanitizer.
 *   B. Proven       a drifted target (frozen L10.0 `id-changed`) is proven by AWKIT; the offered locator
 *                   holds in the editor's plain fields and resolves to the true target only; of the
 *                   provider's candidates only the true target is proven.
 *   C. Refused      a same-label decoy (`duplicate-text-decoy`): nothing is proven, nothing is offered.
 *   D. Protected    a document with a password field: the provider is skipped as a protected surface and
 *                   no element or suggestion is described.
 *   E. Read-only    diagnosing changes neither the page (DOM, events) nor the step.
 *   F. Source       the Spy mount has no apply path; the Designer's apply only edits the unsaved draft; the
 *                   component calls no IPC but the diagnosis.
 *
 * The provider is a deterministic fake (the real host has its own gate, verify:dom-intelligence-host):
 * it proposes every visible "Save…" button, so AWKIT's re-proof is what decides.
 */
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { chromium, type Browser, type Page } from "playwright";
import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";
import { getRecorderInitScriptContent } from "@src/recorder/recorderInitScript";
import type { RecordedAction } from "@src/recorder/RecorderTypes";
import type { FlowStep } from "@src/profiles/FlowProfile";
import { LocatorFactory, type LocatorDiagnosis } from "@src/runner/LocatorFactory";
import type { PageBlueprint } from "@src/runner/LocatorBlueprintStore";
import { isApplicableSuggestion, sanitizeDiagnosisRequest } from "@src/runner/domIntelligence/DomIntelligenceApi";
import type { DomIntelligenceProvider, DomRecoveryRequest } from "@src/runner/domIntelligence/DomIntelligenceProvider";
import { MemoryDomReferenceStore, type DomReferenceRecord } from "@src/runner/domIntelligence/domReference";
import { DOM_CASES } from "./dom-intelligence/fixtures.mts";

const PORT = 4435;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD_FIELD = '<label for="pw">Password</label><input type="password" id="pw" name="password" autocomplete="current-password">';

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail !== undefined ? ` — ${detail}` : ""}`);
  }
}

const byId = new Map(DOM_CASES.map((fixture) => [fixture.id, fixture]));
function fixture(id: string) {
  const found = byId.get(id);
  if (!found) throw new Error(`missing frozen fixture ${id}`);
  return found;
}

function startServer(): Promise<Server> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", BASE);
    const match = /^\/case\/([a-z0-9-]+)$/.exec(url.pathname);
    const found = match ? byId.get(match[1]) : undefined;
    if (!found) {
      response.writeHead(404).end();
      return;
    }
    const variant = url.searchParams.get("v");
    const html = variant === "baseline" ? found.baseline : variant === "protected" ? found.mutated.replace("</form>", `${PASSWORD_FIELD}</form>`) : found.mutated;
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
  });
  return new Promise((done) => server.listen(PORT, "127.0.0.1", () => done(server)));
}

/** The real Recorder capture of one click on the baseline page, finalized exactly as a saved recording. */
async function recordStep(browser: Browser, caseId: string): Promise<{ step: FlowStep; references: MemoryDomReferenceStore; referenced: boolean }> {
  const context = await browser.newContext();
  const actions: RecordedAction[] = [];
  try {
    await context.addInitScript({ content: getRecorderInitScriptContent() });
    await context.exposeBinding("__awtkit_recordAction", (_source, action) => actions.push(action as RecordedAction));
    await context.exposeBinding("__awtkit_recordSignal", () => undefined);
    const page = await context.newPage();
    await page.goto(`${BASE}/case/${caseId}?v=baseline`);
    await page.locator(fixture(caseId).targetSelector).click();
    for (let attempt = 0; attempt < 60 && !actions.some((a) => a.type === "click"); attempt += 1) await page.waitForTimeout(50);
    const blueprints: PageBlueprint[] = [];
    const domReferences: DomReferenceRecord[] = [];
    const flow = buildRecordedFlow(`diagnosis ${caseId}`, actions.filter((a) => a.type === "click").slice(0, 1), blueprints, { domReferencesOut: domReferences });
    const step = flow.nodes.find((node) => node.type === "click") as FlowStep | undefined;
    if (!step?.locator) throw new Error(`${caseId}: the recorder captured no click step`);
    const references = new MemoryDomReferenceStore();
    for (const reference of domReferences) await references.put(reference);
    return { step, references, referenced: domReferences.length === 1 };
  } finally {
    await context.close();
  }
}

/** Proposes every visible button whose text starts with "Save", in document order. */
function saveButtonProvider(requests: DomRecoveryRequest[]): DomIntelligenceProvider {
  return {
    getStatus: async () => ({ available: true, provider: "scrapling", mode: "parser-only", browserAccess: false, networkAccess: false }),
    saveReference: async () => ({ ok: true, fields: [] }),
    findRecoveryCandidates: async (request) => {
      requests.push(request);
      const candidates = [...request.html.matchAll(/<button\b([^>]*)>([^<]*)</g)]
        .filter((match) => /^\s*Save/.test(match[2]))
        .map((match) => Number(/data-awkit-v="(\d+)"/.exec(match[1])?.[1] ?? NaN))
        .filter((index) => Number.isInteger(index))
        .map((index, rank) => ({ index, score: 90 - rank }));
      return { ok: true, candidates, elements: candidates.length, parseMs: 0, matchMs: 0 };
    },
    normalizeForAi: async () => ({ ok: false, code: "DISABLED", message: "not used" }),
    shutdown: async () => undefined
  };
}

/** A page with the Recorder's init script, as the Element Spy's live page has it. */
async function livePage(browser: Browser, caseId: string, variant: "mutated" | "protected"): Promise<Page> {
  const context = await browser.newContext();
  await context.addInitScript({ content: getRecorderInitScriptContent() });
  await context.exposeBinding("__awtkit_recordAction", () => undefined);
  await context.exposeBinding("__awtkit_recordSignal", () => undefined);
  const page = await context.newPage();
  await page.goto(`${BASE}/case/${caseId}?v=${variant}`);
  return page;
}

async function diagnose(page: Page, recorded: Awaited<ReturnType<typeof recordStep>>, requests: DomRecoveryRequest[]): Promise<LocatorDiagnosis> {
  return new LocatorFactory(page).diagnose(recorded.step, {
    provider: saveButtonProvider(requests),
    references: recorded.references,
    expected: recorded.step.locator?.identity?.fingerprint,
    describe: true
  });
}

/** Is `body *`[index] the fixture's true target (null truth: there is none)? */
async function isTruthAt(page: Page, index: number, truthSelector: string | null): Promise<boolean> {
  if (!truthSelector) return false;
  const truth = await page.locator(truthSelector).elementHandle();
  const candidate = await page.locator("body *").nth(index).elementHandle();
  return Boolean(truth && candidate && (await page.evaluate(([a, b]) => a === b, [truth, candidate] as const)));
}

function offered(diagnosis: LocatorDiagnosis): number {
  const protectedSurface = diagnosis.provider.reason === "protected-surface";
  const proof = isApplicableSuggestion(diagnosis.snapshot?.element?.locator, diagnosis.snapshot?.outcome === "proven", protectedSurface) ? 1 : 0;
  return proof + diagnosis.provider.candidates.filter((candidate) => isApplicableSuggestion(candidate.element?.locator, candidate.proof === "proven", protectedSurface)).length;
}

function contract(): void {
  console.log("A. Contract (the apply gate and the request sanitizer)");
  const good = { strategy: "role", value: "button", name: "Save changes", exact: true, quality: { isUnique: true } };
  check("a proven, unique, editor-held locator is offered", isApplicableSuggestion(good, true, false));
  check("an unproven element is never offered", !isApplicableSuggestion(good, false, false));
  check("nothing is offered on a protected surface", !isApplicableSuggestion(good, true, true));
  check("a locator the generator did not prove unique is not offered", !isApplicableSuggestion({ ...good, quality: { isUnique: false } }, true, false));
  check("a locator without quality evidence is not offered", !isApplicableSuggestion({ ...good, quality: undefined }, true, false));
  check("a container-chain locator (the editor cannot hold it) is not offered", !isApplicableSuggestion({ ...good, quality: { isUnique: true, disambiguation: "container" } }, true, false));
  check("an xpath suggestion is not offered", !isApplicableSuggestion({ ...good, strategy: "xpath", value: "//button" }, true, false));
  check("an unknown strategy is not offered", !isApplicableSuggestion({ ...good, strategy: "shadowPath" }, true, false));
  check("an empty value is not offered", !isApplicableSuggestion({ ...good, value: "" }, true, false));
  check("no element, no offer", !isApplicableSuggestion(undefined, true, false));

  const flow = sanitizeDiagnosisRequest({ source: "flow", flowId: "flow-1", stepId: "step-2", url: "https://example.test", selector: "#x", html: "<p>" });
  check("a flow request keeps only its ids (url, selector and html dropped)", JSON.stringify(flow) === JSON.stringify({ source: "flow", flowId: "flow-1", stepId: "step-2" }), JSON.stringify(flow));
  const draft = sanitizeDiagnosisRequest({ source: "draft", actionId: "a-1", locator: { strategy: "css", value: "*" } });
  check("a draft request keeps only its action id", JSON.stringify(draft) === JSON.stringify({ source: "draft", actionId: "a-1" }), JSON.stringify(draft));
  check("a path-like id is refused", sanitizeDiagnosisRequest({ source: "flow", flowId: "../x", stepId: "s" }) === undefined);
  check("an unknown source is refused", sanitizeDiagnosisRequest({ source: "page", actionId: "a" }) === undefined);
}

async function proven(browser: Browser): Promise<void> {
  console.log("B. Proven drift (id-changed) and E. read-only");
  const id = "id-changed";
  const recorded = await recordStep(browser, id);
  check("the recording produced a bound DOM reference", recorded.referenced);
  check("the recorded step carries an identity to prove against", Boolean(recorded.step.locator?.identity?.fingerprint));
  const page = await livePage(browser, id, "mutated");
  try {
    await page.evaluate(() => {
      const counts: Record<string, number> = {};
      (window as unknown as { __diagEvents: Record<string, number> }).__diagEvents = counts;
      for (const type of ["click", "mousedown", "pointerdown", "input", "change", "submit", "keydown"]) {
        document.addEventListener(type, () => (counts[type] = (counts[type] ?? 0) + 1), true);
      }
    });
    const domBefore = await page.evaluate(() => document.documentElement.outerHTML);
    const stepBefore = JSON.stringify(recorded.step);
    const requests: DomRecoveryRequest[] = [];
    const diagnosis = await diagnose(page, recorded, requests);
    const domAfter = await page.evaluate(() => document.documentElement.outerHTML);
    const events = await page.evaluate(() => (window as unknown as { __diagEvents: Record<string, number> }).__diagEvents);

    check("AWKIT's identity proof finds the drifted target", diagnosis.snapshot?.outcome === "proven", JSON.stringify(diagnosis.snapshot));
    const suggestion = diagnosis.snapshot?.element?.locator;
    check("the proven element is described with a suggestion", Boolean(suggestion), JSON.stringify(diagnosis.snapshot?.element));
    check("the proven suggestion passes the apply gate", offered(diagnosis) >= 1 && isApplicableSuggestion(suggestion, true, false), JSON.stringify(suggestion));
    if (suggestion) {
      // Exactly what the Designer's "Use this locator" writes: strategy, value, name and exact, on the step's own context.
      const edited: FlowStep = {
        ...recorded.step,
        locator: { strategy: suggestion.strategy as never, value: suggestion.value, name: suggestion.name, exact: suggestion.exact, context: recorded.step.locator?.context }
      };
      const locator = await new LocatorFactory(page).resolve(edited).catch(() => undefined);
      const count = await locator?.count().catch(() => 0);
      const truth = await page.locator(fixture(id).truthSelector!).elementHandle();
      const hit = locator && count === 1 ? await locator.elementHandle() : null;
      check("the applied suggestion resolves exactly one element", count === 1, `count ${count}`);
      check("that element is the true target", Boolean(truth && hit && (await page.evaluate(([a, b]) => a === b, [truth, hit] as const))));
    }

    check("the provider was consulted with the sanitized snapshot", requests.length === 1 && requests[0].html.includes("data-awkit-v="));
    check("the provider proposed more than one element (so the proof has a choice)", diagnosis.provider.candidates.length >= 2, `${diagnosis.provider.candidates.length}`);
    const provenCandidates = diagnosis.provider.candidates.filter((candidate) => candidate.proof === "proven");
    check("exactly one provider candidate is proven by AWKIT", provenCandidates.length === 1, JSON.stringify(diagnosis.provider.candidates.map((c) => c.proof)));
    check("the proven candidate is the true target", provenCandidates.length === 1 && (await isTruthAt(page, provenCandidates[0].index, fixture(id).truthSelector)));
    const decoys = diagnosis.provider.candidates.filter((candidate) => candidate.proof !== "proven");
    check("every unproven candidate stays evidence only", decoys.length >= 1 && decoys.every((candidate) => !isApplicableSuggestion(candidate.element?.locator, candidate.proof === "proven", false)));
    check("provider latency is reported", typeof diagnosis.provider.ms === "number" && diagnosis.provider.ms >= 0);
    check("the frame context is reported (top document)", diagnosis.frame === "main");

    check("E. the page DOM is unchanged by the diagnosis (no stamps, no edits)", domBefore === domAfter);
    check("E. the diagnosis dispatched no user event", Object.keys(events).length === 0, JSON.stringify(events));
    check("E. the step (and its locator) is unchanged by the diagnosis", JSON.stringify(recorded.step) === stepBefore);
  } finally {
    await page.context().close();
  }
}

async function refused(browser: Browser): Promise<void> {
  console.log("C. Refused (duplicate-text-decoy)");
  const id = "duplicate-text-decoy";
  const recorded = await recordStep(browser, id);
  const page = await livePage(browser, id, "mutated");
  try {
    const requests: DomRecoveryRequest[] = [];
    const diagnosis = await diagnose(page, recorded, requests);
    check("the proof refuses the same-label decoy page", diagnosis.snapshot?.outcome === "refused", JSON.stringify(diagnosis.snapshot));
    check("no refused element is described", diagnosis.snapshot?.element === undefined);
    check("the provider proposed both 'Save changes' buttons", diagnosis.provider.candidates.length >= 2, `${diagnosis.provider.candidates.length}`);
    check("no provider candidate is proven", diagnosis.provider.candidates.every((candidate) => candidate.proof !== "proven"), JSON.stringify(diagnosis.provider.candidates.map((c) => c.proof)));
    check("nothing is offered to apply", offered(diagnosis) === 0);
  } finally {
    await page.context().close();
  }
}

async function protectedSurface(browser: Browser): Promise<void> {
  console.log("D. Protected surface (password field)");
  const id = "id-changed";
  const recorded = await recordStep(browser, id);
  const page = await livePage(browser, id, "protected");
  try {
    check("the protected page really has a password field", (await page.locator('input[type="password"]').count()) === 1);
    const requests: DomRecoveryRequest[] = [];
    const diagnosis = await diagnose(page, recorded, requests);
    check("the provider is skipped as a protected surface", diagnosis.provider.outcome === "skipped" && diagnosis.provider.reason === "protected-surface", JSON.stringify(diagnosis.provider));
    check("no HTML reached the provider", requests.length === 0);
    check("no element is described on a protected document", diagnosis.snapshot?.element === undefined, JSON.stringify(diagnosis.snapshot?.element));
    check("nothing is offered to apply", offered(diagnosis) === 0);
  } finally {
    await page.context().close();
  }
}

/** Every `<LocatorDiagnosisSection … />` element in a file, captured permissively. */
function mounts(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(/<LocatorDiagnosisSection\b[^]*?\/>/g)].map((match) => match[0]);
}

function source(): void {
  console.log("F. Source (mounts and the component's only IPC)");
  const spy = mounts("app/renderer/pages/Recorder.tsx");
  const designer = mounts("app/renderer/components/workflow/FlowNodePropertiesPanel.tsx");
  check("the Element Spy mounts the diagnosis", spy.length >= 1, `${spy.length}`);
  check("the Spy mount has no apply path (read-only)", spy.length >= 1 && spy.every((mount) => !/onUseSuggestion/.test(mount)));
  check("the Designer mounts the diagnosis with an apply path", designer.length === 1 && /onUseSuggestion/.test(designer[0]), `${designer.length}`);
  check("the Designer's apply edits the unsaved draft only (editLocator, no IPC, no saved-flow reload)", designer.length === 1 && /editLocator\(/.test(designer[0]) && !/playwrightFlowStudio|onSavedFlowChanged|onApplied/.test(designer[0]));
  const component = readFileSync("app/renderer/components/workflow/LocatorDiagnosisSection.tsx", "utf8");
  const calls = [...component.matchAll(/playwrightFlowStudio\s*\.\s*([\w$]+)\s*\.\s*([\w$]+)/g)].map((match) => `${match[1]}.${match[2]}`);
  check("the component calls an IPC method", calls.length >= 1);
  check("the only IPC the component calls is the read-only diagnosis", calls.every((call) => call === "domIntelligence.diagnoseStep"), calls.join(", "));
  const uses = [...component.matchAll(/useButton\(/g)].length;
  const gated = [...component.matchAll(/usable\([^)]*\)\s*\?\s*useButton\(/g)].length;
  check("every 'Use this locator' button is behind the apply gate", uses >= 2 && gated === uses, `${gated} gated of ${uses} uses`);
}

async function main(): Promise<void> {
  contract();
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    await proven(browser);
    await refused(browser);
    await protectedSurface(browser);
  } finally {
    await browser.close();
    server.close();
  }
  source();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

await main();
