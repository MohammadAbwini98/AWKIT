/**
 * L10.0 incremental-value benchmark: current AWKIT locator recovery vs parser-only Scrapling.
 *
 * Run with: npm run benchmark:dom-intelligence   (after npm run benchmark:dom-intelligence-setup)
 *
 * For every frozen fixture case (scripts/dom-intelligence/fixtures.mts):
 *   1. the REAL Recorder init script captures a click on the baseline page and buildRecordedFlow
 *      assembles the step and its PageBlueprint, exactly as production does;
 *   2. the production LocatorFactory resolves on the mutated page three ways:
 *        production         the recorded locators + remembered-winner local recovery + blueprint recovery
 *        localOnly          every recorded candidate forced to miss; local recovery only
 *        localAndBlueprint  every recorded candidate forced to miss; local then blueprint recovery
 *   3. parser-only Scrapling relocates the same element from the same page.content() HTML, and any
 *      unique Scrapling candidate is re-scored through AWKIT's own fingerprint against the unchanged
 *      0.86 threshold / 0.08 margin (decision DI5).
 * Plus cold/warm latency, DOM-size scaling, memory, payload sizes, dependency inventory and a
 * normalization comparison. Results go to docs/plans/ai-upgrade-v5/evidence/ and the gates are applied
 * by the pre-registered rule in scripts/dom-intelligence/gate.mts. Measurement only: nothing is clicked
 * after recording and no product code changes.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";
import { getRecorderInitScriptContent } from "@src/recorder/recorderInitScript";
import type { RecordedAction } from "@src/recorder/RecorderTypes";
import type { FlowStep, LocatorElementFingerprint } from "@src/profiles/FlowProfile";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import type { LocatorBlueprintStore, PageBlueprint } from "@src/runner/LocatorBlueprintStore";
import { FileLocatorRecoveryStore } from "@src/runner/LocatorRecoveryStore";
import { createPageFingerprint, hashFingerprint, similarity } from "@src/runner/locatorFingerprint";
import {
  DOM_CASES,
  NORMALIZATION_FORBIDDEN,
  NORMALIZATION_PAGE,
  NORMALIZATION_REQUIRED_FACTS,
  SCALE_SIZES,
  fixtureSetHash,
  sha256,
  type DomCase
} from "./dom-intelligence/fixtures.mts";
import {
  decideLocatorGate,
  decideNormalizationGate,
  percentile,
  tallyLocator,
  type CaseResult,
  type EngineOutcome,
  type NormalizationMethod,
  type ScraplingOutcome
} from "./dom-intelligence/gate.mts";

const PORT = 4431;
const BASE = `http://127.0.0.1:${PORT}`;
const VENV_PYTHON = resolve(".cache/l10-scrapling/venv/Scripts/python.exe");
const HOST_SCRIPT = resolve("scripts/dom-intelligence/scrapling_bench.py");
const INSTALL_RECORD = resolve(".cache/l10-scrapling/install-record.json");
const RESULTS = resolve("docs/plans/ai-upgrade-v5/evidence/L10.0-dom-intelligence-results.json");
const WARM_REPEAT = 20;
const COLD_STARTS = 5;
const ANCHOR = '[data-l10-anchor="target"]';
const FINGERPRINT_SOURCE = createPageFingerprint.toString();

function round(value: number | null | undefined, digits = 3): number | null {
  return value === null || value === undefined || Number.isNaN(value) ? null : Number(value.toFixed(digits));
}

function stats(samples: number[]) {
  return { n: samples.length, p50: round(percentile(samples, 50), 2), p95: round(percentile(samples, 95), 2), max: round(Math.max(...samples), 2) };
}

// ── Scrapling host (one long-lived process; sequential JSON lines) ──────────────────────────────
class Host {
  private lines: AsyncIterableIterator<string>;
  private constructor(private readonly child: ChildProcessWithoutNullStreams) {
    this.lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  }

  static async start(): Promise<{ host: Host; readyMs: number; ready: Record<string, unknown> }> {
    const started = performance.now();
    const child = spawn(VENV_PYTHON, ["-X", "utf8", HOST_SCRIPT], { stdio: ["pipe", "pipe", "pipe"] });
    child.stderr.on("data", (chunk) => process.stderr.write(`[host] ${chunk}`));
    const host = new Host(child);
    const ready = JSON.parse(await host.next()) as Record<string, unknown>;
    return { host, readyMs: performance.now() - started, ready };
  }

  private async next(): Promise<string> {
    const { value, done } = await this.lines.next();
    if (done) throw new Error("Scrapling host exited");
    return value;
  }

  async call<T>(op: string, payload: Record<string, unknown> = {}): Promise<{ result: T; requestBytes: number; responseBytes: number; ms: number }> {
    const request = JSON.stringify({ op, ...payload });
    const started = performance.now();
    this.child.stdin.write(`${request}\n`);
    const line = await this.next();
    const ms = performance.now() - started;
    const response = JSON.parse(line) as { ok: boolean; result: T; error?: string };
    if (!response.ok) throw new Error(`host ${op}: ${response.error}`);
    return { result: response.result, requestBytes: Buffer.byteLength(request), responseBytes: Buffer.byteLength(line), ms };
  }

  async stop(): Promise<void> {
    this.child.stdin.write(`${JSON.stringify({ op: "exit" })}\n`);
    await new Promise((done) => this.child.once("exit", done));
  }
}

// ── Fixture server: baseline and mutated share one URL path, so page identity (pageKey) is shared ──
function startServer(): Promise<Server> {
  const byId = new Map(DOM_CASES.map((c) => [c.id, c]));
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", BASE);
    const match = /^\/case\/([a-z0-9-]+)$/.exec(url.pathname);
    let body: string | undefined;
    if (match) {
      const fixture = byId.get(match[1]);
      body = fixture ? (url.searchParams.get("v") === "mutated" ? fixture.mutated : fixture.baseline) : undefined;
    } else if (url.pathname === "/normalize") {
      body = NORMALIZATION_PAGE;
    }
    if (body === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
  });
  return new Promise((done) => server.listen(PORT, "127.0.0.1", () => done(server)));
}

// ── AWKIT side ─────────────────────────────────────────────────────────────────────────────────
async function recordStep(browser: Browser, fixture: DomCase): Promise<{ step: FlowStep; blueprint: PageBlueprint | undefined }> {
  const context = await browser.newContext();
  const actions: RecordedAction[] = [];
  const actionType = fixture.action ?? "click";
  try {
    await context.addInitScript({ content: getRecorderInitScriptContent() });
    await context.exposeBinding("__awtkit_recordAction", (_source, action) => actions.push(action as RecordedAction));
    await context.exposeBinding("__awtkit_recordSignal", () => undefined);
    const page = await context.newPage();
    await page.goto(`${BASE}/case/${fixture.id}?v=baseline`);
    if (actionType === "fill") {
      await page.locator(fixture.targetSelector).fill("Leave at the door");
      await page.keyboard.press("Tab");
    } else {
      await page.locator(fixture.targetSelector).click();
    }
    for (let attempt = 0; attempt < 60 && !actions.some((a) => a.type === actionType); attempt += 1) {
      await page.waitForTimeout(50);
    }
    const blueprints: PageBlueprint[] = [];
    const flow = buildRecordedFlow(`L10.0 ${fixture.id}`, actions.filter((a) => a.type === actionType).slice(0, 1), blueprints);
    const step = flow.nodes.find((node) => node.type === actionType) as FlowStep | undefined;
    if (!step?.locator) throw new Error(`${fixture.id}: the recorder captured no ${actionType} step`);
    // Only click actions carry a blueprint capture; a fill step has no blueprint layer in production.
    return { step, blueprint: blueprints[0] };
  } finally {
    await context.close();
  }
}

function forcedStep(step: FlowStep): FlowStep {
  const clone = structuredClone(step);
  clone.id = `${step.id}-forced`;
  clone.locator = { ...clone.locator!, strategy: "css", value: ANCHOR, name: undefined, exact: undefined, alternatives: [], guard: undefined };
  return clone;
}

function describeLocator(step: FlowStep): string {
  const locator = step.locator!;
  const one = (c: { strategy: string; value: string; name?: string }) => `${c.strategy}=${c.value}${c.name ? ` [${c.name}]` : ""}`;
  const alternatives = (locator.alternatives ?? []).map(one);
  const extras = [locator.guard ? "guarded-positional" : "", locator.context?.container ? "container-scoped" : ""].filter(Boolean);
  return `${one(locator)}${alternatives.length ? ` | alternatives: ${alternatives.join(" ; ")}` : ""}${extras.length ? ` (${extras.join(", ")})` : ""}`;
}

async function outcome(run: () => Promise<Locator>, truth: string | null): Promise<EngineOutcome> {
  const started = performance.now();
  let locator: Locator;
  try {
    locator = await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: /match(?:es|ed)? \d+|ambiguous|multiple/i.test(message) ? "ambiguous" : "error", correct: null, ms: performance.now() - started, detail: message.split("\n")[0].slice(0, 200) };
  }
  const ms = performance.now() - started;
  const count = await locator.count().catch(() => 0);
  if (count !== 1) return { status: count === 0 ? "unresolved" : "ambiguous", correct: null, ms };
  const correct = truth ? await locator.evaluate((element, selector) => element === document.querySelector(selector), truth) : false;
  return { status: "resolved", correct, ms };
}

/** AWKIT identity score of `target` vs the remembered fingerprint, and the best score of every other visible element. */
async function awkitScores(page: Page, memory: LocatorElementFingerprint, target: Locator): Promise<{ score: number | null; bestOther: number | null }> {
  if ((await target.count()) !== 1) return { score: null, bestOther: null };
  const own = await LocatorFactory.fingerprintOne(target);
  const handle = await target.elementHandle();
  const rows = await page.locator("*:visible").evaluateAll(
    (elements, [source, candidate]) => {
      const fingerprint = new Function(`return (${source as string})`)();
      return elements.filter((element) => element !== candidate).map((element) => fingerprint(element));
    },
    [FINGERPRINT_SOURCE, handle] as const
  );
  const others = rows.map((raw) => similarity(memory, hashFingerprint(raw)));
  return { score: own ? similarity(memory, own) : null, bestOther: others.length ? Math.max(...others) : null };
}

