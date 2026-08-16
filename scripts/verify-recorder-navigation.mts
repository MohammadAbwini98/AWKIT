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
