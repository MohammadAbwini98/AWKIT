// App background verifier (layout/AppBackground.tsx — the emitted-light dot field).
//
// What regression makes this fail?
//   • The canvas is missing, mis-sized for the viewport × DPR, or stops being a fixed,
//     pointer-transparent layer behind the layout (z-index -1).
//   • .main-surface turns opaque again and hides the field.
//   • The base grid stops painting (a grid point is blank) or paints between dots.
//   • The dot under the pointer does not light up, or the rAF loop never parks once the pointer
//     is still (the field must cost nothing while idle).
//   • A light → dark switch does not re-read the --awkit-field-* tokens.
//
// Run: npm run verify:app-background   (requires `npm run build`)
import { _electron as electron } from "playwright";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isolatedLaunchEnv, resolveMainWindow, signInFirstRun } from "./lib/gui-verify-harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = path.join(root, "test-artifacts", "app-background");
mkdirSync(evidenceDir, { recursive: true });
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail: detail ? String(detail) : "" });
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const { env, dataRoot, cleanup } = isolatedLaunchEnv("awkit-app-background");
let app;
try {
  app = await electron.launch({ args: [root, `--user-data-dir=${path.join(dataRoot, "Roaming", "SpecterStudio")}`], cwd: root, env });
  const win = await resolveMainWindow(app);
  const consoleErrors = [];
  win.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  await win.waitForLoadState("domcontentloaded");
  await signInFirstRun(win);
  await win.setViewportSize({ width: 1280, height: 800 });
  await win.waitForSelector("canvas.app-background", { timeout: 15000 });
  // The test window runs in the background, so it renders no frame (no resize/ResizeObserver
  // delivery) until input arrives: park the pointer in the main surface's top-left corner, far
  // from the probed grid point, and let the light settle.
  const corner = await win.evaluate(() => {
    const r = document.querySelector(".main-surface").getBoundingClientRect();
    return { x: r.x + 20, y: r.y + 20 };
  });
  await win.mouse.move(corner.x, corner.y);
  await win.waitForTimeout(1500);

  const info = await win.evaluate(() => {
    const canvas = document.querySelector("canvas.app-background");
    const cs = getComputedStyle(canvas);
    const surface = document.querySelector(".main-surface");
    const r = surface.getBoundingClientRect();
    return {
      w: canvas.width, h: canvas.height, iw: innerWidth, ih: innerHeight, dpr: Math.min(2, devicePixelRatio),
      z: cs.zIndex, pos: cs.position, pe: cs.pointerEvents,
      surfaceBg: getComputedStyle(surface).backgroundColor,
      surface: { x: r.x, y: r.y, w: r.width, h: r.height }
    };
  });
  check("canvas sized to viewport × DPR (capped at 2)", info.w === Math.round(info.iw * info.dpr) && info.h === Math.round(info.ih * info.dpr), `${info.w}×${info.h} for ${info.iw}×${info.ih} @${info.dpr}`);
  check("canvas is fixed, z-index -1 and pointer-transparent", info.pos === "fixed" && info.z === "-1" && info.pe === "none", `${info.pos} z=${info.z} pe=${info.pe}`);
  check("main surface is transparent so the field shows through", info.surfaceBg === "rgba(0, 0, 0, 0)", info.surfaceBg);

  // A minor grid point (multiple of 24 CSS px, not of 120) in the middle of the main surface.
  const gx = Math.ceil((info.surface.x + info.surface.w / 2) / 120) * 120 + 24;
  const gy = Math.ceil((info.surface.y + info.surface.h / 2) / 120) * 120 + 24;
  const pixelAt = (x, y) =>
    win.evaluate(([px, py]) => {
      const canvas = document.querySelector("canvas.app-background");
      const d = Math.min(2, devicePixelRatio);
      return [...canvas.getContext("2d").getImageData(Math.round(px * d), Math.round(py * d), 1, 1).data];
    }, [x, y]);
  const base = (await pixelAt(gx, gy))[3];
  check("base dot paints at a grid point", base > 0, `alpha ${base}`);
  const gap = (await pixelAt(gx + 12, gy + 12))[3];
  check("nothing paints between dots", gap === 0, `alpha ${gap}`);

  // Count rAF calls while the pointer moves, then while it rests.
  await win.evaluate(() => {
    window.__awkitRaf = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => {
      window.__awkitRaf++;
      return raf(cb);
    };
  });
  for (let i = 0; i <= 10; i++) await win.mouse.move(gx - 60 + i * 6, gy - 30 + i * 3);
  await win.waitForTimeout(150);
  const lit = (await pixelAt(gx, gy))[3];
  check("the dot under the pointer lights up", lit > base, `alpha ${base} → ${lit}`);
  const movingFrames = await win.evaluate(() => window.__awkitRaf);
  check("the rAF loop runs while the pointer moves", movingFrames > 5, `${movingFrames} frames`);

  await win.waitForTimeout(1500);
  await win.evaluate(() => { window.__awkitRaf = 0; });
  await win.waitForTimeout(1000);
  const idleFrames = await win.evaluate(() => window.__awkitRaf);
  check("the rAF loop parks once the pointer is still", idleFrames <= 2, `${idleFrames} frames in 1s at rest`);
  const resting = (await pixelAt(gx, gy))[3];
  check("the resting pointer keeps its light after the loop parks", resting > base, `alpha ${resting}`);
  await win.screenshot({ path: path.join(evidenceDir, "app-background-light.png") });

  // Switch to dark through the real Settings control: the field must repaint with the dark tokens.
  await win.evaluate(() => [...document.querySelectorAll("button.nav-item")].find((b) => (b.textContent || "").trim() === "Settings")?.click());
  await win.waitForSelector(".settings-appearance-row select", { timeout: 15000 });
  await win.locator(".settings-appearance-row select").selectOption("dark");
  await win.waitForTimeout(400);
  const dark = await pixelAt(gx, gy);
  check("dark theme repaints the grid with light dots", dark[3] > 0 && dark[0] > 200 && dark[1] > 200 && dark[2] > 200, JSON.stringify(dark));
  await win.mouse.move(gx + 30, gy + 10);
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(evidenceDir, "app-background-dark.png") });

  check("no renderer console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
  await win.locator(".settings-appearance-row select").selectOption("light").catch(() => {});
  await win.waitForTimeout(300);
} finally {
  try {
    await app?.close();
  } catch {
    /* already closed */
  }
  cleanup();
}

const pass = results.filter((r) => r.pass).length;
const fail = results.length - pass;
console.log(`\nApp background: ${pass}/${results.length} checks passed${fail ? ` — ${fail} FAILED` : ""}`);
writeFileSync(path.join(evidenceDir, "results.json"), JSON.stringify({ pass, fail, results }, null, 2));
if (fail) process.exit(1);