interface CaseRun {
  result: CaseResult;
  warm: number[];
  payload: { baselineBytes: number; mutatedBytes: number; requestBytes: number; responseBytes: number };
  pathMappingAgrees: boolean | null;
  referenceFields: string[];
  referenceAttributeKeys: string[];
}

async function runCase(browser: Browser, host: Host, fixture: DomCase, recoveryRoot: string): Promise<CaseRun> {
  const { step, blueprint } = await recordStep(browser, fixture);
  const blueprintStore: LocatorBlueprintStore = {
    get: async (pageKey) => (blueprint && pageKey === blueprint.pageKey ? blueprint : undefined),
    put: async () => undefined,
    list: async () => (blueprint ? [blueprint] : [])
  };
  const recoveryStore = new FileLocatorRecoveryStore(join(recoveryRoot, fixture.id));
  const scope = (suffix: string) => ({ scenarioId: `l10-${fixture.id}-${suffix}`, flowId: "l10-bench" });
  const forced = forcedStep(step);

  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`${BASE}/case/${fixture.id}?v=baseline`);
    const baselineHtml = await page.content();
    const memory = await LocatorFactory.fingerprintOne(page.locator(fixture.targetSelector));
    if (!memory) throw new Error(`${fixture.id}: baseline target could not be fingerprinted`);

    // Seed winner memory exactly as a first successful run would (the recorded step, then the forced step).
    const seeded = await new LocatorFactory(page, { recoveryStore, scope: scope("production"), recoveryGraceMs: 0 }).resolve(step);
    const seededRight = (await seeded.count()) === 1 && (await seeded.evaluate((el, s) => el === document.querySelector(s), fixture.targetSelector));
    if (!seededRight) throw new Error(`${fixture.id}: the recorded step does not resolve to the target on the baseline`);
    await page.locator(fixture.targetSelector).evaluate((element) => element.setAttribute("data-l10-anchor", "target"));
    for (const suffix of ["local", "blueprint"]) {
      const forcedSeed = await new LocatorFactory(page, { recoveryStore, scope: scope(suffix), recoveryGraceMs: 0 }).resolve(forced);
      if ((await forcedSeed.count()) !== 1) throw new Error(`${fixture.id}: forced step did not seed on the baseline`);
    }

    await page.goto(`${BASE}/case/${fixture.id}?v=mutated`);
    const mutatedHtml = await page.content();
    const truth = fixture.truthSelector;
    const production = await outcome(
      () => new LocatorFactory(page, { recoveryStore, blueprintStore, scope: scope("production"), recoveryGraceMs: 0 }).resolve(step),
      truth
    );
    const localOnly = await outcome(
      () => new LocatorFactory(page, { recoveryStore, scope: scope("local"), recoveryGraceMs: 0 }).resolve(forced),
      truth
    );
    const localAndBlueprint = await outcome(
      () => new LocatorFactory(page, { recoveryStore, blueprintStore, scope: scope("blueprint"), recoveryGraceMs: 0 }).resolve(forced),
      truth
    );
    const truthScores = truth ? await awkitScores(page, memory, page.locator(truth)) : { score: null, bestOther: null };

    const relocate = await host.call<{
      candidates: string[];
      topScore: number | null;
      runnerUpScore: number | null;
      truthRank: number | null;
      truthScore: number | null;
      correct: boolean | null;
      parseMs: number;
      relocateMs: number;
      referenceFields: string[];
      referenceAttributeKeys: string[];
    }>("relocate", { baselineHtml, targetSelector: fixture.targetSelector, mutatedHtml, truthSelector: truth });
    const r = relocate.result;
    let candidateScores = { score: null as number | null, bestOther: null as number | null };
    let pathMappingAgrees: boolean | null = null;
    if (r.candidates.length === 1) {
      const candidate = page.locator(`xpath=${r.candidates[0]}`);
      candidateScores = await awkitScores(page, memory, candidate);
      if ((await candidate.count()) === 1) {
        const browserSaysTruth = truth ? await candidate.evaluate((el, s) => el === document.querySelector(s), truth) : false;
        pathMappingAgrees = browserSaysTruth === (r.correct === true);
      } else {
        pathMappingAgrees = false;
      }
    }
    const scrapling: ScraplingOutcome = {
      candidateCount: r.candidates.length,
      topScore: round(r.topScore, 2),
      runnerUpScore: round(r.runnerUpScore, 2),
      correct: r.correct,
      truthRank: r.truthRank,
      truthScore: round(r.truthScore, 2),
      awkitScore: round(candidateScores.score, 4),
      awkitBestOther: round(candidateScores.bestOther, 4),
      relocateMs: round(r.relocateMs, 2) ?? 0,
      parseMs: round(r.parseMs, 2) ?? 0
    };
    const warm = (await host.call<{ samples: number[] }>("timing", { baselineHtml, targetSelector: fixture.targetSelector, mutatedHtml, repeat: WARM_REPEAT })).result.samples;

    const trim = (o: EngineOutcome): EngineOutcome => ({ ...o, ms: round(o.ms, 1) ?? 0 });
    return {
      result: {
        id: fixture.id,
        expectation: fixture.expectation,
        recordedLocator: describeLocator(step),
        production: trim(production),
        localOnly: trim(localOnly),
        localAndBlueprint: trim(localAndBlueprint),
        scrapling,
        truthAwkitScore: round(truthScores.score, 4),
        truthAwkitBestOther: round(truthScores.bestOther, 4)
      },
      warm,
      payload: {
        baselineBytes: Buffer.byteLength(baselineHtml),
        mutatedBytes: Buffer.byteLength(mutatedHtml),
        requestBytes: relocate.requestBytes,
        responseBytes: relocate.responseBytes
      },
      pathMappingAgrees,
      referenceFields: r.referenceFields,
      referenceAttributeKeys: r.referenceAttributeKeys
    };
  } finally {
    await context.close();
  }
}

