/**
 * verify:visual-capture — Phase N, N0 (awkit-vra.1): visual capture foundation on real Chromium.
 *
 * Drives `captureViewport` / `captureElement` against the Feature Test Lab's /visual-intelligence page at device scale
 * factors 1, 1.5 and 2 and asserts, against bounds computed independently from the fixture's own CSS:
 *   - viewport, element and context crops, and their device-pixel mapping (every pixel of a solid fixture is its fill);
 *   - fractional bounds round outward; CSS zoom; a same-origin iframe; a popup page; a clipped and an offscreen target;
 *   - the error taxonomy (not unique, no match, zero size, not rendered, offscreen, moved during capture, wrong page,
 *     closed page, cancelled, budget exhausted);
 *   - protected refusal: the account route, an injected credential frame, protected step types and a handed-off
 *     session, and a credential frame that appears only AFTER the screenshot;
 *   - no side effects: no click, key, focus or scroll on the page, and no request leaves the local mock site;
 *   - a capture's JSON form omits image bytes; evidence holds no image at all.
 *
 * Mutation controls (each must flip the check it guards):
 *   - DPR scaling removed: cropping the same screenshot with scale 1 at DPR 2 must FAIL the exact-pixel predicate;
 *   - post-capture recheck skipped: a guard that only checks once must let the late credential frame through.
 *
 * Run: npm run verify:visual-capture
 */

import { spawn } from "node:child_process";

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { captureElement, captureViewport, type VisualCrop } from "@src/visual/capture";
import type { VisualResult } from "@src/visual/errors";
import { clampPixelRect, cssRectToPixelRect, type CssRect } from "@src/visual/geometry";
import { cropImage, type VisualImage } from "@src/visual/png";
import { checkProtectedSurface, type ProtectedGuardVerdict } from "@src/visual/protectedGuard";
import { buildVisualEvidence } from "@src/visual/visualEvidence";

const PORT = 4423;
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 800, height: 600 };

let passed = 0;
let failed = 0;

function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const keepAlive = setInterval(() => undefined, 1_000);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function outcome(result: VisualResult<unknown>): string {
  return result.ok ? "ok" : result.code;
}

type Rgb = readonly [number, number, number];
const RED: Rgb = [255, 0, 0];
const GREEN: Rgb = [0, 160, 0];
const ORANGE: Rgb = [255, 136, 0];
const BLUE: Rgb = [0, 0, 255];
const MAGENTA: Rgb = [255, 0, 255];
const CYAN: Rgb = [0, 255, 255];

function pixelIs(image: VisualImage, x: number, y: number, rgb: Rgb, tolerance = 1): boolean {
  const p = (y * image.width + x) * 4;
  return (
    Math.abs(image.data[p] - rgb[0]) <= tolerance &&
    Math.abs(image.data[p + 1] - rgb[1]) <= tolerance &&
    Math.abs(image.data[p + 2] - rgb[2]) <= tolerance &&
    image.data[p + 3] === 255
  );
}

/** Every pixel of the image (optionally inset) is the fill. */
function solid(image: VisualImage, rgb: Rgb, inset = 0): boolean {
  if (image.width <= 2 * inset || image.height <= 2 * inset) return false;
  for (let y = inset; y < image.height - inset; y++) {
    for (let x = inset; x < image.width - inset; x++) if (!pixelIs(image, x, y, rgb)) return false;
  }
  return true;
}

/** The exact-pixel predicate the mapping checks rely on: right size AND every pixel the fill. */
function exactSolidCrop(image: VisualImage, rgb: Rgb, width: number, height: number): boolean {
  return image.width === width && image.height === height && solid(image, rgb);
}

function near(a: number, b: number, tolerance = 0.01): boolean {
  return Math.abs(a - b) <= tolerance;
}

function rectNear(a: CssRect, b: CssRect, tolerance = 0.01): boolean {
  return near(a.x, b.x, tolerance) && near(a.y, b.y, tolerance) && near(a.width, b.width, tolerance) && near(a.height, b.height, tolerance);
}

