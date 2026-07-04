#!/usr/bin/env tsx
/**
 * verify-popup-mock-site.mts — Multi-Window / Popup Mock Site verification
 *
 * Automatically verifies that all local mock site scenarios for popup handling
 * behave correctly, load without external dependencies, and contain stable locators.
 *
 * Usage: npm run verify:popup-mock-site
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

// ── Embedded Mock Server ─────────────────────────────────────────────────────
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
    const path = url.pathname;
    
    let file = "";
    if (path.startsWith("/mock/popup")) {
      let suffix = path.slice("/mock/popup".length);
      if (!suffix || suffix === "/") suffix = "/index.html";
      if (!suffix.endsWith(".html") && !suffix.includes(".")) suffix += ".html";
      file = `popup${suffix}`;
    } else if (path.startsWith("/popup")) {
      let suffix = path.slice("/popup".length);
      if (!suffix || suffix === "/") suffix = "/index.html";
      if (!suffix.endsWith(".html") && !suffix.includes(".")) suffix += ".html";
      file = `popup${suffix}`;
    } else if (path === "/styles.css") {
      file = "styles.css";
    }

    if (file) {
      try {
        const body = await readFile(join(publicDir, file));
        res.writeHead(200, { "Content-Type": mime[extname(file)] ?? "text/html" });
        res.end(body);
      } catch {
        res.writeHead(404); res.end("not found");
      }
    } else {
      res.writeHead(404); res.end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve(() => server.close());
    });
  });
}

// ── Test Runner ──────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗  ${name}`);
    console.log(`     ${err instanceof Error ? err.stack || err.message : String(err)}`);
    failed++;
  }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

// ── Main Suite ───────────────────────────────────────────────────────────────
async function main() {
  const PORT = 14341;
  const BASE = `http://localhost:${PORT}`;

  console.log("\n▶  verify:popup-mock-site — Validating Popup Mock Scenarios\n");

  const stopServer = await startServer(PORT);
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Setup helper to wait for popups
    let popups: Page[] = [];
    context.on("page", (p) => {
      popups.push(p);
    });

    const resetPopups = async () => {
      for (const p of popups) {
        if (!p.isClosed()) await p.close();
      }
      popups = [];
    };

    // 1. Popup mock index loads
    await test("1. Popup mock index loads", async () => {
      const res = await page.goto(`${BASE}/mock/popup`);
      assert(res?.status() === 200, "Index page failed to load");
      const text = await page.textContent("h1");
      assert(text?.includes("Popup Lab Index") ?? false, "Incorrect title");
    });

    // 2 & 3. Target blank scenario
    await test("2 & 3. Target blank scenario loads and open-terms-link exists", async () => {
      await page.goto(`${BASE}/mock/popup/target-blank`);
      const link = page.getByTestId("open-terms-link");
      assert(await link.isVisible(), "open-terms-link not visible");
      
      const popupPromise = context.waitForEvent("page");
      await link.click();
      const popup = await popupPromise;
      await popup.waitForLoadState("domcontentloaded");
      assert(popup.url().includes("terms-popup"), "Did not open terms popup");
      
      const agree = popup.getByTestId("agree-checkbox");
      assert(await agree.isVisible(), "agree-checkbox not found in popup");
      
      await resetPopups();
    });

    // 4 & 5. Window open scenario
    await test("4 & 5. Window open scenario loads and open-approval-button exists", async () => {
      await page.goto(`${BASE}/mock/popup/window-open`);
      const btn = page.getByTestId("open-approval-button");
      assert(await btn.isVisible(), "open-approval-button not visible");

      const popupPromise = context.waitForEvent("page");
      await btn.click();
      const popup = await popupPromise;
      await popup.waitForLoadState("domcontentloaded");
      assert(popup.url().includes("approval-popup"), "Did not open approval popup");

      const note = popup.getByTestId("approval-note");
      assert(await note.isVisible(), "approval-note not found in popup");

      await resetPopups();
    });

    // 6. Auto-close scenario
    await test("6. Auto-close scenario has visible countdown/status", async () => {
      await page.goto(`${BASE}/mock/popup/auto-close`);
      const btn = page.getByTestId("open-auto-close-button");
      
      const popupPromise = context.waitForEvent("page");
      await btn.click();
      const popup = await popupPromise;
      await popup.waitForLoadState("domcontentloaded");
      
      const countdown = popup.getByTestId("countdown");
      assert(await countdown.isVisible(), "countdown not visible in auto-close popup");

      // Wait for it to close
      await popup.waitForEvent("close", { timeout: 3000 });
      assert(popup.isClosed(), "Popup did not auto-close");
      
      await resetPopups();
    });

    // 7. Stays-open scenario
    await test("7. Stays-open scenario has expected controls", async () => {
      await page.goto(`${BASE}/mock/popup/stays-open`);
      const btn = page.getByTestId("open-stays-open-button");
      
      const popupPromise = context.waitForEvent("page");
      await btn.click();
      const popup = await popupPromise;
      await popup.waitForLoadState("domcontentloaded");

      const markComplete = popup.getByTestId("mark-complete-button");
      assert(await markComplete.isVisible(), "mark-complete-button not visible");
      
      const continueMain = page.getByTestId("continue-main-button");
      assert(await continueMain.isVisible(), "continue-main-button not visible");

      await resetPopups();
    });

    // 8. Multiple popup scenario
    await test("8. Multiple popup scenario has both popup opener controls", async () => {
      await page.goto(`${BASE}/mock/popup/multiple`);
      const firstBtn = page.getByTestId("open-first-popup-button");
      const secondBtn = page.getByTestId("open-second-popup-button");
      
      assert(await firstBtn.isVisible(), "First button missing");
      assert(await secondBtn.isVisible(), "Second button missing");

      let popupPromise = context.waitForEvent("page");
      await firstBtn.click();
      let popup = await popupPromise;
      await popup.waitForLoadState("domcontentloaded");
      assert(await popup.getByTestId("action-first-button").isVisible(), "First action button missing");

      popupPromise = context.waitForEvent("page");
      await secondBtn.click();
      popup = await popupPromise;
      await popup.waitForLoadState("domcontentloaded");
      assert(await popup.getByTestId("action-second-button").isVisible(), "Second action button missing");

      await resetPopups();
    });

    // 9. Failure cases page
    await test("9. Failure cases page has expected failure controls", async () => {
      await page.goto(`${BASE}/mock/popup/failure-cases`);
      assert(await page.getByTestId("no-popup-button").isVisible(), "No-popup button missing");
      assert(await page.getByTestId("wrong-url-button").isVisible(), "Wrong-url button missing");
      assert(await page.getByTestId("fast-close-button").isVisible(), "Fast-close button missing");
    });

    // 10. Smart Wait popup scenario
    await test("10. Smart Wait popup scenario has loader/delayed-content behavior", async () => {
      await page.goto(`${BASE}/mock/popup/smart-wait`);
      const btn = page.getByTestId("open-smart-wait-button");
      
      const popupPromise = context.waitForEvent("page");
      await btn.click();
      const popup = await popupPromise;
      await popup.waitForLoadState("domcontentloaded");

      const confirmBtn = popup.getByTestId("confirm-loaded-button");
      // Should not be visible initially
      assert(!(await confirmBtn.isVisible()), "Confirm button should be hidden initially");

      // Wait for it to become visible
      await confirmBtn.waitFor({ state: "visible", timeout: 3000 });
      assert(await confirmBtn.isVisible(), "Confirm button did not become visible");

      await resetPopups();
    });

    await context.close();
  } finally {
    await browser.close();
    stopServer();
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(50)}`);
  console.log(`  Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
  console.log("─".repeat(50));
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("verify:popup-mock-site crashed:", err);
  process.exit(1);
});