// ── Normalization comparison ───────────────────────────────────────────────────────────────────
async function runNormalization(browser: Browser, host: Host) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`${BASE}/normalize`);
    const html = await page.content();
    const judge = (method: string, newRuntime: boolean, output: string, ms: number): NormalizationMethod => ({
      method,
      newRuntime,
      leaked: NORMALIZATION_FORBIDDEN.filter((canary) => output.includes(canary)),
      missingFacts: NORMALIZATION_REQUIRED_FACTS.filter((fact) => !output.includes(fact)),
      outputChars: output.length,
      ms: round(ms, 2) ?? 0
    });
    const scrapling = (await host.call<{ text: string; ms: number }>("normalize", { html })).result;
    let started = performance.now();
    const innerText = await page.evaluate(() => document.body.innerText);
    const innerTextMs = performance.now() - started;
    started = performance.now();
    const aria = await page.locator("body").ariaSnapshot();
    const ariaMs = performance.now() - started;
    const methods = [
      judge("scrapling-static-text", true, scrapling.text, scrapling.ms),
      judge("browser-innerText", false, innerText, innerTextMs),
      judge("playwright-aria-snapshot", false, aria, ariaMs)
    ];
    return {
      rawHtmlBytes: Buffer.byteLength(html),
      rawHtmlLeaks: NORMALIZATION_FORBIDDEN.filter((canary) => html.includes(canary)),
      methods,
      outputs: { scrapling: scrapling.text, innerText, aria }
    };
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  if (!existsSync(VENV_PYTHON)) {
    console.error("BLOCKED: parser-only Scrapling venv missing. Run: npm run benchmark:dom-intelligence-setup");
    process.exit(2);
  }
  const install = existsSync(INSTALL_RECORD) ? JSON.parse(readFileSync(INSTALL_RECORD, "utf8")) : null;
  const recoveryRoot = await mkdtemp(join(tmpdir(), "awkit-l10-"));
  const server = await startServer();
  const browser = await chromium.launch();

  try {
    console.log("Cold starts (spawn → ready):");
    const coldStarts: number[] = [];
    const importMs: number[] = [];
    for (let index = 0; index < COLD_STARTS; index += 1) {
      const { host, readyMs, ready } = await Host.start();
      coldStarts.push(readyMs);
      importMs.push(ready.importMs as number);
      await host.stop();
    }
    console.log(`  ${coldStarts.map((ms) => ms.toFixed(0)).join(", ")} ms`);

    const { host, ready } = await Host.start();
    const memoryAfterReady = ready.memory;
    const forbiddenAtReady = ready.forbiddenModulesLoaded as string[];
    const firstCall = await host.call("relocate", {
      baselineHtml: DOM_CASES[0].baseline,
      targetSelector: DOM_CASES[0].targetSelector,
      mutatedHtml: DOM_CASES[0].mutated,
      truthSelector: DOM_CASES[0].truthSelector
    });

    console.log("Cases:");
    const runs: CaseRun[] = [];
    for (const fixture of DOM_CASES) {
      const run = await runCase(browser, host, fixture, recoveryRoot);
      runs.push(run);
      const r = run.result;
      const label = (o: EngineOutcome) => (o.status === "resolved" ? (o.correct ? "correct" : "WRONG") : o.status);
      const s = r.scrapling;
      const scr = s.candidateCount === 0 ? "none" : s.candidateCount > 1 ? `tie×${s.candidateCount}` : s.correct ? "correct" : "WRONG";
      console.log(
        `  ${r.id.padEnd(34)} prod=${label(r.production).padEnd(10)} local=${label(r.localOnly).padEnd(10)} +bp=${label(r.localAndBlueprint).padEnd(10)} ` +
          `scrapling=${scr.padEnd(8)} top=${s.topScore} awkit(cand)=${s.awkitScore} other=${s.awkitBestOther} truth(awkit)=${r.truthAwkitScore}`
      );
    }

    const scaleResult = (await host.call<{ series: Array<{ requestedElements: number; elements: number; htmlBytes: number; samples: number[]; found: number }> }>("scale", { sizes: SCALE_SIZES, repeat: 5 })).result;
    const normalization = await runNormalization(browser, host);
    const inventory = (await host.call<Record<string, unknown>>("inventory")).result;
    const memoryAtEnd = (await host.call<Record<string, number>>("memory")).result;
    await host.stop();

    const results = runs.map((run) => run.result);
    const allWarm = runs.flatMap((run) => run.warm);
    const tally = tallyLocator(results);
    const warmStats = stats(allWarm);
    const locatorGate = decideLocatorGate(tally, warmStats.p95 ?? Number.POSITIVE_INFINITY);
    const normalizationGate = decideNormalizationGate(normalization.methods);

    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      fixtureSetHash: fixtureSetHash(),
      casePageHashes: DOM_CASES.map((c) => ({ id: c.id, baseline: sha256(c.baseline), mutated: sha256(c.mutated) })),
      normalizationPageHash: sha256(NORMALIZATION_PAGE),
      environment: { node: process.version, platform: `${process.platform}-${process.arch}`, playwright: "1.61.0", python: ready.python },
      install: install && { pins: install.pins, pipFreeze: install.pipFreeze, pipCheck: install.pipCheck, wheels: install.wheels, totalWheelBytes: install.totalWheelBytes },
      inventory,
      forbiddenModulesLoadedAtReady: forbiddenAtReady,
      coldStartMs: { samples: coldStarts.map((ms) => round(ms, 1)), ...stats(coldStarts) },
      importMs: stats(importMs),
      firstCallMs: round(firstCall.ms, 2),
      memory: { afterReady: memoryAfterReady, atEnd: memoryAtEnd },
      cases: results,
      pathMappingAgreesWithBrowser: runs.map((run) => ({ id: run.result.id, agrees: run.pathMappingAgrees })),
      scraplingReferenceRecord: { fields: runs[0]?.referenceFields, attributeKeysExample: runs[0]?.referenceAttributeKeys },
      warmRelocateMs: { all: warmStats, perCase: Object.fromEntries(runs.map((run) => [run.result.id, stats(run.warm)])) },
      awkitResolveMs: {
        production: stats(results.map((r) => r.production.ms)),
        localAndBlueprint: stats(results.map((r) => r.localAndBlueprint.ms))
      },
      payloadBytes: Object.fromEntries(runs.map((run) => [run.result.id, run.payload])),
      scale: scaleResult.series.map((point) => ({ requestedElements: point.requestedElements, elements: point.elements, htmlBytes: point.htmlBytes, found: point.found, ...stats(point.samples) })),
      normalization: { rawHtmlBytes: normalization.rawHtmlBytes, rawHtmlLeaks: normalization.rawHtmlLeaks, methods: normalization.methods, outputs: normalization.outputs },
      tally,
      // Informational, NOT part of the pre-registered rule: would AWKIT's own fingerprint scorer have
      // recovered the truth element had its scan covered the whole visible page (no 200-element cap,
      // no ±24 blueprint window, no document-fingerprint gate)? Separates algorithm from coverage.
      analysis: {
        recordedLocators: runs.map((run) => ({ id: run.result.id, recordedLocator: run.result.recordedLocator })),
        uncappedAwkitScorerWouldRecover: results
          .filter((r) => r.expectation === "recoverable")
          .map((r) => ({
            id: r.id,
            wouldRecover:
              r.truthAwkitScore !== null &&
              r.truthAwkitScore >= 0.86 &&
              (r.truthAwkitBestOther === null || r.truthAwkitScore - r.truthAwkitBestOther >= 0.08)
          })),
        incrementalGatedAlsoRecoverableByUncappedAwkit: tally.incrementalGated.filter((id) => {
          const r = results.find((item) => item.id === id);
          return !!r && r.truthAwkitScore !== null && r.truthAwkitScore >= 0.86 && (r.truthAwkitBestOther === null || r.truthAwkitScore - r.truthAwkitBestOther >= 0.08);
        })
      },
      gates: { locator: locatorGate, normalization: normalizationGate }
    };
    await writeFile(RESULTS, `${JSON.stringify(report, null, 2)}\n`);

    console.log(`\nWarm relocate: p50 ${warmStats.p50} ms, p95 ${warmStats.p95} ms, max ${warmStats.max} ms (n=${warmStats.n})`);
    console.log(`Scale: ${report.scale.map((p) => `${p.elements} el → p50 ${p.p50} ms`).join("; ")}`);
    console.log(`Memory: ${JSON.stringify(report.memory)}`);
    console.log(`Normalization: ${normalization.methods.map((m) => `${m.method} leaks=[${m.leaked.join(",")}] missing=[${m.missingFacts.join(",")}] chars=${m.outputChars}`).join(" | ")}`);
    console.log(`Tally: ${JSON.stringify(tally)}`);
    console.log(`LOCATOR GATE: ${locatorGate.decision}${locatorGate.reasons.length ? ` — ${locatorGate.reasons.join("; ")}` : ""}`);
    console.log(`NORMALIZATION GATE: ${normalizationGate.decision}${normalizationGate.reasons.length ? ` — ${normalizationGate.reasons.join("; ")}` : ""}`);
    console.log(`Results written to ${RESULTS}`);
  } finally {
    await browser.close().catch(() => undefined);
    server.close();
    await rm(recoveryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
