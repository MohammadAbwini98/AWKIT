#!/usr/bin/env tsx
/**
 * verify-popup-identity.mts — Deterministic page identity (SRS-BAO-001 FR-C1, Tranche 2A)
 *
 * What regression makes this fail? Any return of defect `awkit-ebh` — a second registration path or
 * a second identity owner, a positional/arrival-order alias, a Page reachable under two aliases, an
 * alias surviving its page's close, latched ambiguity after a popup leaves, a legacy `popup-N` alias
 * that stops resolving, a runner-owned branch page consuming a popup alias, caller-controlled text
 * (opener alias, token, password) surfacing in an alias or an unmasked diagnostic, or listener growth
 * across popup lifecycles.
 *
 * `verify:popup` covers the popup STEP behaviors (click/switch/close/back-compat). This verifier is
 * separate because it targets the identity INVARIANTS underneath them, which need reversed-order,
 * script-opened, nested-flow, and hostile-alias fixtures plus direct registry assertions.
 *
 * Runs a real Chromium context against the mock site's identity scenarios (no Electron).
 *
 * Usage: npm run verify:popup-identity
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { LocatorFactory } from "../src/runner/LocatorFactory.js";
import { StepExecutor } from "../src/runner/StepExecutor.js";
import { ValueResolver } from "../src/runner/ValueResolver.js";
import { registerSecretValues } from "../src/reports/SecretMasker.js";
import {
  derivePopupAlias,
  MAIN_PAGE_ALIAS,
  PopupIdentityRegistry
} from "../src/runner/runtime/PopupIdentityRegistry.js";
import type { FlowStep } from "../src/profiles/FlowProfile.js";

const PORT = 14341;
const BASE = `http://localhost:${PORT}`;
const ALPHA = `${BASE}/popup/reversed-popup-alpha.html`;
const BETA = `${BASE}/popup/reversed-popup-beta.html`;

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

function makeContext(): ConstructorParameters<typeof StepExecutor>[3] {
  // Every required field is supplied rather than cast away: the previous `Parameters<typeof
  // StepExecutor>` (a CLASS — its call signature is not its constructor signature) resolved to a
  // type that accepted this object silently, hiding the five missing fields below.
  return {
    executionId: "identity-exec",
    instanceId: "identity-inst",
    scenarioId: "popup-identity",
    flowId: "popup-identity-flow",
    instanceOrderNumber: 1,
    totalInstances: 1,
    runtimeInputs: {},
    instanceInputs: {},
    flowOutputs: {},
    paths: {
      screenshots: "/tmp/popup-identity/screenshots",
      downloads: "/tmp/popup-identity/downloads",
      sessions: "/tmp/popup-identity/sessions",
      logs: "/tmp/popup-identity/logs",
      reports: "/tmp/popup-identity/reports"
    }
  };
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

/**
 * Build the EXACT topology PlaywrightRunner uses: one registry and one `"page"` observer per
 * BrowserContext, shared by every executor (parent flow, child flows, parallel branches).
 */
