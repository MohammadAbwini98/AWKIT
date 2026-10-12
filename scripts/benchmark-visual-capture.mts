/**
 * benchmark:visual-capture — Phase N informational performance baseline (awkit-vra.1 / awkit-vra.3.1).
 *
 * Times the library-only Visual Intelligence path on the Feature Test Lab's /visual-intelligence page on real Chromium
 * at DPR 1 and 2: viewport capture, element capture (with its context crop), fingerprinting a viewport and an element
 * image, and one comparison. Reports median and p95 per operation. INFORMATIONAL: nothing is asserted, nothing is
 * written to disk, and no image leaves the process. Timings depend on the host; compare runs on the same machine only.
 *
 * Run: npm run benchmark:visual-capture [-- --iterations 30]
 */

import { spawn } from "node:child_process";

import { chromium, type Browser } from "playwright";

import { captureElement, captureViewport } from "@src/visual/capture";
import { compareVisualFingerprints } from "@src/visual/compare";
import { fingerprintVisualImage } from "@src/visual/fingerprint";

const PORT = 4425;
const BASE = `http://127.0.0.1:${PORT}`;
const flag = process.argv.indexOf("--iterations");
const ITERATIONS = flag > 0 ? Math.max(5, Number(process.argv[flag + 1]) || 20) : 20;

const keepAlive = setInterval(() => undefined, 1_000);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function summarise(samples: number[]): string {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return `median ${at(0.5).toFixed(2)} ms  p95 ${at(0.95).toFixed(2)} ms  (n=${sorted.length})`;
}

async function time(fn: () => unknown | Promise<unknown>): Promise<number[]> {
  await fn(); // warm-up, not counted
  const samples: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const started = performance.now();
    await fn();
    samples.push(performance.now() - started);
  }
  return samples;
}

const server = spawn(process.execPath, ["mock-site/server.mjs"], {
  env: { ...process.env, MOCK_SITE_PORT: String(PORT) },
  stdio: ["ignore", "ignore", "inherit"],
  windowsHide: true
});

let browser: Browser | undefined;
let exitCode = 0;
try {
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch(`${BASE}/visual-intelligence`)).ok) break;
    } catch {
      // Not up yet.
    }
    await sleep(100);
  }
  browser = await chromium.launch();
  console.log(`\nVisual Intelligence baseline — ${ITERATIONS} iterations per operation, 800x600 viewport\n`);
  for (const dpr of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    await page.goto(`${BASE}/visual-intelligence`);
    await page.frameLocator('[data-testid="vi-frame"]').getByTestId("vi-frame-target").waitFor();
    const target = page.getByTestId("vi-render-base");

    const viewport = await captureViewport(page);
    const element = await captureElement(page, target);
    if (!viewport.ok || !element.ok) throw new Error("baseline capture failed");
    const viewportPrint = fingerprintVisualImage(viewport.value.image);
    const elementPrint = fingerprintVisualImage(element.value.element.image);
    if (!viewportPrint.ok || !elementPrint.ok) throw new Error("baseline fingerprint failed");

    console.log(`DPR ${dpr}:`);
    console.log(`  captureViewport          ${summarise(await time(() => captureViewport(page)))}`);
    console.log(`  captureElement+context   ${summarise(await time(() => captureElement(page, target)))}`);
    console.log(`  fingerprint viewport     ${summarise(await time(() => fingerprintVisualImage(viewport.value.image)))}`);
    console.log(`  fingerprint element      ${summarise(await time(() => fingerprintVisualImage(element.value.element.image)))}`);
    console.log(`  compare                  ${summarise(await time(() => compareVisualFingerprints(viewportPrint.value, elementPrint.value)))}`);
    console.log(`  fingerprint JSON         ${JSON.stringify(viewportPrint.value).length} bytes (viewport), ${JSON.stringify(elementPrint.value).length} bytes (element)\n`);
    await context.close();
  }
} catch (error) {
  exitCode = 1;
  console.error(error);
} finally {
  if (browser) await browser.close().catch(() => undefined);
  server.kill();
  clearInterval(keepAlive);
}
process.exit(exitCode);
