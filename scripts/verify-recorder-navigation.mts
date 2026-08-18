/**
 * verify:recorder-navigation — what the Recorder actually records when the URL changes.
 *
 * What regression makes this fail?
 *   - a navigation kind stops reaching `RecorderService.recordedUrls` (document navigation, SPA
 *     pushState/replaceState, or hashchange);
 *   - the recorded URL loses its query string or hash, so `?page=1 -> ?page=2` and `#a -> #b`
 *     become indistinguishable;
 *   - the visited-URL set stops deduplicating, so revisiting a known URL starts appending records;
 *   - `attachUrlCapture` stops filtering `about:blank` and internal schemes.
 *
 * Why this verifier exists. An audit (`awkit-n7n`) found the navigation path implemented but
 * ASSERTED NOWHERE: the only SPA-related checks in the suite prove that clicks still record across
 * a route change, not that the transition itself is captured. Reading the code produced two
 * plausible defect theories — that the init script's `kind:"url"` signal never reaches
 * `recordedUrls` (true, it feeds Smart Wait only) and that `emitUrl()` strips hash and query (also
 * true) — and BOTH turned out to be harmless, because `recordedUrls` is fed by
 * `page.on("framenavigated")` using `frame.url()`, which carries the complete URL. The theories
 * were wrong about consequence. This file exists so the question is answered by measurement rather
 * than by reading, permanently.
 *
 * Deliberately drives the real `RecorderService.attachUrlCapture` against real Chromium and the
 * real mock site. No mock of the unit under test.
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";

import { RecorderService } from "@src/recorder/RecorderService";
import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";
import { getRecorderInitScriptContent } from "@src/recorder/recorderInitScript";

const PORT = Number(process.env.MOCK_SITE_PORT ?? 4598);
const base = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  OK ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

const until = async (fn: () => Promise<boolean>, ms = 20_000): Promise<boolean> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
};

/**
 * The mock site serves EXTENSIONLESS routes (`/login`, not `/login.html`). Probing `/index.html`
 * returns 404 and makes a readiness check look like a server that never started — which is exactly
 * how the first attempt at this measurement was lost.
 */
const READY_ROUTE = "/login";

