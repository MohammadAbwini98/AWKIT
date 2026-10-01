/**
 * verify:dom-normalization / benchmark:dom-normalization — L11.G AI-context normalization (awkit-djnl.19).
 *
 * The required path, end to end, on real Chromium and the REAL staged parser-only host:
 *   eligible page → protected-surface refusal → in-page minimization (captureDomSnapshot, normalize mode)
 *   → normalize_dom (parser-only Scrapling host) → normalizePageContext (closed shape, SemanticRedactor,
 *   residual rescan, bounds) → the failure analysis request (buildFailureAnalysisRequest) → buildAiPrompt.
 *
 *   A. the pure normalizer: hostile shapes, closed roles, bounds, redaction, the rescan behind a failed redactor;
 *   B. every fixture page (scripts/dom-intelligence/normalizationPages.mts): no canary in the HTML that crossed to
 *      the host, its answer, the context or the prompt; visible secrets redacted; hidden content dropped; the
 *      labelled causal facts kept; protected sign-in, OTP, CAPTCHA and passkey pages refused before any HTML
 *      left them; the SSO-text control not refused; a page far past every bound truncated and bounded;
 *   C. fallbacks: no provider, a disabled, a hung and a malformed provider each resolve to a refusal in budget,
 *      and a failure without a context builds exactly the request it built before;
 *   D. the product path: real ExecutionEngine runs with AWKIT_AI_PAGE_CONTEXT=on put the context (or its
 *      refusal) into report.json, failureBatch carries it and the request shows it; off by default; suppressed
 *      with raw-UI-text suppression; refused on a protected page;
 *   E. measured, old versus new: raw DOM bytes, the browser's innerText (the L10.0 baseline), sanitized HTML,
 *      the normalized context and the rendered lines; facts kept by each; prompt size per labelled case.
 *
 * `--write` (benchmark:dom-normalization) also writes the labelled contexts the live comparison reads
 * (scripts/ai-harness/pageContextCases.json) and the measured results
 * (docs/plans/ai-upgrade-v5/evidence/L11-normalization-results.json).
 *
 * Exit 2 (NOT RUN) without the pinned runtime inputs.
 *
 * Run: npm run verify:dom-normalization   (node scripts/benchmark/run.mjs → tsx + the electron stub)
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { join, resolve } from "node:path";

import { chromium, type Browser, type Page } from "playwright";

import { failureBatch } from "@main/ai/aiAssist";
import { buildAiPrompt } from "@src/ai/AiPromptBuilder";
import { FAILURE_ANALYSIS_LIMITS, buildFailureAnalysisRequest, coalesceFailures } from "@src/ai/failureAnalysis";
import type { ConcurrentRunProfile } from "@src/instances/ConcurrentRunProfile";
import type { FlowProfile, FlowStep } from "@src/profiles/FlowProfile";
import type { ScenarioProfile } from "@src/profiles/ScenarioProfile";
import type { ConcurrentRunReport } from "@src/reports/ExecutionReport";
import { ExecutionEngine } from "@src/runner/ExecutionEngine";
import { NoopDomIntelligenceProvider, type DomIntelligenceProvider, type DomNormalizationRequest, type DomNormalizationResult } from "@src/runner/domIntelligence/DomIntelligenceProvider";
import { MemoryDomReferenceStore } from "@src/runner/domIntelligence/domReference";
import { capturePageContext } from "@src/runner/domIntelligence/normalizeDom";
import { PAGE_CONTEXT_LIMITS, normalizePageContext, pageContextLines, type PageContext } from "@src/runner/domIntelligence/pageContext";
import { SemanticRedactor } from "@src/semantic/SemanticRedactor";

import { ERROR_SET, buildCase, requestFor } from "./ai-harness/errorQualitySet";
import { buildDirs, cleanupRoot, installBenchGuards } from "./benchmark/engineHarness.mts";
import { NORMALIZATION_PAGES, SAFETY_CANARIES, VISIBLE_SECRETS, type NormalizationPage } from "./dom-intelligence/normalizationPages.mts";
import { stageHost } from "./dom-intelligence/stagedHost.mts";

installBenchGuards();
const ROOT = resolve(".");
const WRITE = process.argv.includes("--write");
const CASES_PATH = join(ROOT, "scripts", "ai-harness", "pageContextCases.json");
const RESULTS_PATH = join(ROOT, "docs", "plans", "ai-upgrade-v5", "evidence", "L11-normalization-results.json");
const NONCE = "0123456789abcdef0123456789abcdef";

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: unknown): boolean {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
  return Boolean(condition);
}
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const leaks = (text: string, canaries: readonly string[]) => canaries.filter((canary) => text.toLowerCase().includes(canary.toLowerCase()));
const hasFact = (text: string, fact: string) => text.toLowerCase().includes(fact.toLowerCase());
const pct = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : NaN;
};

/** Wraps a provider and keeps every HTML it was handed and every answer it gave. */
class SpyProvider implements DomIntelligenceProvider {
  readonly sent: string[] = [];
  readonly answers: DomNormalizationResult[] = [];
  constructor(private readonly inner: DomIntelligenceProvider) {}
  getStatus = () => this.inner.getStatus();
  saveReference = (reference: Parameters<DomIntelligenceProvider["saveReference"]>[0]) => this.inner.saveReference(reference);
  findRecoveryCandidates = (request: Parameters<DomIntelligenceProvider["findRecoveryCandidates"]>[0]) => this.inner.findRecoveryCandidates(request);
  async normalizeForAi(request: DomNormalizationRequest): Promise<DomNormalizationResult> {
    this.sent.push(request.html);
    const answer = await this.inner.normalizeForAi(request);
    this.answers.push(answer);
    return answer;
  }
  shutdown = () => this.inner.shutdown();
}