async function makeRunnerTopology(browser: Browser): Promise<{
  ctx: BrowserContext;
  mainPage: Page;
  registry: PopupIdentityRegistry;
  parent: StepExecutor;
  /** A nested `Run Another Flow` executor — shares the context-wide registry. */
  newChildExecutor: () => StepExecutor;
  /** An isolated parallel-branch executor — its page is runner-owned, never popup-aliased. */
  newBranchExecutor: () => Promise<{ executor: StepExecutor; page: Page }>;
}> {
  const ctx = await browser.newContext();
  const mainPage = await ctx.newPage();
  const registry = new PopupIdentityRegistry(mainPage);
  ctx.on("page", (p) => registry.observe(p));

  const build = (page: Page): StepExecutor =>
    new StepExecutor(
      page,
      new LocatorFactory(page),
      new ValueResolver(makeContext()),
      makeContext(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      registry
    );

  return {
    ctx,
    mainPage,
    registry,
    parent: build(mainPage),
    newChildExecutor: () => build(mainPage),
    newBranchExecutor: async () => {
      // Production ordering: the "page" event fires on about:blank and schedules finalization,
      // newPage() then resolves, and only then is the page marked internal — before it navigates.
      const page = await ctx.newPage();
      registry.markInternal(page);
      return { executor: build(page), page };
    }
  };
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
      assert(derivePopupAlias(new URL(ALPHA)) === derivePopupAlias(new URL(ALPHA)), "same identity must derive the same alias");
    });

    await test("Different paths derive different aliases", () => {
      assert(derivePopupAlias(new URL(ALPHA)) !== derivePopupAlias(new URL(BETA)), "distinguishable popups must not collide");
    });

    await test("Query string and fragment NEVER affect the alias", () => {
      const clean = derivePopupAlias(new URL(`${BASE}/popup/script-timer-popup.html`));
      const dirty = derivePopupAlias(new URL(`${BASE}/popup/script-timer-popup.html?token=NOT_A_REAL_TOKEN_abc123&session=sess-987#section-2`));
      assert(clean === dirty, "query/fragment must not be identity-bearing");
    });

    await test("No secret material can appear in a derived alias", () => {
      const alias = derivePopupAlias(new URL(`${BASE}/popup/script-timer-popup.html?token=NOT_A_REAL_TOKEN_abc123&session=sess-987#section-2`));
      assert(!alias.includes("NOT_A_REAL_TOKEN"), `alias leaked a token: ${alias}`);
      assert(!alias.includes("sess-987"), `alias leaked a session id: ${alias}`);
      assert(!alias.includes("?") && !alias.includes("#"), `alias carried URL punctuation: ${alias}`);
    });

    await test("Alias is a neutral prefix + hash only (no positional counter, no echoed input)", () => {
      const alias = derivePopupAlias(new URL(ALPHA));
      assert(/^popup-[0-9a-f]{12}$/.test(alias), `expected popup-<hash>, got: ${alias}`);
      assert(!/^popup-\d+$/.test(alias), `alias must not be arrival-order shaped: ${alias}`);
      assert(!alias.includes("localhost"), `alias echoed its origin: ${alias}`);
      assert(!alias.includes("reversed"), `alias echoed its pathname: ${alias}`);
    });

    // ─── Suite 2: reversed opening order (C1.5) ───────────────────────────────
    console.log("\nSuite 2: Reversed opening order (C1.5)");

    async function runOrder(order: "alpha-first" | "beta-first"): Promise<Map<string, string>> {
      const t = await makeRunnerTopology(browser);
      await t.mainPage.goto(`${BASE}/popup/reversed-order.html`);
      await t.mainPage.click(`[data-testid=${order === "alpha-first" ? "open-alpha-first-button" : "open-beta-first-button"}]`);
      await t.mainPage.waitForTimeout(1200); // bounded: both opens + the 250 ms scripted gap
      await t.registry.settle();

      const result = new Map<string, string>();
      for (const alias of t.registry.aliases()) {
        if (alias === MAIN_PAGE_ALIAS) continue;
        const popup = t.registry.tryResolve(alias);
        if (!popup) continue;
        result.set(alias, new URL(popup.url()).pathname);
      }
      await t.ctx.close();
      return result;
    }

    const alphaFirst = await runOrder("alpha-first");
    const betaFirst = await runOrder("beta-first");

    await test("Both popups are registered in each order", () => {
      assert(alphaFirst.size === 2, `alpha-first: expected 2 popups, got ${alphaFirst.size}`);
      assert(betaFirst.size === 2, `beta-first: expected 2 popups, got ${betaFirst.size}`);
    });

    await test("Reversed order produces IDENTICAL aliases", () => {
      const a = [...alphaFirst.keys()].sort().join(",");
      const b = [...betaFirst.keys()].sort().join(",");
      assert(a === b, `aliases differed between orders:\n  alpha-first: ${a}\n  beta-first:  ${b}`);
    });

    await test("Each alias maps to the SAME popup page in both orders (the defect's core symptom)", () => {
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

    async function runTimer(): Promise<{ alias: string; registry: PopupIdentityRegistry; ctx: BrowserContext }> {
      const t = await makeRunnerTopology(browser);
      await t.mainPage.goto(`${BASE}/popup/script-timer.html`);
      await t.mainPage.click("[data-testid=arm-timer-button]");
      await t.mainPage.waitForTimeout(900); // bounded: the scenario's 400 ms timer plus load
      await t.registry.settle();
      const aliases = t.registry.aliases().filter((a) => a !== MAIN_PAGE_ALIAS);
      return { alias: aliases[0] ?? "", registry: t.registry, ctx: t.ctx };
    }

    const timerRun1 = await runTimer();
    const timerRun2 = await runTimer();

    await test("A popup with no click step still receives one alias", () => {
      assert(timerRun1.alias.length > 0, "timer-opened popup got no alias");
      const all = timerRun1.registry.aliases().filter((a) => a !== MAIN_PAGE_ALIAS);
      assert(all.length === 1, `expected exactly 1 popup alias, got ${all.length}: [${all.join(", ")}]`);
    });

    await test("The synthetic alias is stable across separate runs", () => {
      assert(timerRun1.alias === timerRun2.alias, `alias changed between runs: ${timerRun1.alias} vs ${timerRun2.alias}`);
    });

    await test("The live alias carries no token or session value from the popup URL", () => {
      assert(!timerRun1.alias.includes("NOT_A_REAL_TOKEN"), `alias leaked a token: ${timerRun1.alias}`);
      assert(!timerRun1.alias.includes("sess-987"), `alias leaked a session id: ${timerRun1.alias}`);
    });

    await test("One Page is registered under exactly one alias (C1.4)", () => {
      const popup = timerRun1.registry.tryResolve(timerRun1.alias);
      assert(popup, "timer popup should resolve");
      assert(aliasesFor(timerRun1.registry, popup).length === 1, "a single Page was reachable under more than one alias");
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

    // ─── Suite 4: ambiguity reconciliation ────────────────────────────────────
    console.log("\nSuite 4: Ambiguity reflects the CURRENT live set");

    /** Open two popups at the same origin+path — genuinely indistinguishable identity. */
    async function twoIdentical(): Promise<{
      t: Awaited<ReturnType<typeof makeRunnerTopology>>;
      identity: string;
      first: Page;
      second: Page;
    }> {
      const t = await makeRunnerTopology(browser);
      await t.mainPage.goto(`${BASE}/popup/script-timer.html`);
      await t.mainPage.click("[data-testid=open-ambiguous-button]");
      await t.mainPage.waitForTimeout(900);
      await t.registry.settle();
      const popups = t.ctx.pages().filter((p) => p !== t.mainPage);
      const identity = derivePopupAlias(new URL(`${BASE}/popup/script-timer-popup.html`));
      return { t, identity, first: popups[0], second: popups[1] };
    }

    const ambiguityIsReported = (registry: PopupIdentityRegistry, identity: string): boolean => {
      try {
        registry.tryResolve(identity);
        return false;
      } catch {
        return true;
      }
    };

    {
      const { t, identity, first, second } = await twoIdentical();
      await test("Two identical popups → ambiguous, with no positional fallback", () => {
        assert(t.ctx.pages().length === 3, "fixture should have opened two popups");
        assert(ambiguityIsReported(t.registry, identity), "expected an ambiguity diagnostic");
        for (const alias of t.registry.aliases()) {
          assert(!/^popup-\d+$/.test(alias), `fell back to a positional alias: ${alias}`);
        }
        assert(t.registry.aliasFor(first) === undefined, "no contested page may hold the alias");
        assert(t.registry.aliasFor(second) === undefined, "no contested page may hold the alias");
      });

      await test("Ambiguity diagnostic is explicit and secret-masked", () => {
        let message = "";
        try {
          t.registry.tryResolve(identity);
        } catch (error) {
          message = error instanceof Error ? error.message : String(error);
        }
        assert(message.includes("ambiguous"), `expected an ambiguity diagnostic, got: ${message || "(no throw)"}`);
        assert(!message.includes("NOT_A_REAL_TOKEN"), "ambiguity diagnostic leaked a token");
      });

      await test("One popup closes → the remaining popup becomes usable (no latched ambiguity)", async () => {
        await first.close();
        await t.mainPage.waitForTimeout(200);
        assert(!ambiguityIsReported(t.registry, identity), "ambiguity latched after a popup closed");
        assert(t.registry.tryResolve(identity) === second, "the surviving popup should now own the identity");
      });

      await test("Last popup closes → no stale alias or ambiguity remains", async () => {
        await second.close();
        await t.mainPage.waitForTimeout(200);
        assert(!ambiguityIsReported(t.registry, identity), "ambiguity survived every page closing");
        assert(t.registry.tryResolve(identity) === undefined, "a stale alias survived");
        assert(t.registry.aliases().length === 1 && t.registry.aliases()[0] === MAIN_PAGE_ALIAS, `only main should remain, got [${t.registry.aliases().join(", ")}]`);
      });
      await t.ctx.close();
    }

    {
      const { t, identity, first, second } = await twoIdentical();
      await test("Contested popup closes → the ORIGINAL holder resolves", async () => {
        await second.close();
        await t.mainPage.waitForTimeout(200);
        assert(!ambiguityIsReported(t.registry, identity), "ambiguity latched after the contender closed");
        assert(t.registry.tryResolve(identity) === first, "the original popup should own the identity");
      });
      await t.ctx.close();
    }

    {
      const { t, identity, first, second } = await twoIdentical();
      await test("One popup is claimed under a recorded alias → the other takes the synthetic alias", () => {
        t.registry.claim(first, "popup-1");
        assert(t.registry.tryResolve("popup-1") === first, "recorded claim should hold");
        assert(!ambiguityIsReported(t.registry, identity), "ambiguity latched after a claim resolved it");
        assert(t.registry.tryResolve(identity) === second, "the remaining popup should take the synthetic alias");
        assert(aliasesFor(t.registry, first).length === 1, "claimed page must hold exactly one alias");
      });
      await t.ctx.close();
    }

    {
      const { t, identity, first, second } = await twoIdentical();
      await test("One popup is marked internal → the other resolves", () => {
        t.registry.markInternal(first);
        assert(!ambiguityIsReported(t.registry, identity), "ambiguity latched after a page became internal");
        assert(t.registry.tryResolve(identity) === second, "the remaining popup should own the identity");
      });

      await test("Releasing a recorded alias returns the page to its identity bucket", () => {
        t.registry.claim(second, "popup-7");
        assert(t.registry.tryResolve(identity) === undefined, "synthetic alias should be vacant while claimed");
        t.registry.release("popup-7");
        assert(t.registry.tryResolve("popup-7") === undefined, "released alias must not resolve");
        assert(t.registry.tryResolve(identity) === second, "released page should reclaim its synthetic identity");
      });
      await t.ctx.close();
    }

    // ─── Suite 5: lifecycle, claims, and legacy aliases ───────────────────────
    console.log("\nSuite 5: Lifecycle, recorded-alias precedence, legacy compatibility");
    {
      const t = await makeRunnerTopology(browser);
      await t.mainPage.goto(`${BASE}/popup/reversed-order.html`);
      const registry = t.registry;

      await test("Legacy popup-1 alias still resolves after being claimed (C1.7)", async () => {
        const popup = await t.ctx.newPage();
        await popup.goto(ALPHA);
        registry.observe(popup);
        registry.claim(popup, "popup-1");
        assert(registry.tryResolve("popup-1") === popup, "legacy alias must resolve");
        assert(registry.aliasFor(popup) === "popup-1", "reverse lookup must agree");
      });

      await test("Claiming removes the synthetic alias — never both (C1.2)", () => {
        const popup = registry.tryResolve("popup-1");
        assert(popup, "popup-1 should resolve");
        const held = aliasesFor(registry, popup);
        assert(held.length === 1 && held[0] === "popup-1", `expected only popup-1, got [${held.join(", ")}]`);
        assert(!registry.aliases().includes(derivePopupAlias(new URL(ALPHA))), "synthetic key survived the claim");
      });

      await test("Closing a popup removes BOTH mappings (C1.6)", async () => {
        const popup = registry.tryResolve("popup-1");
        assert(popup, "popup-1 should resolve");
        await popup.close();
        await t.mainPage.waitForTimeout(200);
        assert(registry.tryResolve("popup-1") === undefined, "alias survived its page's close");
        assert(registry.aliasFor(popup) === undefined, "reverse mapping survived close");
      });

      await test("A reopened popup may reuse the recorded alias (C1.6/C1.7)", async () => {
        const replacement = await t.ctx.newPage();
        await replacement.goto(ALPHA);
        registry.observe(replacement);
        registry.claim(replacement, "popup-1");
        assert(registry.tryResolve("popup-1") === replacement, "reopened popup could not reclaim its alias");
      });

      await test("A second live page cannot steal a held alias (invariant 8)", async () => {
        const intruder = await t.ctx.newPage();
        await intruder.goto(BETA);
        registry.observe(intruder);
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
        const popup = await t.ctx.newPage();
        await popup.goto(BETA);
        registry.observe(popup);
        let threw = "";
        try {
          registry.claim(popup, MAIN_PAGE_ALIAS);
        } catch (error) {
          threw = error instanceof Error ? error.message : String(error);
        }
        assert(threw.includes("reserved"), `expected a reserved-alias diagnostic, got: ${threw || "(no throw)"}`);
        assert(registry.tryResolve(MAIN_PAGE_ALIAS) === t.mainPage, "main must still resolve to the main page");
        await popup.close();
      });

      await test("An uncommitted about:blank page gets no guessed alias", async () => {
        const blank = await t.ctx.newPage();
        const before = registry.aliases().length;
        registry.observe(blank);
        assert(registry.aliasFor(blank) === undefined, "an uncommitted page must not be given an alias");
        assert(registry.aliases().length === before, "an uncommitted page must not add a registry key");
        await blank.close();
      });

      await t.ctx.close();
    }

    // ─── Suite 6: one identity owner per browser context ──────────────────────
    console.log("\nSuite 6: One identity owner per BrowserContext (nested flows + branches)");
    {
      const t = await makeRunnerTopology(browser);
      await t.mainPage.goto(`${BASE}/popup/reversed-order.html`);

      await test("Parent and nested child-flow executors share ONE registry", () => {
        const child = t.newChildExecutor();
        assert(t.parent.pageIdentity === t.registry, "parent executor must use the context registry");
        assert(child.pageIdentity === t.registry, "child-flow executor must use the SAME registry");
      });

      await test("A popup opened inside a child flow is observed exactly once", async () => {
        const child = t.newChildExecutor();
        await t.mainPage.click("[data-testid=open-alpha-button]");
        await t.mainPage.waitForTimeout(700);
        await t.registry.settle();
        const identity = derivePopupAlias(new URL(ALPHA));
        const popup = t.registry.tryResolve(identity);
        assert(popup, "child-flow popup should resolve");
        assert(aliasesFor(t.registry, popup).length === 1, "child-flow popup held more than one alias");
        // Both executors resolve the identical Page — there is only one registry to disagree with.
        assert(child.pageIdentity.tryResolve(identity) === popup, "child executor saw a different Page");
        assert(t.parent.pageIdentity.tryResolve(identity) === popup, "parent executor saw a different Page");
        await popup.close();
        await t.mainPage.waitForTimeout(150);
      });

      await test("A branch page never consumes a popup alias, even in production ordering", async () => {
        const { page: branchPage } = await t.newBranchExecutor();
        await branchPage.goto(BETA); // navigation AFTER being marked internal
        await t.mainPage.waitForTimeout(250);
        await t.registry.settle();
        assert(t.registry.aliasFor(branchPage) === undefined, "a branch page was left holding a popup alias");
        assert(t.registry.tryResolve(derivePopupAlias(new URL(BETA))) === undefined, "the branch page claimed the beta identity");
        await branchPage.close();
      });

      await test("A real popup still gets its alias after a branch page was excluded", async () => {
        await t.mainPage.click("[data-testid=open-beta-button]");
        await t.mainPage.waitForTimeout(700);
        await t.registry.settle();
        const popup = t.registry.tryResolve(derivePopupAlias(new URL(BETA)));
        assert(popup, "a genuine popup must still receive its alias");
        await popup.close();
      });

      await t.ctx.close();
    }

    await test("PlaywrightRunner installs exactly ONE context page-observer (source guard)", async () => {
      const source = await readFile(join(here, "../src/runner/PlaywrightRunner.ts"), "utf8");
      const installs = source.match(/context\.on\("page"/g) ?? [];
      assert(installs.length === 1, `expected 1 page-observer installation, found ${installs.length}`);
      assert(
        /bindPopupIdentityObserver\(holder: BrowserHolder\)[\s\S]{0,600}context\.on\("page"/.test(source),
        "the single page observer must live in bindPopupIdentityObserver (per runtime generation)"
      );
      // `runFlowWithChildren` is recursive (every `Run Another Flow` re-enters it), so an observer
      // installed in its body would give one popup two identity owners. Scan that method's body only.
      const start = source.indexOf("private async runFlowWithChildren(");
      const end = source.indexOf("private async executeChildFlow(");
      assert(start > 0 && end > start, "could not locate runFlowWithChildren's body for the scan");
      assert(
        !source.slice(start, end).includes('context.on("page"'),
        "runFlowWithChildren must not install its own observer (it is recursive)"
      );
    });

    // ─── Suite 7: internal-page pending-identity race ─────────────────────────
    console.log("\nSuite 7: Internal-page race in exact production ordering");
    {
      const t = await makeRunnerTopology(browser);
      await t.mainPage.goto(`${BASE}/popup/reversed-order.html`);

      await test("markInternal CANCELS the scheduled finalization (defense A, mechanism)", async () => {
        const page = await t.ctx.newPage();          // 1. "page" event fires on about:blank
        t.registry.observe(page);                    //    observer schedules pending identity
        assert(t.registry.pendingIdentityCount() === 1, "expected a scheduled finalization to cancel");
        t.registry.markInternal(page);               // 2. runner marks it internal
        // Asserting the MECHANISM, not just the outcome: `reconcile`'s eligibility filter would hide
        // a missing cancellation here, so a pure "no alias appeared" check does not discriminate.
        assert(
          t.registry.pendingIdentityCount() === 0,
          "markInternal left a pending finalization scheduled (leaked listeners + timer)"
        );
        await page.close();
      });

      await test("observe(about:blank) → markInternal → navigate → settle assigns NO alias", async () => {
        const page = await t.ctx.newPage();          // 1. "page" event fires on about:blank
        t.registry.observe(page);                    //    observer schedules pending identity
        t.registry.markInternal(page);               // 2. runner marks it internal
        await page.goto(ALPHA);                      // 3. branch navigates
        await t.registry.settle();                   // 4. any pending finalization completes
        await t.mainPage.waitForTimeout(150);
        assert(t.registry.aliasFor(page) === undefined, "pending finalization assigned an alias to an internal page");
        assert(t.registry.tryResolve(derivePopupAlias(new URL(ALPHA))) === undefined, "internal page took the alpha identity");
        await page.close();
      });

      await test("A later real popup still receives its correct alias", async () => {
        await t.mainPage.click("[data-testid=open-alpha-button]");
        await t.mainPage.waitForTimeout(700);
        await t.registry.settle();
        const popup = t.registry.tryResolve(derivePopupAlias(new URL(ALPHA)));
        assert(popup, "a genuine popup must still receive its alias after the internal-page race");
        await popup.close();
      });

      await t.ctx.close();
    }

    // ─── Suite 8: hostile aliases and masked diagnostics ──────────────────────
    console.log("\nSuite 8: Sensitive material never surfaces in aliases or diagnostics");
    {
      registerSecretValues(["LITERAL_REGISTERED_SECRET_VALUE"]);
      const t = await makeRunnerTopology(browser);
      await t.mainPage.goto(`${BASE}/popup/reversed-order.html`);

      const hostile = [
        "token=SUPER_SECRET_TOKEN_VALUE",
        "password=hunter2hunter2",
        "Bearer eyJhbGciOiJIUzI1NiJ9.PAYLOAD.SIGNATURE",
        "LITERAL_REGISTERED_SECRET_VALUE",
        "../../etc/passwd"
      ];

      await test("A hostile opener/recorded alias never appears in a derived alias", async () => {
        // Identity is derived from the URL alone, so no caller-controlled alias text can reach it.
        const popup = await t.ctx.newPage();
        await popup.goto(ALPHA);
        t.registry.observe(popup);
        for (const nasty of hostile) {
          const alias = derivePopupAlias(new URL(ALPHA));
          assert(!alias.includes(nasty), `derived alias echoed hostile material: ${alias}`);
        }
        assert(/^popup-[0-9a-f]{12}$/.test(t.registry.aliasFor(popup) ?? ""), `live alias is not neutral: ${t.registry.aliasFor(popup)}`);
        await popup.close();
      });

      await test("Duplicate-claim diagnostics are secret-masked", async () => {
        for (const nasty of hostile.slice(0, 4)) {
          const holder = await t.ctx.newPage();
          await holder.goto(ALPHA);
          t.registry.observe(holder);
          t.registry.claim(holder, nasty);
          const intruder = await t.ctx.newPage();
          await intruder.goto(BETA);
          t.registry.observe(intruder);
          let message = "";
          try {
            t.registry.claim(intruder, nasty);
          } catch (error) {
            message = error instanceof Error ? error.message : String(error);
          }
          assert(message.length > 0, `expected a duplicate-claim throw for ${nasty}`);
          assert(!message.includes("SUPER_SECRET_TOKEN_VALUE"), `diagnostic leaked a token: ${message}`);
          assert(!message.includes("hunter2hunter2"), `diagnostic leaked a password: ${message}`);
          assert(!message.includes("eyJhbGciOiJIUzI1NiJ9.PAYLOAD.SIGNATURE"), `diagnostic leaked a bearer token: ${message}`);
          assert(!message.includes("LITERAL_REGISTERED_SECRET_VALUE"), `diagnostic leaked a registered secret: ${message}`);
          assert(message.includes("already held"), "masking destroyed the diagnostic's usefulness");
          await holder.close();
          await intruder.close();
          await t.mainPage.waitForTimeout(60);
        }
      });

      await test("Reserved-alias diagnostics are secret-masked and still useful", async () => {
        const popup = await t.ctx.newPage();
        await popup.goto(ALPHA);
        t.registry.observe(popup);
        let message = "";
        try {
          t.registry.claim(popup, MAIN_PAGE_ALIAS);
        } catch (error) {
          message = error instanceof Error ? error.message : String(error);
        }
        assert(message.includes("reserved"), `expected a reserved-alias diagnostic, got: ${message}`);
        await popup.close();
      });

      await test("The missing-popup step diagnostic is masked but keeps its stable shape", async () => {
        const step = makeStep({
          type: "click",
          pageAlias: "token=SUPER_SECRET_TOKEN_VALUE",
          locator: { strategy: "testId", value: "alpha-action-button" }
        });
        const result = await t.parent.execute(step);
        assert(result.status === "failed", `expected failure for an unknown alias, got ${result.status}`);
        const error = result.error ?? "";
        assert(error.includes("is not available"), `diagnostic lost its stable shape: ${error}`);
        assert(!error.includes("SUPER_SECRET_TOKEN_VALUE"), `resolver diagnostic leaked a token: ${error}`);
        assert(error.includes("[masked]"), `expected masked marker in: ${error}`);
      });

      await t.ctx.close();
    }

    // ─── Suite 9: no listener or pending-task growth ──────────────────────────
    console.log("\nSuite 9: Listeners and pending tasks do not accumulate");
    {
      const t = await makeRunnerTopology(browser);
      await t.mainPage.goto(`${BASE}/popup/reversed-order.html`);

      await test("Repeated about:blank → navigate → close cycles leak no listeners or tasks", async () => {
        for (let i = 0; i < 8; i += 1) {
          const page = await t.ctx.newPage();
          t.registry.observe(page);
          await page.goto(i % 2 === 0 ? ALPHA : BETA);
          await t.registry.settle();
          await page.close();
          await t.mainPage.waitForTimeout(40);
        }
        assert(t.registry.pendingIdentityCount() === 0, `pending identity tasks leaked: ${t.registry.pendingIdentityCount()}`);
        const live = t.registry.aliases().filter((a) => a !== MAIN_PAGE_ALIAS);
        assert(live.length === 0, `aliases survived every page closing: [${live.join(", ")}]`);
        // Playwright's `Page` is an EventEmitter at runtime but does not declare `listenerCount`.
        const mainListeners = (t.mainPage as unknown as { listenerCount(event: string): number }).listenerCount("close");
        assert(mainListeners <= 2, `close listeners accumulated on the main page: ${mainListeners}`);
      });

      await test("A page closed before its URL commits leaves no pending task", async () => {
        const page = await t.ctx.newPage();
        t.registry.observe(page);
        assert(t.registry.pendingIdentityCount() === 1, "expected one pending finalization");
        await page.close();
        await t.mainPage.waitForTimeout(150);
        assert(t.registry.pendingIdentityCount() === 0, "closing an uncommitted page left a pending task");
      });

      await t.ctx.close();
    }
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
