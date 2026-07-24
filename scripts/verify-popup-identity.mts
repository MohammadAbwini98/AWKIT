#!/usr/bin/env tsx
/**
 * verify-popup-identity.mts — Deterministic page identity (SRS-BAO-001 FR-C1, Tranche 2A)
 *
 * What regression makes this fail? Any return of defect `awkit-ebh` — a second registration path,
 * a positional/arrival-order alias, a Page reachable under two aliases, an alias surviving its
 * page's close, a legacy `popup-N` alias that stops resolving, or a URL query string / fragment
 * leaking into a popup alias.
 *
 * `verify:popup` covers the popup STEP behaviors (click/switch/close/back-compat). This verifier is
 * separate because it targets the identity INVARIANTS underneath them, which need reversed-order and
 * script-opened fixtures plus direct registry assertions — folding them in would have made
 * `verify:popup` cover two unrelated concerns at once.
 *
 * Runs a real Chromium context against the mock site's identity scenarios (no Electron).
 *
 * Usage: npm run verify:popup-identity
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { LocatorFactory } from "../src/runner/LocatorFactory.js";
import { StepExecutor } from "../src/runner/StepExecutor.js";
import { ValueResolver } from "../src/runner/ValueResolver.js";
import {
  derivePopupAlias,
  MAIN_PAGE_ALIAS,
  PopupIdentityRegistry
} from "../src/runner/runtime/PopupIdentityRegistry.js";
import type { FlowStep } from "../src/profiles/FlowProfile.js";

const PORT = 14341;
const BASE = `http://localhost:${PORT}`;

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓  ${name}`);
  } catch (error) {
    failed++;
    console.log(`  ✗  ${name}`);
    console.log(`     ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function makeContext(): Parameters<typeof StepExecutor>[3] {
  return {
    executionId: "identity-exec",
    instanceId: "identity-inst",
    scenarioId: "popup-identity",
    flowId: "popup-identity-flow",
    paths: {
      screenshots: "/tmp/popup-identity/screenshots",
      downloads: "/tmp/popup-identity/downloads",
      sessions: "/tmp/popup-identity/sessions"
    },
    workflowDataSource: null,
    instanceVariables: {}
  } as Parameters<typeof StepExecutor>[3];
}

function makeStep(partial: Partial<FlowStep> & { type: FlowStep["type"] }): FlowStep {
  return { id: `step-${Math.random().toString(36).slice(2)}`, name: partial.type, ...partial };
}

// ── Mock server (serves the popup lab straight from mock-site/public) ─────────
const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "../mock-site/public");
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

async function startServer(port: number): Promise<() => void> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    let file = "";
    if (url.pathname.startsWith("/popup")) {
      let suffix = url.pathname.slice("/popup".length);
      if (!suffix || suffix === "/") suffix = "/index.html";
      if (!suffix.endsWith(".html") && !suffix.includes(".")) suffix += ".html";
      file = `popup${suffix}`;
    } else if (url.pathname === "/styles.css") {
      file = "styles.css";
    }
    if (!file) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    try {
      const body = await readFile(join(publicDir, file));
      res.writeHead(200, { "Content-Type": mime[extname(file)] ?? "text/html" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise<void>((resolve) => server.listen(port, resolve));
  return () => server.close();
}

/** Wire an executor to the context exactly as PlaywrightRunner does: observation only. */
function wire(ctx: BrowserContext, executor: StepExecutor): void {
  ctx.on("page", (newPage) => executor.observePopupPage(newPage));
}

/** Every alias currently mapping to a live page, for invariant assertions. */
function aliasesFor(registry: PopupIdentityRegistry, page: Page): string[] {
  return registry.aliases().filter((alias) => {
    try {
      return registry.tryResolve(alias) === page;
    } catch {
      return false; // ambiguous aliases resolve to nothing
    }
  });
}