class ScriptedNormalizer implements DomIntelligenceProvider {
  private readonly off = new NoopDomIntelligenceProvider();
  constructor(private readonly mode: "hang" | "malformed") {}
  async getStatus() {
    return { available: true, provider: "scrapling" as const, mode: "parser-only" as const, browserAccess: false as const, networkAccess: false as const };
  }
  async normalizeForAi(): Promise<DomNormalizationResult> {
    if (this.mode === "hang") return new Promise(() => undefined);
    return { ok: false, code: "MALFORMED", message: "outside the protocol" };
  }
  saveReference = () => this.off.saveReference();
  findRecoveryCandidates = () => this.off.findRecoveryCandidates();
  shutdown = () => this.off.shutdown();
}

function serve(pages: readonly NormalizationPage[]): Promise<{ server: Server; base: string }> {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const server = createServer((request, response) => {
    const id = new URL(request.url ?? "/", "http://x").pathname.replace(/^\/page\//, "");
    const found = byId.get(id);
    if (!found) return void response.writeHead(404).end();
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(found.html);
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done({ server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}` })));
}

async function main(): Promise<void> {
  // ── A. The pure normalizer ─────────────────────────────────────────────────────────────────────
  console.log("A. The normalizer: shape, roles, bounds, redaction, rescan");
  {
    const hostile = normalizePageContext({
      landmarks: [{ role: "navigation", label: "Main" }, { role: "evil<script>", label: 7 } as never, "x" as never],
      headings: [{ level: 9, text: "Deep" }, { level: 1, text: "  Title   with   space  " }],
      interactive: Array.from({ length: 40 }, (_, i) => ({ role: i === 0 ? "BUTTON" : "weird-role", name: `Act ${i}`, disabled: i === 1 })),
      alerts: ["Your session token: abc123secretvalue", "Call billing.team@shop.example", null as never],
      forms: [{ label: "Pay", fields: [{ role: "textbox", label: "Card 4111111111111111", required: true, invalid: true }] }],
      tables: [{ label: "T", columns: ["A", "B"], rows: 1e12 }],
      text: ["word ".repeat(100)],
      truncated: false
    });
    check("hostile shapes are dropped, never thrown", hostile.landmarks.length === 2 && hostile.alerts.length === 2);
    check("roles come from a closed vocabulary (unknown roles collapse to 'control')", hostile.interactive[0].role === "button" && hostile.interactive[2].role === "control" && hostile.landmarks[1] === "control");
    check("every list is bounded and the context says it was cut", hostile.interactive.length === PAGE_CONTEXT_LIMITS.interactive && hostile.truncated === true);
    check("every string is capped", hostile.text[0].length === PAGE_CONTEXT_LIMITS.maxItemChars);
    check("row counts are clamped", hostile.tables[0].rows === 100_000);
    check("the existing SemanticRedactor removes a token, an email and a card number", !JSON.stringify(hostile).match(/abc123secretvalue|billing\.team@shop\.example|4111111111111111/), JSON.stringify(hostile.alerts));
    // A redactor that fails: the residual rescan still replaces what would be stored.
    const leaky = normalizePageContext({ landmarks: [], headings: [], interactive: [], alerts: ["Bearer abcdefgh12345678secret"], forms: [], tables: [], text: [], truncated: false }, { redactText: (value: string) => value });
    check("behind a redactor that let a secret through, the rescan replaces the string whole", leaky.alerts[0] === "[redacted]" && leaky.residualSecrets === 1, leaky.alerts);
    const lines = pageContextLines({ ...hostile, text: Array.from({ length: 6 }, () => "y".repeat(100)) }, 300);
    check("rendering keeps whole lines within its budget", lines.join("\n").length <= 300 && lines.length > 0);
  }

  const staged = stageHost("awkit-dom-normalization-");
  if (!staged) {
    console.log("NOT RUN: the pinned runtime inputs are absent (npm run benchmark:dom-intelligence-runtime-setup).");
    process.exit(passed > 0 && failed === 0 ? 2 : 1);
  }
  const { server, base } = await serve(NORMALIZATION_PAGES);
  let browser: Browser | undefined;
  const provider = staged.provider();
  const results: Record<string, unknown>[] = [];
  const contexts = new Map<string, PageContext>();
  try {
    browser = await chromium.launch();
    const open = async (id: string): Promise<Page> => {
      const page = await browser!.newPage();
      await page.goto(`${base}/page/${id}`);
      return page;
    };
    const cold = performance.now();
    const status = await provider.getStatus();
    const coldStartMs = performance.now() - cold;
    check("the staged parser-only host is available", status.available && status.mode === "parser-only" && !status.browserAccess && !status.networkAccess, status);

    // ── B. Every fixture page through the real path ──────────────────────────────────────────────
    console.log("B. Fixture pages through the real path");
    for (const fixture of NORMALIZATION_PAGES) {
      const page = await open(fixture.id);
      const spy = new SpyProvider(provider);
      const rawDom = await page.content();
      const innerText = await page.evaluate(() => document.body.innerText);
      const outcome = await capturePageContext(page, spy);
      const sent = spy.sent.join("\n");
      const answer = JSON.stringify(spy.answers);
      const record: Record<string, unknown> = {
        id: fixture.id,
        kind: fixture.kind,
        caseId: fixture.caseId,
        outcome: outcome.ok ? "context" : outcome.reason,
        rawDomBytes: Buffer.byteLength(rawDom),
        innerTextChars: innerText.length,
        innerTextFacts: fixture.facts.filter((fact) => hasFact(innerText, fact)).length,
        innerTextCanaryLeaks: leaks(innerText, fixture.canaries).length,
        facts: fixture.facts.length,
        ...outcome.metrics
      };
      if (fixture.kind === "protected") {
        check(`${fixture.id}: refused as a protected surface`, !outcome.ok && outcome.reason === "protected-surface", outcome.ok ? "context" : outcome.reason);
        check(`${fixture.id}: no HTML left the page (the host was never asked)`, spy.sent.length === 0, spy.sent.length);
      } else {
        check(`${fixture.id}: a context was produced`, outcome.ok, outcome.ok ? "" : outcome.reason);
        if (outcome.ok) {
          const contextText = JSON.stringify(outcome.context);
          const rendered = pageContextLines(outcome.context).join("\n");
          const safetyCanaries = fixture.canaries.filter((canary) => !VISIBLE_SECRETS.includes(canary));
          check(`${fixture.id}: no hidden, script, value, attribute, URL or frame canary reached the host`, leaks(sent, safetyCanaries).length === 0, leaks(sent, safetyCanaries));
          check(`${fixture.id}: ...nor its answer`, leaks(answer, safetyCanaries).length === 0, leaks(answer, safetyCanaries));
          // Visible secrets are page text, so the host sees them by design; AWKIT's redactor runs after it.
          check(`${fixture.id}: no canary and no visible secret reaches the context or the rendered lines`, leaks(contextText + rendered, fixture.canaries).length === 0, leaks(contextText + rendered, fixture.canaries));
          const kept = fixture.facts.filter((fact) => hasFact(rendered, fact));
          check(`${fixture.id}: every labelled fact is kept (${kept.length}/${fixture.facts.length})`, kept.length === fixture.facts.length, fixture.facts.filter((fact) => !kept.includes(fact)));
          check(`${fixture.id}: the context is bounded (rendered ≤ ${PAGE_CONTEXT_LIMITS.maxRenderedChars} chars, HTML ≤ ${PAGE_CONTEXT_LIMITS.maxHtmlBytes} bytes)`, rendered.length <= PAGE_CONTEXT_LIMITS.maxRenderedChars && (outcome.metrics.htmlBytes ?? Infinity) <= PAGE_CONTEXT_LIMITS.maxHtmlBytes + 64);
          Object.assign(record, {
            sanitizedHtmlBytes: outcome.metrics.htmlBytes,
            normalizedBytes: Buffer.byteLength(contextText),
            renderedChars: rendered.length,
            factsKept: kept.length,
            truncated: outcome.context.truncated,
            residualSecrets: outcome.context.residualSecrets
          });
          if (fixture.kind === "safety") {
            check("safety: visible secrets reached the host as page text but none survives the redactor", leaks(contextText + rendered, VISIBLE_SECRETS).length === 0);
            check("safety: hidden subtrees were dropped in the page, before any HTML left it", (outcome.metrics.hiddenDropped ?? 0) >= 4 && leaks(sent, SAFETY_CANARIES.slice(0, 4)).length === 0, outcome.metrics.hiddenDropped);
            // The L10.0 baseline, recorded rather than judged: innerText drops CSS-hidden and [hidden] text but
            // keeps aria-hidden text (it is painted), which this path drops.
            record.innerTextHiddenCanaries = leaks(innerText, SAFETY_CANARIES.slice(0, 4));
          }
          if (fixture.kind === "scale") {
            const c = outcome.context;
            check("scale: the page is past every bound and the context says it was truncated", c.truncated === true, c.truncated);
            check(
              "scale: every list holds at most its bound",
              c.headings.length <= PAGE_CONTEXT_LIMITS.headings && c.interactive.length <= PAGE_CONTEXT_LIMITS.interactive && c.forms.every((form) => form.fields.length <= PAGE_CONTEXT_LIMITS.formFields) && c.tables.length <= PAGE_CONTEXT_LIMITS.tables && c.text.length <= PAGE_CONTEXT_LIMITS.text
            );
          }
          if (fixture.caseId) contexts.set(`${fixture.caseId}:${fixture.row ?? 0}`, outcome.context);
        }
      }
      results.push(record);
      await page.close();
    }

    // Warm latency on a representative labelled page.
    const latencies: number[] = [];
    {
      const page = await open("lbl-native-validation");
      for (let i = 0; i < 20; i += 1) {
        const run = await capturePageContext(page, provider);
        if (run.ok) latencies.push(run.metrics.totalMs);
      }
      await page.close();
    }

    // ── C. Fallbacks ────────────────────────────────────────────────────────────────────────────
    console.log("C. Fallbacks: every fault is a refusal, and no context means the request it always was");
    {
      const page = await open("lbl-native-validation");
      const none = await capturePageContext(page, undefined);
      check("no provider: provider-unavailable", !none.ok && none.reason === "provider-unavailable");
      const off = await capturePageContext(page, new NoopDomIntelligenceProvider());
      check("a disabled provider: provider-unavailable", !off.ok && off.reason === "provider-unavailable");
      const started = performance.now();
      const hung = await capturePageContext(page, new ScriptedNormalizer("hang"), { budgetMs: 600 });
      const hungMs = performance.now() - started;
      check("a hung provider: provider-timeout inside the budget", !hung.ok && hung.reason === "provider-timeout" && hungMs < 1_200, `${hung.ok ? "context" : hung.reason} in ${hungMs.toFixed(0)} ms`);
      const malformed = await capturePageContext(page, new ScriptedNormalizer("malformed"));
      check("a malformed answer: provider-error", !malformed.ok && malformed.reason === "provider-error");
      await page.close();
    }

    // The failure analysis, old versus new, over the labelled set.
    const promptRows: Record<string, unknown>[] = [];
    {
      for (const labelled of ERROR_SET.filter((c) => !c.captured && c.expectsCall)) {
        for (const row of labelled.ask) {
          const { report } = buildCase(labelled);
          const instance = report.instances[row];
          const before = requestFor(report, instance.instanceId);
          const context = contexts.get(`${labelled.id}:${row}`);
          if (!before || !context) {
            check(`${labelled.id} row ${row + 1}: a labelled page context exists`, false, { request: Boolean(before), context: Boolean(context) });
            continue;
          }
          instance.diagnostics = { ...instance.diagnostics!, pageContext: context };
          const after = requestFor(report, instance.instanceId)!;
          const oldPrompt = buildAiPrompt(before.prompt, new SemanticRedactor(), NONCE);
          const newPrompt = buildAiPrompt(after.prompt, new SemanticRedactor(), NONCE);
          const sameGrammar = JSON.stringify(before.schema) === JSON.stringify(after.schema) && JSON.stringify(before.evidence.map((e) => e.id)) === JSON.stringify(after.evidence.map((e) => e.id));
          const shown = newPrompt.ok && !newPrompt.omittedFields.includes("PageAtFailure") && newPrompt.user.includes('name="PageAtFailure"');
          promptRows.push({
            caseId: labelled.id,
            row: row + 1,
            oldPromptChars: oldPrompt.ok ? oldPrompt.system.length + oldPrompt.user.length : null,
            newPromptChars: newPrompt.ok ? newPrompt.system.length + newPrompt.user.length : null,
            pageShown: shown,
            sameGrammar,
            saysNotCitable: newPrompt.ok && newPrompt.system.includes("cannot be cited") && oldPrompt.ok && !oldPrompt.system.includes("cannot be cited"),
            canaryInPrompt: newPrompt.ok ? leaks(newPrompt.user, [...SAFETY_CANARIES, ...VISIBLE_SECRETS, "QX7CANARY"]).length : null
          });
          check(`${labelled.id} row ${row + 1}: the page is shown, the grammar and the citable ids are unchanged`, newPrompt.ok && shown && sameGrammar, { ok: newPrompt.ok, shown, sameGrammar });
        }
      }
      const control = ERROR_SET.find((c) => c.id === "native-validation")!;
      const { report } = buildCase(control);
      const first = requestFor(report, report.instances[0].instanceId)!;
      const again = requestFor(report, report.instances[0].instanceId)!;
      check("no context: the request is exactly the one built before (no page field, no page instruction)", JSON.stringify(first.prompt) === JSON.stringify(again.prompt) && !first.prompt.fields.some((f) => f.name === "PageAtFailure") && !first.prompt.instructions.includes("page as it was"));
      check(`all ${promptRows.length} labelled rows: only the new prompt says the page cannot be cited`, promptRows.length === 13 && promptRows.every((r) => r.saysNotCitable === true), promptRows.length);
      check("no canary reaches any new prompt (L5's own canary included)", promptRows.every((r) => r.canaryInPrompt === 0), promptRows.map((r) => r.canaryInPrompt));
    }

    // ── D. The product path through the real engine ─────────────────────────────────────────────
    console.log("D. The product path: report.json, failureBatch and the request");
    const engineRuns: Record<string, unknown> = {};
    {
      const { dirs, root } = await buildDirs("awkit-dom-normalization-engine-");
      try {
        const engine = new ExecutionEngine();
        engine.configureConcurrency({ maxBrowsersPerHost: 2, maxActiveFlows: 2, useSharedBrowserPool: false, workloadWeights: false });
        engine.setDomIntelligence({ provider, references: new MemoryDomReferenceStore(), budgetMs: 800 });
        const failing = (id: string, url: string): FlowProfile => {
          const steps: FlowStep[] = [
            { id: "start", type: "start", name: "start" },
            { id: "goto", type: "goto", name: "Open", url },
            { id: "missing", type: "click", name: "Click the confirmation", timeoutMs: 800, locator: { strategy: "testId", value: "never-there" } },
            { id: "end", type: "end", name: "end" }
          ];
          return { id, name: id, version: 1, nodes: steps, edges: steps.slice(0, -1).map((step, index) => ({ id: `${id}-e${index}`, source: step.id, target: steps[index + 1].id, type: "success" })) } as FlowProfile;
        };
        const run = async (key: string, url: string, suppress = false): Promise<ConcurrentRunReport | undefined> => {
          const executionId = `dn-${key}-${Date.now().toString(36)}`;
          const flow = failing(`dn-flow-${key}`, url);
          const scenario: ScenarioProfile = { id: `dn-scn-${key}`, name: key, executionMode: "sequential", maxParallelFlows: 1, flows: [{ order: 1, flowId: flow.id, required: true }], links: [], failurePolicy: { stopOnRequiredFlowFailure: true, continueOnOptionalFlowFailure: false, takeScreenshotOnFailure: false } };
          const profile: ConcurrentRunProfile = {
            id: executionId,
            scenarioId: scenario.id,
            runMode: "fixedConcurrent",
            maxConcurrentInstances: 1,
            browserWindowMode: "headless",
            instanceTemplate: { browser: "chromium", headless: true, isolationMode: "browserContext", baseUrl: base, timeoutMs: 30_000, viewport: { width: 1280, height: 720 }, ...(suppress ? { suppressEvidenceUiText: true } : {}) },
            resourceControls: { maxBrowserContextsPerProcess: 4, delayBetweenInstanceStartsMs: 0 },
            failurePolicy: { stopAllOnCriticalFailure: false, continueOtherInstancesOnFailure: true, retryFailedInstance: false, retryCount: 0 }
          };
          await engine.startRun(executionId, profile, [undefined], dirs, {}, scenario, [flow]);
          for (let waited = 0; waited < 60_000; waited += 100) {
            const mine = engine.getInstances().filter((instance) => instance.executionId === executionId);
            if (mine.length === 1 && ["completed", "failed", "cancelled"].includes(mine[0].status)) break;
            await sleep(100);
          }
          const path = join(dirs.reports, executionId, "report.json");
          for (let waited = 0; !existsSync(path) && waited < 30_000; waited += 100) await sleep(100);
          return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as ConcurrentRunReport) : undefined;
        };

        delete process.env.AWKIT_AI_PAGE_CONTEXT;
        const off = await run("off", `${base}/page/lbl-native-validation`);
        const offDiag = off?.instances[0]?.diagnostics;
        check("off by default: the failed run's report carries no page context and no refusal", offDiag?.cause !== undefined && offDiag.pageContext === undefined && offDiag.pageContextRefusal === undefined, offDiag && Object.keys(offDiag));

        process.env.AWKIT_AI_PAGE_CONTEXT = "on";
        const on = await run("on", `${base}/page/lbl-native-validation`);
        const onDiag = on?.instances[0]?.diagnostics;
        const rendered = onDiag?.pageContext ? pageContextLines(onDiag.pageContext).join("\n") : "";
        check("on: report.json carries the failed step's page context", onDiag?.pageContext?.schemaVersion === 1 && hasFact(rendered, "Email") && hasFact(rendered, "INVALID"), onDiag?.pageContextRefusal);
        const batch = on ? failureBatch(on) : [];
        check("failureBatch hands it to the analysis", batch.length === 1 && batch[0].pageContext !== undefined);
        const group = coalesceFailures(batch).groups[0];
        const request = group ? buildFailureAnalysisRequest(group) : undefined;
        const prompt = request ? buildAiPrompt(request.prompt, new SemanticRedactor(), NONCE) : undefined;
        check("...and the request the product builds shows it, within the data budget", prompt?.ok === true && prompt.user.includes('name="PageAtFailure"') && !prompt.omittedFields.includes("PageAtFailure"));
        engineRuns.on = { pageContextChars: rendered.length, promptChars: prompt?.ok ? prompt.system.length + prompt.user.length : null };

        const guarded = await run("protected", `${base}/page/protected-password`);
        const guardedDiag = guarded?.instances[0]?.diagnostics;
        check("on, a protected sign-in page: no context, refused as a protected surface", guardedDiag?.pageContext === undefined && (guardedDiag?.pageContextRefusal === "protected-surface" || guardedDiag?.pageContextRefusal === "suppressed"), guardedDiag?.pageContextRefusal);

        const suppressed = await run("suppressed", `${base}/page/lbl-native-validation`, true);
        const suppressedDiag = suppressed?.instances[0]?.diagnostics;
        check("on, with raw-UI-text suppression: no context, recorded as suppressed", suppressedDiag?.pageContext === undefined && suppressedDiag?.pageContextRefusal === "suppressed", suppressedDiag?.pageContextRefusal);
        delete process.env.AWKIT_AI_PAGE_CONTEXT;
        engine.stopAll();
      } finally {
        await cleanupRoot(root);
      }
    }

    // ── E. Measured ─────────────────────────────────────────────────────────────────────────────
    const labelled = results.filter((r) => r.kind === "labelled");
    const sum = (rows: Record<string, unknown>[], key: string) => rows.reduce((n, r) => n + Number(r[key] ?? 0), 0);
    const summary = {
      pages: results.length,
      coldStartMs: Math.round(coldStartMs),
      warmCaptureMs: { p50: Math.round(pct(latencies, 50)), p95: Math.round(pct(latencies, 95)), n: latencies.length },
      labelled: {
        pages: labelled.length,
        rawDomBytes: sum(labelled, "rawDomBytes"),
        innerTextChars: sum(labelled, "innerTextChars"),
        sanitizedHtmlBytes: sum(labelled, "sanitizedHtmlBytes"),
        normalizedBytes: sum(labelled, "normalizedBytes"),
        renderedChars: sum(labelled, "renderedChars"),
        factsLabelled: sum(labelled, "facts"),
        factsKeptByContext: sum(labelled, "factsKept"),
        factsInInnerText: sum(labelled, "innerTextFacts")
      },
      promptChars: {
        old: promptRows.reduce((n, r) => n + Number(r.oldPromptChars ?? 0), 0),
        new: promptRows.reduce((n, r) => n + Number(r.newPromptChars ?? 0), 0),
        rows: promptRows.length
      },
      redactionEscapes: results.reduce((n, r) => n + Number(r.residualSecrets ?? 0), 0),
      engineRuns
    };
    console.log(`  (info) ${JSON.stringify(summary)}`);

    if (WRITE) {
      const pageSetHash = createHash("sha256").update(JSON.stringify(NORMALIZATION_PAGES)).digest("hex");
      writeFileSync(CASES_PATH, `${JSON.stringify({ generatedBy: "benchmark:dom-normalization", pageSetHash, contexts: Object.fromEntries(contexts) }, null, 2)}\n`);
      writeFileSync(
        RESULTS_PATH,
        `${JSON.stringify({ generatedBy: "benchmark:dom-normalization", generatedAt: new Date().toISOString(), host: { platform: process.platform, node: process.version }, pageSetHash, summary, pages: results, prompts: promptRows }, null, 2)}\n`
      );
      console.log(`  wrote ${CASES_PATH} and ${RESULTS_PATH}`);
    } else if (existsSync(CASES_PATH)) {
      const committed = JSON.parse(readFileSync(CASES_PATH, "utf8")) as { pageSetHash: string; contexts: Record<string, PageContext> };
      check("the committed labelled contexts were generated from these exact pages", committed.pageSetHash === createHash("sha256").update(JSON.stringify(NORMALIZATION_PAGES)).digest("hex"));
      const drift = [...contexts].filter(([key, context]) => JSON.stringify(committed.contexts[key]) !== JSON.stringify(context)).map(([key]) => key);
      check("the committed labelled contexts are what the path produces today", drift.length === 0, drift);
    }
  } finally {
    await browser?.close().catch(() => undefined);
    server.close();
    await provider.shutdown().catch(() => undefined);
    staged.cleanup();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