async function main(): Promise<void> {
  const server = spawn(process.execPath, ["mock-site/server.mjs"], {
    env: { ...process.env, MOCK_SITE_PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let serverOut = "";
  server.stdout?.on("data", (d) => (serverOut += String(d)));
  server.stderr?.on("data", (d) => (serverOut += String(d)));
  server.on("error", (e) => (serverOut += `spawn error: ${e.message}\n`));

  const ready = await until(async () => (await fetch(`${base}${READY_ROUTE}`)).ok);
  if (!ready) {
    console.error(`mock site did not start on ${PORT}. Server output:\n${serverOut || "(none)"}`);
    server.kill();
    process.exit(1);
  }

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const svc = new RecorderService() as unknown as {
      isRecording: boolean;
      urlSessionId: string;
      recordedUrls: { url: string }[];
      actions: { type: string; name: string }[];
      attachUrlCapture(page: unknown): void;
    };
    svc.isRecording = true;
    svc.urlSessionId = "verify-navigation";
    svc.recordedUrls = [];

    const page = await context.newPage();
    svc.attachUrlCapture(page);

    const seen = (): string[] => svc.recordedUrls.map((u) => String(u.url).replace(base, ""));
    const settle = () => new Promise((r) => setTimeout(r, 400));

    await page.goto(`${base}/form`);
    await settle();
    check("the initial document navigation is recorded", seen().includes("/form"), seen().join(", "));

    const step = async (label: string, run: () => Promise<void>): Promise<string[]> => {
      const before = new Set(seen());
      await run();
      await settle();
      const added = seen().filter((u) => !before.has(u));
      console.log(`    [${label}] added: ${added.length ? added.join(", ") : "(nothing)"}`);
      return added;
    };

    const docNav = await step("goto", async () => { await page.goto(`${base}/login`); });
    check("a full document navigation is recorded", docNav.includes("/login"), docNav.join(", "));

    const push = await step("pushState", async () => {
      await page.evaluate(() => history.pushState({}, "", "/login?spa=1"));
    });
    check("an SPA pushState route change is recorded", push.length === 1, push.join(", "));
    check("pushState preserves the query string", push[0] === "/login?spa=1", push.join(", "));

    const replace = await step("replaceState", async () => {
      await page.evaluate(() => history.replaceState({}, "", "/login?spa=2"));
    });
    check("an SPA replaceState route change is recorded", replace.length === 1, replace.join(", "));
    check("replaceState preserves the query string", replace[0] === "/login?spa=2", replace.join(", "));

    const hash = await step("hashchange", async () => {
      await page.evaluate(() => { location.hash = "#sec2"; });
    });
    check("a hash change is recorded", hash.length === 1, hash.join(", "));
    check(
      "the hash is preserved in the recorded URL",
      hash[0]?.endsWith("#sec2") === true,
      hash.join(", ")
    );
    // The distinguishing property: a hash-only move must not collapse onto its base URL.
    check(
      "a hash change is distinguishable from its base URL",
      hash[0] !== "/login?spa=2" && seen().includes("/login?spa=2"),
      seen().join(", ")
    );

    const repeat = await step("re-goto a known URL", async () => {
      await page.goto(`${base}/login?spa=2`);
    });
    check("revisiting a known URL adds no duplicate record", repeat.length === 0, repeat.join(", "));

    const back = await step("back", async () => { await page.goBack().catch(() => undefined); });
    check("back adds no new record (destination already visited)", back.length === 0, back.join(", "));

    const forward = await step("forward", async () => { await page.goForward().catch(() => undefined); });
    check("forward adds no new record (destination already visited)", forward.length === 0, forward.join(", "));

    const reload = await step("reload", async () => { await page.reload(); });
    check("reload adds no new record (same URL)", reload.length === 0, reload.join(", "));

    // Non-vacuity: the whole set must be what we expect, or the checks above could pass while the
    // capture path silently recorded extra noise.
    const finalUrls = seen().sort();
    const expected = ["/form", "/login", "/login?spa=1", "/login?spa=2", "/login?spa=2#sec2"].sort();
    check(
      "exactly the five distinct URLs are recorded, with no extras",
      JSON.stringify(finalUrls) === JSON.stringify(expected),
      `got ${JSON.stringify(finalUrls)}`
    );
    check("about:blank was never recorded", !finalUrls.some((u) => u.startsWith("about:")));

    /* ── Independent navigation becomes a step; action-caused navigation does not (awkit-76x) ──
       Every navigation above arrived with NO recorded action to explain it - this harness drives
       the browser directly - so each one is independent by definition and must produce a `goto`
       step, or replay could never reach those pages. The opening navigation is excluded because the
       session's explicit start `goto` already covers it. */
    const gotoSteps = (svc.actions ?? []).filter((a) => a.type === "goto");
    check(
      "independent navigations each produce a goto step",
      gotoSteps.length >= 4,
      `${gotoSteps.length}: ${gotoSteps.map((g) => g.name).join(" | ")}`
    );
    check(
      "the opening navigation does NOT get a duplicate goto step",
      !gotoSteps.some((g) => g.name.endsWith("/form")),
      gotoSteps.map((g) => g.name).join(" | ")
    );

    /* ── The boundary between recorded URLs and the replayable flow ────────────────────────────
       Everything above measures the URL HISTORY. This block pins the separate, easily-missed fact
       that history is not replay: `buildRecordedFlow(name, actions, blueprints)` takes actions only
       and never sees `recordedUrls`, so a flow's sole navigation step is the initial `goto` pushed
       when recording starts. Action-caused navigation replays implicitly through Playwright's
       auto-waiting, which matches the brief's preference for navigation metadata on the triggering
       action over redundant Navigate steps. INDEPENDENT navigation mid-recording (typing a URL,
       using the back button) has no representation at all — tracked as awkit-76x.

       These checks exist so that boundary is asserted rather than rediscovered by reading. */
    const flow = buildRecordedFlow("nav-contract", [
      { id: "a1", type: "goto", name: "Navigate to /form", valueSource: { type: "static", value: `${base}/form` } },
      { id: "a2", type: "click", name: "Click Submit" }
    ] as never);

    // `nodes` IS the FlowStep array in this profile shape (start, ...actions, end).
    const stepTypes = (flow.nodes as { type: string }[]).map((n) => n.type);
    const navSteps = stepTypes.filter((t) => t === "goto");
    check("the initial goto becomes the flow's navigation step", navSteps.length === 1, stepTypes.join(", "));
    check(
      "recorded URL history contributes NO extra navigation steps",
      navSteps.length === 1 && stepTypes.filter((t) => t === "goto").length === 1,
      `steps: ${stepTypes.join(", ")}`
    );
    check(
      "buildRecordedFlow takes actions only (recordedUrls is history, not replay)",
      buildRecordedFlow.length <= 3,
      `arity ${buildRecordedFlow.length}`
    );

    /* ── Action-caused navigation must NOT gain a step (awkit-rit) ─────────────────────────────
       The other half of the awkit-76x contract, and the half that was unguarded: mutation M1 —
       forcing every navigation to count as independent — survived the entire recorder suite,
       because nothing recorded a real action that CAUSES navigation. A regression there would give
       every click-caused navigation a redundant Navigate step, exactly what §9 warns against.

       This needs the init script and the real `recordActionFromPage` wiring, so it runs on its own
       context: a click on a link is a recorded action, and the navigation it causes is explained by
       that action and must stay implicit. */
    const causalContext = await browser.newContext();
    const causal = new RecorderService() as unknown as {
      isRecording: boolean;
      urlSessionId: string;
      recordedUrls: { url: string }[];
      actions: { type: string; name: string }[];
      attachUrlCapture(page: unknown): void;
      recordActionFromPage(page: unknown, action: unknown, frame?: unknown): void;
    };
    causal.isRecording = true;
    causal.urlSessionId = "verify-navigation-causal";
    causal.recordedUrls = [];
    causal.actions = [];

    await causalContext.exposeBinding("__awtkit_recordAction", async (src: { page: unknown; frame: unknown }, a: unknown) => {
      causal.recordActionFromPage(src.page, a, src.frame);
    });
    await causalContext.exposeBinding("__awtkit_recordSignal", () => undefined);
    await causalContext.addInitScript({ content: getRecorderInitScriptContent() });

    const causalPage = await causalContext.newPage();
    causal.attachUrlCapture(causalPage);
    await causalPage.goto(`${base}/`);
    await settle();

    const urlsAfterOpen = causal.recordedUrls.length;
    check("the causal harness reaches captureUrl at all", urlsAfterOpen >= 1, `${urlsAfterOpen} url(s)`);

    const gotosBefore = causal.actions.filter((a) => a.type === "goto").length;
    await causalPage.getByRole("link", { name: /smart wait/i }).first().click()
      .catch(async () => { await causalPage.locator('a[href="/smart-waits"]').first().click(); });
    await causalPage.waitForLoadState("load").catch(() => undefined);
    await settle();

    const clickSteps = causal.actions.filter((a) => a.type === "click").length;
    const gotosAfter = causal.actions.filter((a) => a.type === "goto").length;
    const navigated = causal.recordedUrls.length > urlsAfterOpen;

    // Each precondition is asserted, so a silent failure to click or navigate cannot masquerade as
    // "no redundant goto was added".
    check("the click was recorded as an action", clickSteps >= 1, causal.actions.map((a) => a.type).join(", "));
    check("the click actually caused a navigation", navigated, `urls: ${causal.recordedUrls.length}`);
    check(
      "action-caused navigation adds NO redundant goto step",
      gotosAfter === gotosBefore,
      `goto steps ${gotosBefore} -> ${gotosAfter}: ${causal.actions.map((a) => a.type).join(", ")}`
    );

    /* ── Per-keystroke input coalesces into ONE fill action (awkit-s1c) ────────────────────────
       Brief §12 warns that one semantic user action must not become several recorded steps.
       `recordActionFromPage` already collapses consecutive fills on the same field, and this pins
       that measurement so it cannot regress unnoticed.

       Worth knowing for anyone writing a harness here: a harness that exposes its OWN
       `__awtkit_recordAction` binding measures the RAW init-script emission — five actions for five
       keystrokes — and will appear to show a coalescing defect that does not exist. It must call
       `recordActionFromPage`, as this one does. That mistake produced a confident wrong finding
       before it was caught. */
    await causalPage.goto(`${base}/login`);
    await settle();
    const beforeTyping = causal.actions.length;
    await causalPage.locator("input").first().click();
    await causalPage.keyboard.type("alice");
    await settle();

    const typed = causal.actions.slice(beforeTyping);
    const fills = typed.filter((a) => a.type === "fill");
    check(
      "typing five characters records ONE fill action, not one per keystroke",
      fills.length === 1,
      `${fills.length} fill(s) from ${typed.length} action(s): ${typed.map((a) => a.type).join(", ")}`
    );
    // Non-vacuity: a run that recorded nothing at all would also have "not one per keystroke".
    check(
      "the coalesced fill was actually recorded",
      fills.length >= 1,
      typed.map((a) => a.type).join(", ")
    );

    /* ── The change/blur echo is dropped, but a real re-entry is not (awkit-ty4) ───────────────
       Typing then leaving a field records the value twice: the browser's change event replays a
       value already captured, and coalescing cannot absorb it because the Tab sits between.

       The naive rule — drop any fill whose value matches the last fill on that target — is wrong,
       which is why this defect was deferred twice rather than patched. `fill A / click Clear /
       fill A` is a REAL sequence and dropping the second breaks replay on any form with a reset
       control. The rule that works asks what happened IN BETWEEN: only focus/pointer moves that
       cannot mutate a value (navigation keys, hover) permit the drop.

       Cases B and C are the ones that matter. If a future "simplification" collapses this to a
       value comparison, they fail. */
    {
      const echoSvc = new RecorderService() as unknown as {
        isRecording: boolean;
        actions: { type: string }[];
        lastActionPage: unknown;
        recordActionFromPage(page: unknown, action: unknown): void;
      };
      const fakePage = { id: "echo-probe" };
      const loc = (name: string) => ({ strategy: "role", value: "textbox", name });
      const fill = (name: string, value: string) => ({
        type: "fill", name: `Fill ${name}`, locator: loc(name), valueSource: { type: "static", value }
      });
      const press = (key: string) => ({ type: "press", name: `Press ${key}`, valueSource: { type: "static", value: key } });
      const click = (name: string) => ({ type: "click", name: `Click ${name}`, locator: loc(name) });

      const run = (sequence: unknown[]): number => {
        echoSvc.isRecording = true;
        echoSvc.actions = [];
        echoSvc.lastActionPage = fakePage;
        for (const step of sequence) echoSvc.recordActionFromPage(fakePage, step);
        return echoSvc.actions.length;
      };

      check("the change/blur echo after Tab is dropped",
        run([fill("Username", "alice"), press("Tab"), fill("Username", "alice")]) === 2);
      check("a re-fill after a Clear CLICK is kept (not an echo)",
        run([fill("Username", "alice"), click("Clear"), fill("Username", "alice")]) === 3);
      check("a re-fill after Backspace is kept (the key could have edited the field)",
        run([fill("Username", "alice"), press("Backspace"), fill("Username", "alice")]) === 3);
      check("a different value after Tab is kept",
        run([fill("Username", "alice"), press("Tab"), fill("Username", "bob")]) === 3);
      check("consecutive typing still coalesces to one fill",
        run([fill("U", "a"), fill("U", "al"), fill("U", "ali"), fill("U", "alice")]) === 1);
      check("an identical value on a DIFFERENT field is kept",
        run([fill("Username", "alice"), press("Tab"), fill("Password", "alice")]) === 3);
    }

    await causalContext.close();

    /* ── The same transitions, driven by REAL user gestures on the navigation lab (awkit-9qj) ──
       Everything above drives navigation from the test: `page.goto`, `page.goBack()`, and
       `page.evaluate(() => history.pushState(...))`. That proves the capture path handles each KIND of
       transition, but not that it handles them as a user produces them, and the difference is not
       cosmetic: an evaluate-injected `pushState` is a call the test makes, whereas a real router calls
       the `history` method the page itself holds a reference to. A wrap that were installed too late,
       or into the wrong world, could pass every check above and still miss every real application.

       Three transitions have no representation above at all, because a test cannot fake them: a link
       click, a form submit, and a server redirect. The lab supplies all three. */
    const labContext = await browser.newContext();
    const labSvc = new RecorderService() as unknown as {
      isRecording: boolean;
      urlSessionId: string;
      recordedUrls: { url: string }[];
      actions: { type: string; name: string }[];
      attachUrlCapture(page: unknown): void;
    };
    labSvc.isRecording = true;
    labSvc.urlSessionId = "verify-navigation-lab";
    labSvc.recordedUrls = [];

    const lab = await labContext.newPage();
    labSvc.attachUrlCapture(lab);

    const labSeen = (): string[] => labSvc.recordedUrls.map((u) => String(u.url).replace(base, ""));
    const labSettle = () => new Promise((r) => setTimeout(r, 400));
    const labStep = async (label: string, run: () => Promise<void>): Promise<string[]> => {
      const before = new Set(labSeen());
      await run();
      await labSettle();
      const added = labSeen().filter((u) => !before.has(u));
      console.log(`    [lab:${label}] added: ${added.length ? added.join(", ") : "(nothing)"}`);
      return added;
    };

    await lab.goto(`${base}/navigation-lab`);
    await labSettle();
    check("the navigation lab itself is recorded on arrival", labSeen().includes("/navigation-lab"), labSeen().join(", "));

    const clickNav = await labStep("link click", async () => {
      await lab.getByTestId("nav-link").click();
      await lab.getByTestId("arrival-heading").waitFor();
    });
    check(
      "a link CLICK navigation is recorded",
      clickNav.includes("/navigation-lab/arrived"),
      clickNav.join(", ")
    );

    await lab.goBack();
    await labSettle();

    const formNav = await labStep("form submit", async () => {
      await lab.getByTestId("nav-who").fill("alice");
      await lab.getByTestId("nav-submit").click();
      await lab.getByTestId("arrival-heading").waitFor();
    });
    check(
      "a FORM SUBMIT navigation is recorded with its query string",
      formNav.some((u) => u.startsWith("/navigation-lab/arrived?") && u.includes("who=alice") && u.includes("via=form")),
      formNav.join(", ")
    );

    await lab.goto(`${base}/navigation-lab`);
    await labSettle();

    const redirectNav = await labStep("server redirect", async () => {
      await lab.getByTestId("nav-redirect").click();
      await lab.getByTestId("arrival-heading").waitFor();
    });
    check(
      "a SERVER REDIRECT records its final destination",
      redirectNav.includes("/navigation-lab/arrived?via=redirect"),
      redirectNav.join(", ")
    );
    // The property that matters, and the one a naive implementation gets wrong: the intermediate hop
    // is not somewhere the user can be sent back to, so recording it would corrupt replay.
    check(
      "the intermediate redirect hop is NOT recorded",
      !labSeen().includes("/navigation-lab/redirect"),
      labSeen().join(", ")
    );

    await lab.goto(`${base}/navigation-lab`);
    await labSettle();

    const labPush = await labStep("page-script pushState", async () => {
      await lab.getByTestId("nav-pushstate").click();
    });
    check(
      "a pushState called by the PAGE's own script is recorded",
      labPush.includes("/navigation-lab/route-a?step=1"),
      labPush.join(", ")
    );

    const labReplace = await labStep("page-script replaceState", async () => {
      await lab.getByTestId("nav-replacestate").click();
    });
    check(
      "a replaceState called by the PAGE's own script is recorded",
      labReplace.includes("/navigation-lab/route-b?step=2"),
      labReplace.join(", ")
    );

    const labHash = await labStep("hash link click", async () => {
      await lab.getByTestId("nav-hash").click();
    });
    check(
      "a hash link CLICK is recorded and keeps its fragment",
      labHash.length === 1 && labHash[0]?.endsWith("#section-2") === true,
      labHash.join(", ")
    );

    const labBack = await labStep("in-page back button", async () => {
      await lab.getByTestId("nav-back").click();
    });
    check("the page's own Back button adds no new record", labBack.length === 0, labBack.join(", "));

    const labForward = await labStep("in-page forward button", async () => {
      await lab.getByTestId("nav-forward").click();
    });
    check("the page's own Forward button adds no new record", labForward.length === 0, labForward.join(", "));

    const labReload = await labStep("in-page reload button", async () => {
      await lab.getByTestId("nav-reload").click();
      await lab.getByTestId("nav-status").waitFor();
    });
    check("the page's own Reload button adds no new record", labReload.length === 0, labReload.join(", "));

    // Cardinality, for the same reason as the matrix above: every "no new record" check is also
    // satisfied by a capture path that stopped recording entirely partway through.
    const labFinal = labSeen();
    const labExpected = [
      "/navigation-lab",
      "/navigation-lab/arrived",
      "/navigation-lab/arrived?who=alice&via=form",
      "/navigation-lab/arrived?via=redirect",
      "/navigation-lab/route-a?step=1",
      "/navigation-lab/route-b?step=2",
      "/navigation-lab/route-b?step=2#section-2"
    ].sort();
    check(
      "the lab recorded exactly these seven destinations and nothing else",
      JSON.stringify([...labFinal].sort()) === JSON.stringify(labExpected),
      `got ${JSON.stringify([...labFinal].sort())}`
    );
    check(
      "no redirect hop, about:blank, or 404 route leaked into the lab's set",
      !labFinal.some((u) => u.startsWith("about:") || u === "/navigation-lab/redirect"),
      labFinal.join(", ")
    );

    await labContext.close();
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\n${passed}/${passed + failed} recorder navigation checks passed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("verify-recorder-navigation crashed", e);
  process.exit(1);
});