/** The device-pixel rect must cover the requested CSS rect completely (outward rounding). */
function covers(crop: VisualCrop, scale: number): boolean {
  const r = crop.requestedBounds;
  const a = crop.actualBounds;
  return a.x <= r.x * scale + 1e-6 && a.y <= r.y * scale + 1e-6 && a.x + a.width >= (r.x + r.width) * scale - 1e-6 && a.y + a.height >= (r.y + r.height) * scale - 1e-6;
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`${BASE}/visual-intelligence`);
      if (res.ok) return;
    } catch {
      // Not up yet.
    }
    await sleep(100);
  }
  throw new Error("mock site did not start");
}

async function openLab(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/visual-intelligence`);
  await page.frameLocator('[data-testid="vi-frame"]').getByTestId("vi-frame-target").waitFor();
  return page;
}

async function interactions(page: Page): Promise<{ count: number; scrollY: number }> {
  return page.evaluate("({ count: window.__visualLab.interactions, scrollY: window.scrollY })") as Promise<{ count: number; scrollY: number }>;
}

async function injectAccountFrame(page: Page): Promise<void> {
  await page.evaluate("window.__visualLab.injectAccountFrame()");
  await page.frameLocator('[data-testid="vi-account-frame"]').locator('input[type="password"]').waitFor();
}

const server = spawn(process.execPath, ["mock-site/server.mjs"], {
  env: { ...process.env, MOCK_SITE_PORT: String(PORT) },
  stdio: ["ignore", "ignore", "inherit"],
  windowsHide: true
});

let browser: Browser | undefined;
try {
  await waitForServer();
  browser = await chromium.launch();

  const offSite: string[] = [];

  for (const dpr of [1, 1.5, 2]) {
    console.log(`\nDevice scale factor ${dpr}:\n`);
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: dpr });
    context.on("request", (request) => {
      if (!request.url().startsWith(BASE) && !request.url().startsWith("about:")) offSite.push(request.url());
    });
    const page = await openLab(context);
    const before = await interactions(page);

    const viewport = await captureViewport(page);
    check("viewport capture succeeds", viewport.ok, outcome(viewport));
    if (viewport.ok) {
      const v = viewport.value;
      check("the screenshot is the viewport at device scale", v.image.width === VIEWPORT.width * dpr && v.image.height === VIEWPORT.height * dpr, `${v.image.width}x${v.image.height}`);
      check("the measured scale is the device scale factor on both axes", v.viewport.scaleX === dpr && v.viewport.scaleY === dpr && v.viewport.devicePixelRatio === dpr, JSON.stringify(v.viewport));
      check("the calibration fill is where its CSS puts it", pixelIs(v.image, Math.floor(70 * dpr), Math.floor(50 * dpr), RED) && pixelIs(v.image, Math.floor(10 * dpr), Math.floor(10 * dpr), [255, 255, 255]));
      const json = JSON.stringify(v);
      check("the capture's JSON form omits the image bytes", json.length < 1000 && json.includes("[omitted]"), `${json.length} chars`);
    }

    const red = await captureElement(page, page.getByTestId("vi-cal-red"));
    check("element capture succeeds", red.ok, outcome(red));
    if (red.ok) {
      const crop = red.value.element;
      check("requested bounds are the element's CSS box", rectNear(crop.requestedBounds, { x: 20, y: 20, width: 100, height: 60 }), JSON.stringify(crop.requestedBounds));
      check(
        "actual bounds are that box in device pixels",
        crop.actualBounds.x === 20 * dpr && crop.actualBounds.y === 20 * dpr && crop.actualBounds.width === 100 * dpr && crop.actualBounds.height === 60 * dpr,
        JSON.stringify(crop.actualBounds)
      );
      check("every pixel of the element crop is the fill", exactSolidCrop(crop.image, RED, 100 * dpr, 60 * dpr));
      check("the element crop is not clipped", crop.wasClipped === false);
      check("the frame is the main frame", red.value.frame.isMainFrame && red.value.frame.depth === 0);

      const context24 = red.value.context;
      check("a context crop is produced by default", !!context24);
      if (context24) {
        check("the context request is the box padded by 24 CSS px", rectNear(context24.requestedBounds, { x: -4, y: -4, width: 148, height: 108 }), JSON.stringify(context24.requestedBounds));
        check("...clipped at the viewport's top-left edge", context24.wasClipped && rectNear(context24.actualCssBounds, { x: 0, y: 0, width: 144, height: 104 }), JSON.stringify(context24.actualCssBounds));
        check("...and it contains the element's fill at the element's offset", pixelIs(context24.image, 70 * dpr, 50 * dpr, RED) && pixelIs(context24.image, 2 * dpr, 2 * dpr, [255, 255, 255]));
      }

      const evidence = buildVisualEvidence(red.value);
      const evidenceJson = evidence.ok ? JSON.stringify(evidence.value) : "";
      check("evidence builds within its size ceiling and holds no image", evidence.ok && evidenceJson.length <= 4096 && !evidenceJson.includes("[omitted]") && !/"data"/.test(evidenceJson), `${evidenceJson.length} chars`);
    }

    const noContext = await captureElement(page, page.getByTestId("vi-cal-red"), { contextPaddingCss: 0 });
    check("padding 0 omits the context crop", noContext.ok && noContext.value.context === undefined);

    if (dpr === 2 && viewport.ok) {
      // Mutation: the same screenshot, cropped as if DPR were 1. The exact-pixel predicate must reject it.
      const box = { x: 20, y: 20, width: 100, height: 60 };
      const unscaled = clampPixelRect(cssRectToPixelRect(box, { scaleX: 1, scaleY: 1 }), viewport.value.image.width, viewport.value.image.height);
      const mutant = unscaled ? cropImage(viewport.value.image, unscaled.rect) : null;
      check("MUTATION: removing DPR scaling fails the exact-pixel check", !!mutant && !exactSolidCrop(mutant, RED, 100 * dpr, 60 * dpr) && !solid(mutant, RED));
      const scaled = clampPixelRect(cssRectToPixelRect(box, { scaleX: dpr, scaleY: dpr }), viewport.value.image.width, viewport.value.image.height);
      check("...while the scaled crop of the same screenshot passes it", !!scaled && exactSolidCrop(cropImage(viewport.value.image, scaled.rect), RED, 100 * dpr, 60 * dpr));
    }

    const fraction = await captureElement(page, page.getByTestId("vi-cal-fraction"));
    check("a fractional box is captured", fraction.ok, outcome(fraction));
    if (fraction.ok) {
      const crop = fraction.value.element;
      check("its requested bounds keep the fractions", rectNear(crop.requestedBounds, { x: 140.5, y: 20.25, width: 50.5, height: 30.75 }, 0.02), JSON.stringify(crop.requestedBounds));
      check("its device-pixel crop rounds outward to cover the whole box", covers(crop, dpr) && crop.actualBounds.width <= Math.ceil(50.5 * dpr) + 1, JSON.stringify(crop.actualBounds));
      check("its interior is the fill", solid(crop.image, GREEN, 2));
    }

    const zoom = await captureElement(page, page.getByTestId("vi-zoom-inner"));
    check("a CSS-zoomed box maps to its zoomed size", zoom.ok && rectNear(zoom.value.element.requestedBounds, { x: 260, y: 20, width: 60, height: 60 }) && exactSolidCrop(zoom.value.element.image, ORANGE, 60 * dpr, 60 * dpr), zoom.ok ? JSON.stringify(zoom.value.element.requestedBounds) : outcome(zoom));

    const framed = await captureElement(page, page.frameLocator('[data-testid="vi-frame"]').getByTestId("vi-frame-target"));
    check("an iframe target is captured", framed.ok, outcome(framed));
    if (framed.ok) {
      check("its frame is reported as a depth-1 child", !framed.value.frame.isMainFrame && framed.value.frame.depth === 1);
      check("its bounds are mapped into the main viewport (frame origin + target offset)", rectNear(framed.value.element.requestedBounds, { x: 390, y: 40, width: 80, height: 40 }), JSON.stringify(framed.value.element.requestedBounds));
      check("every pixel of the frame crop is the frame target's fill", exactSolidCrop(framed.value.element.image, BLUE, 80 * dpr, 40 * dpr));
    }

    const clipped = await captureElement(page, page.getByTestId("vi-clipped"), { contextPaddingCss: 0 });
    check("a half-visible target is captured", clipped.ok, outcome(clipped));
    if (clipped.ok) {
      const crop = clipped.value.element;
      check("...flagged wasClipped", crop.wasClipped === true);
      check("...cut at the viewport edge", near(crop.actualCssBounds.x + crop.actualCssBounds.width, VIEWPORT.width, 1 / dpr) && near(crop.actualCssBounds.width, 50, 1 / dpr), JSON.stringify(crop.actualCssBounds));
      check("...and the visible part is the fill", solid(crop.image, CYAN));
    }

    const after = await interactions(page);
    check("no capture clicked, typed, focused or scrolled the page", after.count === before.count && after.scrollY === before.scrollY && after.scrollY === 0, JSON.stringify({ before, after }));
    await context.close();
  }

  console.log("\nError taxonomy:\n");
  {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await openLab(context);
    check("more than one match is TARGET_NOT_UNIQUE", outcome(await captureElement(page, page.locator(".vi-row-open"))) === "TARGET_NOT_UNIQUE");
    check("no match is TARGET_STALE", outcome(await captureElement(page, page.getByTestId("vi-not-on-the-page"))) === "TARGET_STALE");
    check("a zero-size box is INVALID_BOUNDS", outcome(await captureElement(page, page.getByTestId("vi-cal-zero"))) === "INVALID_BOUNDS");
    check("a box that is not rendered is INVALID_BOUNDS", outcome(await captureElement(page, page.getByTestId("vi-cal-none"))) === "INVALID_BOUNDS");
    check("a target below the fold is TARGET_OFFSCREEN (never scrolled to)", outcome(await captureElement(page, page.getByTestId("vi-offscreen"))) === "TARGET_OFFSCREEN" && (await page.evaluate("window.scrollY")) === 0);

    const moved = await captureElement(page, page.getByTestId("vi-mover"), {}, { afterScreenshot: (p) => p.evaluate("window.__visualLab.moveMover()").then(() => undefined) });
    check("a target that moves during capture is TARGET_STALE, not a crop of the old box", outcome(moved) === "TARGET_STALE", outcome(moved));

    const controller = new AbortController();
    controller.abort();
    check("an aborted signal is CANCELLED", outcome(await captureViewport(page, { signal: controller.signal })) === "CANCELLED");
    const slowGuard = async (): Promise<ProtectedGuardVerdict> => {
      await sleep(400);
      return { protected: false };
    };
    const started = Date.now();
    const exhausted = await captureViewport(page, { timeoutMs: 150 }, { guard: slowGuard });
    check("a call over budget is BUDGET_EXHAUSTED, inside the budget", outcome(exhausted) === "BUDGET_EXHAUSTED" && Date.now() - started < 400, `${outcome(exhausted)} after ${Date.now() - started} ms`);

    console.log("\nActive page, popup and wrong page:\n");
    const [popup] = await Promise.all([page.waitForEvent("popup"), page.getByTestId("vi-open-popup").click()]);
    await popup.getByTestId("vi-popup-target").waitFor();
    const popupCapture = await captureElement(popup, popup.getByTestId("vi-popup-target"));
    check("the popup's target is captured from the popup page", popupCapture.ok && exactSolidCrop(popupCapture.value.element.image, MAGENTA, 120, 50), outcome(popupCapture));
    const parentAfterPopup = await captureViewport(page);
    check("the parent page still captures its own pixels while the popup is open", parentAfterPopup.ok && pixelIs(parentAfterPopup.value.image, 70, 50, RED));
    check("a locator from another page is FRAME_MAPPING_FAILED", outcome(await captureElement(page, popup.getByTestId("vi-popup-target"))) === "FRAME_MAPPING_FAILED");
    await popup.close();
    check("a closed page is PAGE_CLOSED", outcome(await captureViewport(popup)) === "PAGE_CLOSED");
    await context.close();
  }

  console.log("\nProtected surfaces:\n");
  {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await openLab(context);
    const plain = await checkProtectedSurface(page);
    check("NEGATIVE CONTROL: the lab itself is not a protected surface", plain.protected === false, JSON.stringify(plain));
    check("...so captures on it succeed", (await captureViewport(page)).ok);

    const account = await context.newPage();
    await account.goto(`${BASE}/visual-intelligence/account`);
    check("the account route's viewport is refused", outcome(await captureViewport(account)) === "PROTECTED_SURFACE");
    check("an ordinary button on the account route is refused too", outcome(await captureElement(account, account.getByTestId("vi-account-continue"))) === "PROTECTED_SURFACE");

    await injectAccountFrame(page);
    check("an injected credential frame refuses the whole page", outcome(await captureViewport(page)) === "PROTECTED_SURFACE");
    check("...including a target outside that frame", outcome(await captureElement(page, page.getByTestId("vi-cal-red"))) === "PROTECTED_SURFACE");
    await page.evaluate("window.__visualLab.removeAccountFrame()");
    check("removing the frame lifts the refusal", (await captureViewport(page)).ok);

    for (const stepType of ["protectedLoginHandoff", "autoSecureLogin", "reuseSession"]) {
      check(`step type ${stepType} is refused before the page is read`, outcome(await captureViewport(page, { stepType })) === "PROTECTED_SURFACE");
    }
    check("a handed-off session is refused", outcome(await captureElement(page, page.getByTestId("vi-cal-red"), { handedOff: true })) === "PROTECTED_SURFACE");
    check("NEGATIVE CONTROL: an ordinary step type is not refused", (await captureViewport(page, { stepType: "click" })).ok);

    const late = { afterScreenshot: (p: Page) => injectAccountFrame(p) };
    const lateViewport = await captureViewport(page, {}, late);
    check("a credential frame that appears after the screenshot is still refused", outcome(lateViewport) === "PROTECTED_SURFACE" && !lateViewport.ok && lateViewport.message.includes("after capture"), lateViewport.ok ? "ok" : lateViewport.message);
    await page.evaluate("window.__visualLab.removeAccountFrame()");
    const lateElement = await captureElement(page, page.getByTestId("vi-cal-red"), {}, late);
    check("...for an element capture too", outcome(lateElement) === "PROTECTED_SURFACE");
    await page.evaluate("window.__visualLab.removeAccountFrame()");

    // Mutation: a guard that only checks before the screenshot (the recheck skipped) must let the late frame through.
    let calls = 0;
    const checkOnce = (p: Page): Promise<ProtectedGuardVerdict> => (calls++ === 0 ? checkProtectedSurface(p) : Promise.resolve({ protected: false }));
    const mutant = await captureViewport(page, {}, { ...late, guard: checkOnce });
    check("MUTATION: skipping the post-capture recheck lets the late frame through (so the case discriminates)", mutant.ok && calls === 2, outcome(mutant));
    await context.close();
  }

  check("no request left the local mock site", offSite.length === 0, offSite.join(", "));
} catch (error) {
  failed += 1;
  console.error(error);
} finally {
  if (browser) await browser.close().catch(() => undefined);
  server.kill();
  clearInterval(keepAlive);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
