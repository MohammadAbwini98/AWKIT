/**
 * benchmark:visual-sync-cost — DIAGNOSTIC ONLY (2026-11-01). Times the synchronous pixel phases the N5 diagnosis runs on
 * one guarded frame (N0 capture including its PNG decode, the whole-viewport crop, the viewport fingerprint), headless
 * and headed at DPR 1, 1.25 and 2, on the Visual Rows Lab. Read-only: no record, no store, no evidence file. It sizes
 * the deadline fix's synchronous reserve from measurement instead of a guess. 2026-11-01 (awkit-vra.18): it also times N9's
 * state features and motion plane on the Visual State Lab's animated `skeleton-shimmer` fixture.
 *
 * Run: npm run benchmark:visual-sync-cost
 */

import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { MEASURED_VISUAL_STATE_POLICY, captureVisualFrame, cropFromVisualFrame, decodePng, fingerprintVisualImage, measureVisualMotionPlane, measureVisualStateFrame, releaseVisualFrame } from "@src/visual";

const PORT = 4617;
const URL = `http://127.0.0.1:${PORT}/visual-intelligence/rows`;
const STATE_URL = `http://127.0.0.1:${PORT}/visual-intelligence/state`;
const RUNS = 8;

const stats = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return `p50 ${s[Math.floor(s.length / 2)].toFixed(0)} max ${s[s.length - 1].toFixed(0)}`;
};

async function main(): Promise<void> {
  const server = spawn(process.execPath, ["mock-site/server.mjs"], { env: { ...process.env, MOCK_SITE_PORT: String(PORT) }, stdio: ["ignore", "ignore", "inherit"], windowsHide: true });
  try {
    for (let a = 0; a < 80 && !(await fetch(URL).then((r) => r.ok, () => false)); a += 1) await new Promise((r) => setTimeout(r, 100));
    for (const headless of [true, false]) {
      const browser = await chromium.launch({ headless });
      for (const dpr of [1, 1.25, 2]) {
        const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: dpr });
        const page = await context.newPage();
        await page.goto(URL);
        await page.evaluate(() => (window as unknown as { __rowsLab: { show(i: string, v: string): Promise<unknown> } }).__rowsLab.show("table-uniform", "b"));
        const capture: number[] = [];
        const crop: number[] = [];
        const print: number[] = [];
        let pixels = 0;
        for (let i = 0; i < RUNS; i += 1) {
          const t0 = performance.now();
          const shot = await captureVisualFrame(page, { timeoutMs: 5000, stepType: "click", handedOff: false });
          const t1 = performance.now();
          if (!shot.ok) continue;
          const frame = shot.value;
          pixels = frame.viewport.imageWidth * frame.viewport.imageHeight;
          const whole = cropFromVisualFrame(frame, { x: 0, y: 0, width: frame.viewport.cssWidth, height: frame.viewport.cssHeight }, 0);
          const t2 = performance.now();
          if (whole.ok) fingerprintVisualImage(whole.value.element.image);
          const t3 = performance.now();
          releaseVisualFrame(frame);
          capture.push(t1 - t0);
          crop.push(t2 - t1);
          print.push(t3 - t2);
        }
        console.log(
          `${headless ? "headless" : "headed"}@${dpr} (${pixels} px): capture+decode ${stats(capture)} ms; crop ${stats(crop)} ms; fingerprint ${stats(print)} ms; crop+fingerprint ns/px max ${(((Math.max(...crop.map((c, i) => c + print[i]))) * 1e6) / pixels).toFixed(0)}`
        );
        const decode: number[] = [];
        for (let i = 0; i < RUNS; i += 1) {
          const png = await page.screenshot({ type: "png", scale: "device" });
          const t0 = performance.now();
          decodePng(new Uint8Array(png.buffer, png.byteOffset, png.byteLength));
          decode.push(performance.now() - t0);
        }
        console.log(`  png decode ${stats(decode)} ms (max ${((Math.max(...decode) * 1e6) / pixels).toFixed(0)} ns/px)`);
        const statePage = await context.newPage();
        await statePage.goto(STATE_URL);
        await statePage.waitForSelector("body[data-fixtures]");
        await statePage.evaluate(() => (window as unknown as { __stateLab: { show(i: string, v: string): Promise<unknown> } }).__stateLab.show("skeleton-shimmer", "b"));
        const state: number[] = [];
        const motion: number[] = [];
        for (let i = 0; i < RUNS; i += 1) {
          const shot = await captureVisualFrame(statePage, { timeoutMs: 5000, stepType: "click", handedOff: false });
          if (!shot.ok) continue;
          const frame = shot.value;
          const whole = cropFromVisualFrame(frame, { x: 0, y: 0, width: frame.viewport.cssWidth, height: frame.viewport.cssHeight }, 0);
          if (whole.ok) {
            const t0 = performance.now();
            measureVisualStateFrame(whole.value.element.image, MEASURED_VISUAL_STATE_POLICY, frame.viewport.scaleX);
            const t1 = performance.now();
            measureVisualMotionPlane(whole.value.element.image, frame.viewport.scaleX);
            state.push(t1 - t0);
            motion.push(performance.now() - t1);
          }
          releaseVisualFrame(frame);
        }
        console.log(`  state lab: state features ${stats(state)} ms (max ${((Math.max(...state) * 1e6) / pixels).toFixed(0)} ns/px); motion plane ${stats(motion)} ms`);
        await context.close();
      }
      await browser.close();
    }
  } finally {
    server.kill();
  }
}

await main();