async function main(): Promise<void> {
  console.log("\n▶  verify:popup-identity — FR-C1 deterministic page identity\n");
  const stop = await startServer(PORT);
  const browser = await chromium.launch({ headless: true });

  try {
    // ─── Suite 1: pure derivation (no browser needed) ─────────────────────────
    console.log("Suite 1: Deterministic alias derivation");

    await test("Alias is stable for the same origin + path", () => {
      const a = derivePopupAlias("main", new URL(`${BASE}/popup/reversed-popup-alpha.html`));
      const b = derivePopupAlias("main", new URL(`${BASE}/popup/reversed-popup-alpha.html`));
      assert(a === b, `same identity must derive the same alias: ${a} vs ${b}`);
    });

    await test("Different paths derive different aliases", () => {
      const alpha = derivePopupAlias("main", new URL(`${BASE}/popup/reversed-popup-alpha.html`));
      const beta = derivePopupAlias("main", new URL(`${BASE}/popup/reversed-popup-beta.html`));
      assert(alpha !== beta, "distinguishable popups must not collide");
    });

    await test("Query string and fragment NEVER affect the alias", () => {
      const clean = derivePopupAlias("main", new URL(`${BASE}/popup/script-timer-popup.html`));
      const dirty = derivePopupAlias(
        "main",
        new URL(`${BASE}/popup/script-timer-popup.html?token=NOT_A_REAL_TOKEN_abc123&session=sess-987#section-2`)
      );
      assert(clean === dirty, "query/fragment must not be identity-bearing");
    });

    await test("No secret material can appear in a derived alias", () => {
      const alias = derivePopupAlias(
        "main",
        new URL(`${BASE}/popup/script-timer-popup.html?token=NOT_A_REAL_TOKEN_abc123&session=sess-987#section-2`)
      );
      assert(!alias.includes("NOT_A_REAL_TOKEN"), `alias leaked a token: ${alias}`);
      assert(!alias.includes("sess-987"), `alias leaked a session id: ${alias}`);
      assert(!alias.includes("?") && !alias.includes("#"), `alias carried URL punctuation: ${alias}`);
    });

    await test("Alias is not a positional counter", () => {
      const alias = derivePopupAlias("main", new URL(`${BASE}/popup/reversed-popup-alpha.html`));
      assert(!/^popup-\d+$/.test(alias), `alias must not be arrival-order shaped: ${alias}`);
      assert(alias.startsWith("popup-main-"), `expected opener-scoped shape, got: ${alias}`);
    });

    // ─── Suite 2: reversed opening order (C1.5) ───────────────────────────────
    console.log("\nSuite 2: Reversed opening order (C1.5)");

    /** Open both popups in the given order and return alias → marker path. */
    async function runOrder(order: "alpha-first" | "beta-first"): Promise<Map<string, string>> {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const executor = new StepExecutor(page, new LocatorFactory(page), new ValueResolver(makeContext()), makeContext());
      wire(ctx, executor);
      await page.goto(`${BASE}/popup/reversed-order.html`);
      const button = order === "alpha-first" ? "open-alpha-first-button" : "open-beta-first-button";
      await page.click(`[data-testid=${button}]`);
      await page.waitForTimeout(1200); // bounded: both opens + the 250 ms scripted gap
      await executor.pageIdentity.settle();

      const result = new Map<string, string>();
      for (const alias of executor.pageIdentity.aliases()) {
        if (alias === MAIN_PAGE_ALIAS) continue;
        const popup = executor.pageIdentity.tryResolve(alias);
        if (!popup) continue;
        result.set(alias, new URL(popup.url()).pathname);
      }
      await ctx.close();
      return result;
    }

    const alphaFirst = await runOrder("alpha-first");
    const betaFirst = await runOrder("beta-first");

    await test("Both popups are registered in each order", () => {
      assert(alphaFirst.size === 2, `alpha-first: expected 2 popups, got ${alphaFirst.size}`);
      assert(betaFirst.size === 2, `beta-first: expected 2 popups, got ${betaFirst.size}`);
    });

    await test("Reversed order produces IDENTICAL aliases (the defect's core symptom)", () => {
      const a = [...alphaFirst.keys()].sort().join(",");
      const b = [...betaFirst.keys()].sort().join(",");
      assert(a === b, `aliases differed between orders:\n  alpha-first: ${a}\n  beta-first:  ${b}`);
    });

    await test("Each alias maps to the SAME popup page in both orders", () => {
      for (const [alias, path] of alphaFirst) {
        const other = betaFirst.get(alias);
        assert(other === path, `alias ${alias} pointed at ${path} then ${other} — identity followed arrival order`);
      }
    });

    await test("No alias is a positional popup-N key", () => {
      for (const alias of [...alphaFirst.keys(), ...betaFirst.keys()]) {
        assert(!/^popup-\d+$/.test(alias), `positional alias survived: ${alias}`);
      }
    });

    // ─── Suite 3: script/timer popup (C1.3) ───────────────────────────────────
    console.log("\nSuite 3: Script/timer popup identity (C1.3)");

    /** Arm the timer popup and return its alias. */
    async function runTimer(): Promise<{ alias: string; registry: PopupIdentityRegistry; ctx: BrowserContext }> {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const executor = new StepExecutor(page, new LocatorFactory(page), new ValueResolver(makeContext()), makeContext());
      wire(ctx, executor);
      await page.goto(`${BASE}/popup/script-timer.html`);
      await page.click("[data-testid=arm-timer-button]");
      await page.waitForTimeout(900); // bounded: the scenario's 400 ms timer plus load
      await executor.pageIdentity.settle();
      const aliases = executor.pageIdentity.aliases().filter((a) => a !== MAIN_PAGE_ALIAS);
      return { alias: aliases[0] ?? "", registry: executor.pageIdentity, ctx };
    }

    const timerRun1 = await runTimer();
    const timerRun2 = await runTimer();

    await test("A popup with no click step still receives one alias", () => {
      assert(timerRun1.alias.length > 0, "timer-opened popup got no alias");
      const all = timerRun1.registry.aliases().filter((a) => a !== MAIN_PAGE_ALIAS);
      assert(all.length === 1, `expected exactly 1 popup alias, got ${all.length}: [${all.join(", ")}]`);
    });

    await test("The synthetic alias is stable across separate runs", () => {
      assert(
        timerRun1.alias === timerRun2.alias,
        `alias changed between runs: ${timerRun1.alias} vs ${timerRun2.alias}`
      );
    });

    await test("The live alias carries no token or session value from the popup URL", () => {
      assert(!timerRun1.alias.includes("NOT_A_REAL_TOKEN"), `alias leaked a token: ${timerRun1.alias}`);
      assert(!timerRun1.alias.includes("sess-987"), `alias leaked a session id: ${timerRun1.alias}`);
    });

    await test("One Page is registered under exactly one alias (C1.4)", () => {
      const popup = timerRun1.registry.tryResolve(timerRun1.alias);
      assert(popup, "timer popup should resolve");
      assert(
        aliasesFor(timerRun1.registry, popup).length === 1,
        "a single Page was reachable under more than one alias"
      );
    });

    await test("Registry values are distinct — no two aliases share a Page (C1.4)", () => {
      const seen = new Set<Page>();
      for (const alias of timerRun1.registry.aliases()) {
        const page = timerRun1.registry.tryResolve(alias);
        if (!page) continue;
        assert(!seen.has(page), `two aliases resolve to the same Page (alias ${alias})`);
        seen.add(page);
      }
    });

    await timerRun1.ctx.close();
    await timerRun2.ctx.close();

    // ─── Suite 4: ambiguous identity ──────────────────────────────────────────
    console.log("\nSuite 4: Ambiguous identity fails explicitly");

    const ambCtx = await browser.newContext();
    const ambPage = await ambCtx.newPage();
    const ambExecutor = new StepExecutor(ambPage, new LocatorFactory(ambPage), new ValueResolver(makeContext()), makeContext());
    wire(ambCtx, ambExecutor);
    await ambPage.goto(`${BASE}/popup/script-timer.html`);
    await ambPage.click("[data-testid=open-ambiguous-button]");
    await ambPage.waitForTimeout(900);
    await ambExecutor.pageIdentity.settle();

    await test("Two identical popups do NOT silently get order-based aliases", () => {
      const popupAliases = ambExecutor.pageIdentity.aliases().filter((a) => a !== MAIN_PAGE_ALIAS);
      assert(
        popupAliases.length === 1,
        `expected one contested alias, got ${popupAliases.length}: [${popupAliases.join(", ")}]`
      );
      for (const alias of popupAliases) {
        assert(!/^popup-\d+$/.test(alias), `fell back to a positional alias: ${alias}`);
      }
    });

    await test("Resolving an ambiguous alias throws an explicit diagnostic", () => {
      const alias = ambExecutor.pageIdentity.aliases().find((a) => a !== MAIN_PAGE_ALIAS);
      assert(alias, "expected a contested alias");
      let message = "";
      try {
        ambExecutor.pageIdentity.tryResolve(alias);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      assert(message.includes("ambiguous"), `expected an ambiguity diagnostic, got: ${message || "(no throw)"}`);
      assert(!message.includes("NOT_A_REAL_TOKEN"), "ambiguity diagnostic leaked a token");
    });

    await test("A step targeting an ambiguous alias fails rather than acting on a guess", async () => {
      const alias = ambExecutor.pageIdentity.aliases().find((a) => a !== MAIN_PAGE_ALIAS);
      const step = makeStep({
        type: "click",
        pageAlias: alias,
        locator: { strategy: "testId", value: "timer-action-button" }
      });
      const result = await ambExecutor.execute(step);
      assert(result.status === "failed", `expected failure on ambiguous alias, got ${result.status}`);
    });

    await ambCtx.close();

    // ─── Suite 5: lifecycle, claims, and legacy aliases ───────────────────────
    console.log("\nSuite 5: Lifecycle, recorded-alias precedence, legacy compatibility");

    const lifeCtx = await browser.newContext();
    const lifeMain = await lifeCtx.newPage();
    await lifeMain.goto(`${BASE}/popup/reversed-order.html`);
    const lifeExecutor = new StepExecutor(lifeMain, new LocatorFactory(lifeMain), new ValueResolver(makeContext()), makeContext());
    wire(lifeCtx, lifeExecutor);
    const registry = lifeExecutor.pageIdentity;

    await test("Legacy popup-1 alias still resolves after being claimed (C1.7)", async () => {
      const popup = await lifeCtx.newPage();
      await popup.goto(`${BASE}/popup/reversed-popup-alpha.html`);
      registry.observe(popup, { openerAlias: MAIN_PAGE_ALIAS });
      registry.claim(popup, "popup-1");
      assert(registry.tryResolve("popup-1") === popup, "legacy alias must resolve");
      assert(registry.aliasFor(popup) === "popup-1", "reverse lookup must agree");
    });

    await test("Claiming removes the synthetic alias — never both (C1.2)", () => {
      const popup = registry.tryResolve("popup-1");
      assert(popup, "popup-1 should resolve");
      const held = aliasesFor(registry, popup);
      assert(held.length === 1 && held[0] === "popup-1", `expected only popup-1, got [${held.join(", ")}]`);
      const synthetic = derivePopupAlias(MAIN_PAGE_ALIAS, new URL(`${BASE}/popup/reversed-popup-alpha.html`));
      assert(!registry.aliases().includes(synthetic), `synthetic key ${synthetic} survived the claim`);
    });

    await test("Closing a popup removes BOTH mappings (C1.6)", async () => {
      const popup = registry.tryResolve("popup-1");
      assert(popup, "popup-1 should resolve");
      await popup.close();
      await lifeMain.waitForTimeout(200);
      assert(registry.tryResolve("popup-1") === undefined, "alias survived its page's close");
      assert(registry.aliasFor(popup) === undefined, "reverse mapping survived close");
    });

    await test("A reopened popup may reuse the recorded alias (C1.6/C1.7)", async () => {
      const replacement = await lifeCtx.newPage();
      await replacement.goto(`${BASE}/popup/reversed-popup-alpha.html`);
      registry.observe(replacement, { openerAlias: MAIN_PAGE_ALIAS });
      registry.claim(replacement, "popup-1");
      assert(registry.tryResolve("popup-1") === replacement, "reopened popup could not reclaim its alias");
    });

    await test("A second live page cannot steal a held alias (invariant 8)", async () => {
      const intruder = await lifeCtx.newPage();
      await intruder.goto(`${BASE}/popup/reversed-popup-beta.html`);
      registry.observe(intruder, { openerAlias: MAIN_PAGE_ALIAS });
      let threw = "";
      try {
        registry.claim(intruder, "popup-1");
      } catch (error) {
        threw = error instanceof Error ? error.message : String(error);
      }
      assert(threw.includes("already held"), `expected a duplicate-claim diagnostic, got: ${threw || "(no throw)"}`);
      await intruder.close();
    });

    await test("The reserved 'main' alias cannot be claimed by a popup (invariant 1)", async () => {
      const popup = await lifeCtx.newPage();
      await popup.goto(`${BASE}/popup/reversed-popup-beta.html`);
      registry.observe(popup, { openerAlias: MAIN_PAGE_ALIAS });
      let threw = "";
      try {
        registry.claim(popup, MAIN_PAGE_ALIAS);
      } catch (error) {
        threw = error instanceof Error ? error.message : String(error);
      }
      assert(threw.includes("reserved"), `expected a reserved-alias diagnostic, got: ${threw || "(no throw)"}`);
      assert(registry.tryResolve(MAIN_PAGE_ALIAS) === lifeMain, "main must still resolve to the main page");
      await popup.close();
    });

    await test("A runner-owned branch page never consumes a popup alias", async () => {
      const branch = await lifeCtx.newPage();
      await branch.goto(`${BASE}/popup/reversed-popup-beta.html`);
      lifeExecutor.observePopupPage(branch);
      lifeExecutor.markInternalPage(branch);
      assert(registry.aliasFor(branch) === undefined, "a branch page was left holding a popup alias");
      await branch.close();
    });

    await test("An uncommitted about:blank page gets no guessed alias", async () => {
      const blank = await lifeCtx.newPage();
      const before = registry.aliases().length;
      registry.observe(blank, { openerAlias: MAIN_PAGE_ALIAS });
      assert(registry.aliasFor(blank) === undefined, "an uncommitted page must not be given an alias");
      assert(registry.aliases().length === before, "an uncommitted page must not add a registry key");
      await blank.close();
    });

    await lifeCtx.close();
  } finally {
    await browser.close();
    stop();
  }

  console.log(`\n${"─".repeat(50)}`);
  console.log(`  Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
  console.log("─".repeat(50));
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("verify:popup-identity crashed:", err);
  process.exit(1);
});
