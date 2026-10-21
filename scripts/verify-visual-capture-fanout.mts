/**
 * verify:visual-capture-fanout — Phase N, N2.4 (awkit-vra.12.4): single-capture candidate fan-out on real Chromium.
 *
 * One visual decision cycle takes ONE viewport screenshot and crops every candidate from it. Against the Feature Test
 * Lab's /visual-intelligence pages this asserts, counting real `page.screenshot` calls (never the self-reported field):
 *   - 1, 4 and 20 candidates each take exactly one screenshot, and every candidate carries the same capture id;
 *   - every candidate's crop is its own region, pixel-identical to a solo `captureElement` of it, at DPR 1, 1.25 and 2;
 *     visually distinct candidates give distinct pixels, and permuting the candidate order changes nothing;
 *   - a candidate that fails (offscreen, no match, not unique, moved) fails alone, and is never recaptured;
 *   - a DOM change after the screenshot never reaches the crops: they come from the original frame;
 *   - navigation, a popup, a page close, a viewport resize, a device-pixel-ratio change, expiry and release each make
 *     the frame CAPTURE_STALE, both inside a cycle and for a frame the caller holds;
 *   - top-level, iframe and nested-iframe candidates map correctly from the one screenshot;
 *   - the protected-surface guard runs exactly twice per cycle whatever the candidate count; a protected surface before
 *     refuses the cycle without a screenshot, one after discards the whole frame;
 *   - two concurrent cycles (barrier-interleaved) each crop only their own screenshot;
 *   - every frame is released when its cycle ends, page listeners are detached, no result retains a full-size buffer,
 *     and the memory totals are consistent;
 *   - shadow only: MEASURED_FUSION_POLICY.contradictionEnabled stays false, nothing clicks, scrolls or leaves the
 *     local mock site, and the capture modules carry no input or disk-write call.
 *
 * Seams (`afterScreenshot`, `guard`, `onFrame`) come from the verifier-only `internal/captureCore` entry (N2.1).
 *
 * Mutation controls (each run on the real file and restored; recorded in docs/plans/ai-upgrade-v5/N2.4-capture-fanout.md):
 *   A one screenshot per candidate · B the first crop for every candidate · C a process-global shared frame ·
 *   D invalidation ignored · E the capture returned despite a protected post-check.
 *
 * Run: npm run verify:visual-capture-fanout
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";

import { buildCandidateEvidence } from "@src/visual/candidateEvidence";
import {
  VISUAL_FANOUT_MAX_CANDIDATES,
  captureCandidates,
  captureElement,
  captureVisualFrame,
  cropFromVisualFrame,
  releaseVisualFrame,
  validateVisualFrame,
  type VisualCandidateFanout,
  type VisualCandidateTarget,
  type VisualCaptureFrame,
  type VisualElementCapture
} from "@src/visual/capture";
// The seam-taking entry is verifier-only (N2.1): the public functions above take no seam.
import { captureCandidatesWithSeams, type VisualCaptureSeams } from "@src/visual/internal/captureCore";
import type { VisualResult } from "@src/visual/errors";
import { MEASURED_FUSION_POLICY } from "@src/visual/fusion/decideFusion";
import type { VisualImage } from "@src/visual/png";
import { checkProtectedSurface } from "@src/visual/protectedGuard";
import { VISUAL_EVIDENCE_MAX_BYTES } from "@src/visual/visualEvidence";

const PORT = 4429;
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 800, height: 600 };

let passed = 0;
let failed = 0;
const failures: string[] = [];
let section = "";

function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    failures.push(`${section}: ${label}${detail ? ` — ${detail}` : ""}`);
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
const BLUE: Rgb = [0, 0, 255];

function solid(image: VisualImage, rgb: Rgb, inset = 0): boolean {
  if (image.width <= 2 * inset || image.height <= 2 * inset) return false;
  for (let y = inset; y < image.height - inset; y++) {
    for (let x = inset; x < image.width - inset; x++) {
      const p = (y * image.width + x) * 4;
      if (Math.abs(image.data[p] - rgb[0]) > 1 || Math.abs(image.data[p + 1] - rgb[1]) > 1 || Math.abs(image.data[p + 2] - rgb[2]) > 1) return false;
    }
  }
  return true;
}

function digest(image: VisualImage): string {
  return createHash("sha256").update(`${image.width}x${image.height}:`).update(image.data).digest("hex");
}

/** Count every real screenshot the page takes, whoever asks for it. */
function countScreenshots(page: Page): { count: number } {
  const counter = { count: 0 };
  const original = page.screenshot.bind(page);
  page.screenshot = ((options?: Parameters<Page["screenshot"]>[0]) => {
    counter.count += 1;
    return original(options);
  }) as Page["screenshot"];
  return counter;
}

/** Every frame any cycle produced, so the memory section can prove each one was released. */
const seenFrames: VisualCaptureFrame[] = [];
const observe: VisualCaptureSeams["onFrame"] = (frame) => {
  seenFrames.push(frame);
};

function elements(fanout: VisualCandidateFanout): Map<string, VisualElementCapture> {
  const map = new Map<string, VisualElementCapture>();
  for (const candidate of fanout.candidates) if (candidate.result.ok) map.set(candidate.id, candidate.result.value);
  return map;
}

function codeOf(fanout: VisualCandidateFanout, id: string): string {
  const candidate = fanout.candidates.find((c) => c.id === id);
  return candidate ? outcome(candidate.result) : "missing";
}

/** The largest ArrayBuffer any typed array reachable from `value` keeps alive. */
function largestRetainedBuffer(value: unknown, seen = new Set<unknown>()): number {
  if (value === null || typeof value !== "object" || seen.has(value)) return 0;
  seen.add(value);
  if (ArrayBuffer.isView(value)) return value.buffer.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  let max = 0;
  for (const child of Object.values(value as Record<string, unknown>)) max = Math.max(max, largestRetainedBuffer(child, seen));
  return max;
}

/** Twenty visible main-page candidates of the /visual-intelligence lab, in a fixed order. */
const LAB_IDS = [
  "vi-cal-red",
  "vi-cal-fraction",
  "vi-zoom-inner",
  "vi-row-1-open",
  "vi-row-2-open",
  "vi-row-3-open",
  "vi-approve-primary",
  "vi-approve-outline",
  "vi-twin-approve",
  "vi-twin-reject",
  "vi-render-base",
  "vi-render-minor",
  "vi-geom-base",
  "vi-geom-resized",
  "vi-pos-a",
  "vi-pos-b",
  "vi-theme-light",
  "vi-theme-dark",
  "vi-icon-base",
  "vi-icon-mutated"
] as const;

/**
 * Deliberately identical controls at different places: the three Open buttons and the two Download buttons. At a whole
 * device scale factor they crop to identical pixels; at a fractional one their positions land on different sub-pixel
 * phases, so their pixels may legitimately differ.
 */
const IDENTICAL_ROWS = new Set(["vi-row-1-open", "vi-row-2-open", "vi-row-3-open"]);
const IDENTICAL_CONTROLS = new Set([...IDENTICAL_ROWS, "vi-pos-a", "vi-pos-b"]);

function labCandidates(page: Page, ids: readonly string[]): VisualCandidateTarget[] {
  return ids.map((id) => ({ id, target: page.getByTestId(id) }));
}

function frameTarget(page: Page): Locator {
  return page.frameLocator('[data-testid="vi-frame"]').getByTestId("vi-frame-target");
}

/** A deterministic permutation (seeded LCG), so a failure reproduces. */
function permute<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
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
  await frameTarget(page).waitFor();
  return page;
}

async function interactions(page: Page): Promise<{ count: number; scrollY: number }> {
  return page.evaluate("({ count: window.__visualLab.interactions, scrollY: window.scrollY })") as Promise<{ count: number; scrollY: number }>;
}

const server = spawn(process.execPath, ["mock-site/server.mjs"], {
  env: { ...process.env, MOCK_SITE_PORT: String(PORT) },
  stdio: ["ignore", "ignore", "inherit"],
  windowsHide: true
});

let browser: Browser | undefined;
const offSite: string[] = [];
const watchRequests = (context: BrowserContext): void => {
  context.on("request", (request) => {
    if (!request.url().startsWith(BASE) && !request.url().startsWith("about:")) offSite.push(request.url());
  });
};
const newContext = async (deviceScaleFactor = 1): Promise<BrowserContext> => {
  const context = await browser!.newContext({ viewport: VIEWPORT, deviceScaleFactor });
  watchRequests(context);
  return context;
};

try {
  await waitForServer();
  browser = await chromium.launch();

  // -------------------------------------------------------------------------------------------------------------
  // Screenshot count, shared identity, crop correctness and order independence, at three device scale factors.
  for (const dpr of [1, 1.25, 2]) {
    section = `fan-out DPR ${dpr}`;
    console.log(`\nFan-out at DPR ${dpr}:\n`);
    const context = await newContext(dpr);
    const page = await openLab(context);
    const shots = countScreenshots(page);
    const baseline = await interactions(page);

    for (const size of [1, 4, 20]) {
      const before = shots.count;
      const result = await captureCandidatesWithSeams(page, labCandidates(page, LAB_IDS.slice(0, size)), {}, { onFrame: observe });
      const taken = shots.count - before;
      check(`${size} candidate(s): exactly one real screenshot`, result.ok && taken === 1, `outcome ${outcome(result)}, ${taken} screenshots`);
      if (!result.ok) continue;
      const fanout = result.value;
      check(`${size} candidate(s): the result reports one screenshot`, fanout.screenshots === 1);
      check(`${size} candidate(s): one result per candidate, in input order`, fanout.candidates.length === size && fanout.candidates.every((c, i) => c.id === LAB_IDS[i]));
      const ok = fanout.candidates.filter((c) => c.result.ok);
      check(`${size} candidate(s): every candidate succeeded`, ok.length === size, fanout.candidates.map((c) => `${c.id}=${outcome(c.result)}`).join(", "));
      check(
        `${size} candidate(s): every candidate carries the cycle's single capture id`,
        typeof fanout.captureId === "string" && fanout.captureId.length > 0 && new Set(fanout.candidates.map((c) => c.captureId)).size === 1 && fanout.candidates[0].captureId === fanout.captureId
      );
      check(`${size} candidate(s): every crop is stamped with the frame's capture time`, ok.every((c) => c.result.ok && c.result.value.capturedAt === fanout.capturedAt));
    }

    // Twenty candidates against twenty solo captures (each its own screenshot) of the same static page.
    const fanoutResult = await captureCandidatesWithSeams(page, labCandidates(page, LAB_IDS), {}, { onFrame: observe });
    const fanout = fanoutResult.ok ? fanoutResult.value : null;
    check("the 20-candidate cycle succeeded", fanout !== null, outcome(fanoutResult));
    const fanned = fanout ? elements(fanout) : new Map<string, VisualElementCapture>();
    check("cardinality: 20 element crops to compare", fanned.size === 20, `${fanned.size}`);

    const soloDigests = new Map<string, { element: string; context: string | null; bounds: string }>();
    // A solo capture that is refused names its id, code and fixed refusal text (the guard's reason, never page content).
    const soloRefusals: string[] = [];
    for (const id of LAB_IDS) {
      const solo = await captureElement(page, page.getByTestId(id));
      if (solo.ok) {
        soloDigests.set(id, {
          element: digest(solo.value.element.image),
          context: solo.value.context ? digest(solo.value.context.image) : null,
          bounds: JSON.stringify(solo.value.element.actualBounds)
        });
      } else {
        soloRefusals.push(`${id}: ${outcome(solo)} (${solo.message})`);
      }
    }
    check("cardinality: 20 solo captures", soloDigests.size === 20, `${soloDigests.size}${soloRefusals.length ? `; refused ${soloRefusals.join("; ")}` : ""}`);
    const mismatched = LAB_IDS.filter((id) => {
      const shared = fanned.get(id);
      const solo = soloDigests.get(id);
      if (!shared || !solo) return true;
      return (
        digest(shared.element.image) !== solo.element ||
        (shared.context ? digest(shared.context.image) : null) !== solo.context ||
        JSON.stringify(shared.element.actualBounds) !== solo.bounds
      );
    });
    check("every shared crop (element AND context) is pixel-identical to that element's solo capture", mismatched.length === 0, mismatched.join(", "));

    const boundsSet = new Set([...fanned.values()].map((c) => JSON.stringify(c.element.actualBounds)));
    check("crops differ correctly: 20 candidates, 20 distinct device-pixel regions", boundsSet.size === 20, `${boundsSet.size}`);
    const distinctIds = LAB_IDS.filter((id) => !IDENTICAL_CONTROLS.has(id));
    const distinctDigests = new Set(distinctIds.map((id) => (fanned.get(id) ? digest(fanned.get(id)!.element.image) : `missing-${id}`)));
    check(`crops differ correctly: the ${distinctIds.length} visually distinct candidates give ${distinctIds.length} distinct pixel crops`, distinctIds.length === 15 && distinctDigests.size === distinctIds.length, `${distinctDigests.size}`);
    const rowElement = new Set([...IDENTICAL_ROWS].map((id) => (fanned.get(id) ? digest(fanned.get(id)!.element.image) : `missing-${id}`)));
    const rowContext = new Set([...IDENTICAL_ROWS].map((id) => (fanned.get(id)?.context ? digest(fanned.get(id)!.context!.image) : `missing-${id}`)));
    check("the three identical Open buttons have three distinct contexts (Row 1/2/3)", rowContext.size === 3, `context ${rowContext.size}`);
    if (Number.isInteger(dpr)) {
      check("at a whole DPR the three identical Open buttons crop to identical pixels", rowElement.size === 1, `rows ${rowElement.size}`);
      // Measured, not asserted: at DPR 2 the two Download buttons (far apart on the page) rasterize differently, while
      // each still equals its own solo capture above — a renderer property, not a crop defect.
      const posElement = new Set(["vi-pos-a", "vi-pos-b"].map((id) => (fanned.get(id) ? digest(fanned.get(id)!.element.image) : `missing-${id}`)));
      console.log(`    info: the two Download buttons give ${posElement.size} distinct crop(s) at DPR ${dpr}`);
    }
    const red = fanned.get("vi-cal-red");
    if (Number.isInteger(dpr)) {
      check("vi-cal-red's crop is its own solid red box at the mapped size", !!red && red.element.image.width === 100 * dpr && red.element.image.height === 60 * dpr && solid(red.element.image, RED));
    }

    // Order independence: the same candidates in two other orders give the same per-id pixels, in input order.
    for (const seed of [7, 1012]) {
      const order = permute(LAB_IDS, seed);
      const before = shots.count;
      const permuted = await captureCandidatesWithSeams(page, labCandidates(page, order), {}, { onFrame: observe });
      const taken = shots.count - before;
      const ids = permuted.ok ? permuted.value.candidates.map((c) => c.id) : [];
      const map = permuted.ok ? elements(permuted.value) : new Map<string, VisualElementCapture>();
      const differs = order.filter((id) => !map.get(id) || !fanned.get(id) || digest(map.get(id)!.element.image) !== digest(fanned.get(id)!.element.image));
      check(`order permutation (seed ${seed}): one screenshot, results in the new input order`, permuted.ok && taken === 1 && ids.join() === order.join());
      check(`order permutation (seed ${seed}): every candidate's pixels are unchanged`, map.size === 20 && differs.length === 0, differs.join(", "));
    }

    const after = await interactions(page);
    check("no click, key, focus or scroll reached the page", after.count === baseline.count && after.count === 0 && after.scrollY === 0, JSON.stringify(after));
    await context.close();
  }

  const context = await newContext(1);

  // -------------------------------------------------------------------------------------------------------------
  section = "candidate failures";
  console.log("\nCandidate-scoped failures (never a recapture):\n");
  {
    const page = await openLab(context);
    const shots = countScreenshots(page);
    const candidates: VisualCandidateTarget[] = [
      { id: "red", target: page.getByTestId("vi-cal-red") },
      { id: "offscreen", target: page.getByTestId("vi-offscreen") },
      { id: "missing", target: page.getByTestId("vi-does-not-exist") },
      { id: "ambiguous", target: page.locator(".vi-row-open") },
      { id: "hidden", target: page.getByTestId("vi-cal-none") },
      { id: "clipped", target: page.getByTestId("vi-clipped") },
      { id: "mover", target: page.getByTestId("vi-mover") },
      { id: "frame", target: frameTarget(page) }
    ];
    const result = await captureCandidatesWithSeams(page, candidates, {}, {
      onFrame: observe,
      afterScreenshot: async (p) => {
        await p.evaluate("window.__visualLab.moveMover()");
      }
    });
    check("a cycle with failing candidates still takes exactly one screenshot", result.ok && shots.count === 1, `${outcome(result)}, ${shots.count}`);
    if (result.ok) {
      const f = result.value;
      check("the offscreen candidate alone fails TARGET_OFFSCREEN", codeOf(f, "offscreen") === "TARGET_OFFSCREEN", codeOf(f, "offscreen"));
      check("the missing candidate alone fails TARGET_STALE", codeOf(f, "missing") === "TARGET_STALE", codeOf(f, "missing"));
      check("the ambiguous candidate alone fails TARGET_NOT_UNIQUE", codeOf(f, "ambiguous") === "TARGET_NOT_UNIQUE", codeOf(f, "ambiguous"));
      check("the hidden candidate alone fails (never cropped)", codeOf(f, "hidden") !== "ok" && codeOf(f, "hidden") !== "missing", codeOf(f, "hidden"));
      check("the candidate that moved after the screenshot alone fails TARGET_STALE", codeOf(f, "mover") === "TARGET_STALE", codeOf(f, "mover"));
      check("the valid candidates are unaffected", codeOf(f, "red") === "ok" && codeOf(f, "clipped") === "ok" && codeOf(f, "frame") === "ok");
      const clipped = elements(f).get("clipped");
      check("the clipped candidate is cut at the viewport edge and flagged", !!clipped && clipped.element.wasClipped === true);
      check("failed candidates still carry the cycle's capture id", f.candidates.every((c) => c.captureId === f.captureId));
    }

    const none = await captureCandidatesWithSeams(page, [{ id: "a", target: page.getByTestId("vi-offscreen") }, { id: "b", target: page.getByTestId("vi-does-not-exist") }], {}, { onFrame: observe });
    check("when no candidate resolves, NO screenshot is taken", none.ok && none.value.screenshots === 0 && none.value.captureId === null && shots.count === 1, `${outcome(none)}, ${shots.count}`);

    const tooMany = Array.from({ length: VISUAL_FANOUT_MAX_CANDIDATES + 1 }, (_, i) => ({ id: `c${i}`, target: page.getByTestId("vi-cal-red") }));
    const invalid: [string, VisualCandidateTarget[]][] = [
      ["duplicate ids", [{ id: "x", target: page.getByTestId("vi-cal-red") }, { id: "x", target: page.getByTestId("vi-pos-a") }]],
      ["an empty id", [{ id: "", target: page.getByTestId("vi-cal-red") }]],
      [`${VISUAL_FANOUT_MAX_CANDIDATES + 1} candidates (over the bound)`, tooMany]
    ];
    for (const [label, list] of invalid) {
      const before = shots.count;
      const refused = await captureCandidates(page, list);
      check(`a candidate list with ${label} is CAPTURE_UNAVAILABLE without a screenshot`, outcome(refused) === "CAPTURE_UNAVAILABLE" && shots.count === before, `${outcome(refused)}`);
    }
    await page.close();
  }

  // -------------------------------------------------------------------------------------------------------------
  section = "DOM mutation";
  console.log("\nDOM mutation after the screenshot:\n");
  {
    const page = await openLab(context);
    const shots = countScreenshots(page);
    const result = await captureCandidatesWithSeams(page, labCandidates(page, ["vi-cal-red", "vi-pos-a"]), {}, {
      onFrame: observe,
      afterScreenshot: async (p) => {
        await p.evaluate("document.querySelector(\"[data-testid='vi-cal-red']\").style.background = '#0000ff'");
      }
    });
    const red = result.ok ? elements(result.value).get("vi-cal-red") : undefined;
    check("the page really changed (vi-cal-red is now blue)", (await page.evaluate("getComputedStyle(document.querySelector(\"[data-testid='vi-cal-red']\")).backgroundColor")) === "rgb(0, 0, 255)");
    check("the cycle's crop still shows the ORIGINAL red pixels", !!red && solid(red.element.image, RED), outcome(result));
    check("...and no recapture happened", shots.count === 1, `${shots.count}`);

    // A frame the caller holds: crops taken after a DOM change are still the original pixels.
    await page.evaluate("document.querySelector(\"[data-testid='vi-cal-red']\").style.background = '#ff0000'");
    const held = await captureVisualFrame(page);
    check("a held frame was captured", held.ok, outcome(held));
    if (held.ok) {
      const box = (await page.getByTestId("vi-cal-red").boundingBox())!;
      const first = cropFromVisualFrame(held.value, box);
      await page.evaluate("document.querySelector(\"[data-testid='vi-cal-red']\").style.background = '#0000ff'");
      const second = cropFromVisualFrame(held.value, box);
      check("a crop after the DOM change is still red and identical to the crop before it", first.ok && second.ok && solid(second.value.element.image, RED) && digest(first.value.element.image) === digest(second.value.element.image));
      const reversed = cropFromVisualFrame(held.value, (await page.getByTestId("vi-pos-a").boundingBox())!);
      const third = cropFromVisualFrame(held.value, box);
      check("crops are deterministic: cropping another region first changes nothing", reversed.ok && third.ok && digest(third.value.element.image) === digest(first.ok ? first.value.element.image : third.value.element.image));
      check("...and the held frame took exactly one more screenshot", shots.count === 2, `${shots.count}`);
      const frozen = Object.isFrozen(held.value) && Object.isFrozen(held.value.viewport) && Object.isFrozen(held.value.memory);
      check("the frame and its metadata are frozen (immutable)", frozen);
      const json = JSON.stringify(held.value);
      check("a serialised frame carries metadata only: no pixels, no page", json.length < 1024 && !json.includes("\"data\"") && !json.includes("_guid"), `${json.length} chars`);
      let forged = false;
      try {
        new (held.value.constructor as new (...args: unknown[]) => unknown)(Symbol("forged"), {}, {});
        forged = true;
      } catch {
        forged = false;
      }
      check("a frame cannot be constructed outside a capture", !forged);
      releaseVisualFrame(held.value);
      check("after release, the held frame refuses to crop (CAPTURE_STALE)", outcome(cropFromVisualFrame(held.value, box)) === "CAPTURE_STALE");
      releaseVisualFrame(held.value);
      check("release is idempotent", outcome(cropFromVisualFrame(held.value, box)) === "CAPTURE_STALE");
    }
    await page.close();
  }

  // -------------------------------------------------------------------------------------------------------------
  section = "invalidation";
  console.log("\nInvalidation (CAPTURE_STALE, never recaptured):\n");
  {
    type Change = { label: string; act: (page: Page, context: BrowserContext) => Promise<void> };
    const changes: Change[] = [
      {
        label: "navigation",
        act: async (p) => {
          await p.goto(`${BASE}/visual-intelligence`);
        }
      },
      {
        label: "a popup",
        act: async (p) => {
          const [popup] = await Promise.all([p.waitForEvent("popup"), p.evaluate("void window.open('/visual-intelligence/popup', 'fanout-popup', 'width=400,height=300')")]);
          await popup.close();
        }
      },
      {
        label: "a viewport resize",
        act: async (p) => {
          await p.setViewportSize({ width: 820, height: 600 });
        }
      },
      {
        label: "a device-pixel-ratio change",
        act: async (p, c) => {
          const cdp = await c.newCDPSession(p);
          await cdp.send("Emulation.setDeviceMetricsOverride", { width: 800, height: 600, deviceScaleFactor: 2, mobile: false });
        }
      }
    ];
    for (const change of changes) {
      const ctx = await newContext(1);
      const page = await openLab(ctx);
      const shots = countScreenshots(page);
      const result = await captureCandidatesWithSeams(page, labCandidates(page, LAB_IDS.slice(0, 4)), {}, { onFrame: observe, afterScreenshot: (p) => change.act(p, ctx) });
      check(`${change.label} after the screenshot fails the cycle CAPTURE_STALE`, outcome(result) === "CAPTURE_STALE", outcome(result));
      check(`...with no recapture (one screenshot)`, shots.count === 1, `${shots.count}`);
      await ctx.close();

      // The same change against a frame the caller holds.
      const ctx2 = await newContext(1);
      const page2 = await openLab(ctx2);
      const held = await captureVisualFrame(page2);
      const box = (await page2.getByTestId("vi-cal-red").boundingBox())!;
      if (held.ok) {
        check(`(held) the frame crops before ${change.label}`, cropFromVisualFrame(held.value, box).ok);
        await change.act(page2, ctx2);
        const validated = await validateVisualFrame(held.value);
        check(`(held) ${change.label} makes validateVisualFrame CAPTURE_STALE`, outcome(validated) === "CAPTURE_STALE", outcome(validated));
        check(`(held) ...and every later crop CAPTURE_STALE`, outcome(cropFromVisualFrame(held.value, box)) === "CAPTURE_STALE");
        releaseVisualFrame(held.value);
      } else {
        check(`(held) a frame was captured for ${change.label}`, false, outcome(held));
      }
      await ctx2.close();
    }

    // Page close, against a held frame and inside a cycle.
    {
      const page = await openLab(context);
      const held = await captureVisualFrame(page);
      const box = (await page.getByTestId("vi-cal-red").boundingBox())!;
      await page.close();
      check("(held) a page close makes every crop CAPTURE_STALE", held.ok && outcome(cropFromVisualFrame(held.value, box)) === "CAPTURE_STALE");
      check("(held) ...and validateVisualFrame CAPTURE_STALE", held.ok && outcome(await validateVisualFrame(held.value)) === "CAPTURE_STALE");
      if (held.ok) releaseVisualFrame(held.value);

      const page2 = await openLab(context);
      const shots = countScreenshots(page2);
      const closed = await captureCandidatesWithSeams(page2, labCandidates(page2, LAB_IDS.slice(0, 4)), {}, {
        onFrame: observe,
        afterScreenshot: async (p) => {
          await p.close();
        }
      });
      check("a page close inside a cycle fails the cycle CAPTURE_STALE, never a result", outcome(closed) === "CAPTURE_STALE", outcome(closed));
      check("...with no recapture", shots.count === 1, `${shots.count}`);
    }

    // Expiry. The frame's age counts from its decode, and the capture's post-checks and protected window run inside it,
    // so the box is measured before the capture and the age leaves room for a slow host; the fresh crop must still
    // land well inside it.
    {
      const page = await openLab(context);
      const box = (await page.getByTestId("vi-cal-red").boundingBox())!;
      const maxFrameAgeMs = 1000;
      const held = await captureVisualFrame(page, { maxFrameAgeMs });
      const fresh = held.ok ? cropFromVisualFrame(held.value, box) : held;
      check("(held) a fresh frame crops", held.ok && fresh.ok, fresh.ok ? "ok" : `${fresh.code} (${fresh.message})`);
      await sleep(maxFrameAgeMs + 200);
      const expired = held.ok ? cropFromVisualFrame(held.value, box) : held;
      check("(held) a frame older than maxFrameAgeMs is CAPTURE_STALE", held.ok && outcome(expired) === "CAPTURE_STALE", outcome(expired));
      if (held.ok) releaseVisualFrame(held.value);
      await page.close();
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  section = "frames";
  console.log("\nTop-level, iframe and nested-iframe candidates from one screenshot:\n");
  {
    const page = await openLab(context);
    const shots = countScreenshots(page);
    const result = await captureCandidatesWithSeams(page, [
      { id: "top", target: page.getByTestId("vi-cal-red") },
      { id: "iframe", target: frameTarget(page) }
    ], {}, { onFrame: observe });
    const map = result.ok ? elements(result.value) : new Map<string, VisualElementCapture>();
    const top = map.get("top");
    const inner = map.get("iframe");
    check("top-level + iframe candidates: one screenshot, one capture id", result.ok && shots.count === 1 && new Set(result.value.candidates.map((c) => c.captureId)).size === 1);
    check("the top-level candidate maps to the main frame", !!top && top.frame.isMainFrame && top.frame.depth === 0);
    check("the iframe candidate maps to depth 1 at viewport (390, 40), 80x40, solid blue", !!inner && !inner.frame.isMainFrame && inner.frame.depth === 1 && inner.element.actualBounds.x === 390 && inner.element.actualBounds.y === 40 && solid(inner.element.image, BLUE) && inner.element.image.width === 80 && inner.element.image.height === 40, inner ? JSON.stringify(inner.element.actualBounds) : "missing");
    await page.close();

    const nestedPage = await context.newPage();
    await nestedPage.goto(`${BASE}/visual-intelligence/frames`);
    const nested = nestedPage.frameLocator('[data-testid="vi-frames-nested"]').frameLocator('[data-testid="vi-frame-inner"]').getByTestId("vi-frame-target");
    const scrolled = nestedPage.frameLocator('[data-testid="vi-frames-scrolled"]').getByTestId("vi-frame-target");
    await nested.waitFor();
    await nestedPage.frameLocator('[data-testid="vi-frames-scrolled"]').locator("body[data-scrolled='260']").waitFor();
    const nestedShots = countScreenshots(nestedPage);
    const frames = await captureCandidatesWithSeams(nestedPage, [
      { id: "host", target: nestedPage.getByTestId("vi-frames-nested") },
      { id: "nested", target: nested },
      { id: "scrolled", target: scrolled }
    ], {}, { onFrame: observe });
    const fm = frames.ok ? elements(frames.value) : new Map<string, VisualElementCapture>();
    const n = fm.get("nested");
    const s = fm.get("scrolled");
    const h = fm.get("host");
    check("top-level + nested + scrolled-frame candidates: one screenshot, one capture id", frames.ok && nestedShots.count === 1 && new Set(frames.value.candidates.map((c) => c.captureId)).size === 1, outcome(frames));
    check("the frame host element maps to the main frame at (40, 40), 300x200", !!h && h.frame.depth === 0 && h.element.actualBounds.x === 40 && h.element.actualBounds.y === 40 && h.element.image.width === 300 && h.element.image.height === 200);
    check("the nested target maps two frames deep to viewport (92, 80), solid blue", !!n && n.frame.depth === 2 && n.element.actualBounds.x === 92 && n.element.actualBounds.y === 80 && solid(n.element.image, BLUE), n ? JSON.stringify(n.element.actualBounds) : "missing");
    check("the scrolled-frame target maps to viewport (432, 100), solid blue", !!s && s.frame.depth === 1 && s.element.actualBounds.x === 432 && s.element.actualBounds.y === 100 && solid(s.element.image, BLUE), s ? JSON.stringify(s.element.actualBounds) : "missing");
    await nestedPage.close();
  }

  // -------------------------------------------------------------------------------------------------------------
  section = "protected";
  console.log("\nProtected surfaces (one pre-check, one post-check per cycle):\n");
  {
    const page = await openLab(context);
    const shots = countScreenshots(page);
    for (const size of [1, 20]) {
      let guardCalls = 0;
      const result = await captureCandidatesWithSeams(page, labCandidates(page, LAB_IDS.slice(0, size)), {}, {
        onFrame: observe,
        guard: (p) => {
          guardCalls += 1;
          return checkProtectedSurface(p);
        }
      });
      check(`${size} candidate(s): the protected guard runs exactly twice (once before, once after)`, result.ok && guardCalls === 2, `${outcome(result)}, ${guardCalls} calls`);
    }

    const before = shots.count;
    await page.evaluate("window.__visualLab.injectProtected('otp')");
    const pre = await captureCandidates(page, labCandidates(page, LAB_IDS.slice(0, 4)));
    check("a protected surface BEFORE the cycle refuses it PROTECTED_SURFACE", outcome(pre) === "PROTECTED_SURFACE", outcome(pre));
    check("...without taking any screenshot", shots.count === before, `${shots.count - before}`);
    const heldPre = await captureVisualFrame(page);
    check("...and captureVisualFrame refuses too, without a screenshot", outcome(heldPre) === "PROTECTED_SURFACE" && shots.count === before);
    await page.evaluate("window.__visualLab.removeProtected()");

    const handedOff = await captureCandidates(page, labCandidates(page, LAB_IDS.slice(0, 2)), { handedOff: true });
    check("a handed-off session refuses the cycle without a screenshot", outcome(handedOff) === "PROTECTED_SURFACE" && shots.count === before, outcome(handedOff));

    for (const kind of ["otp", "captcha"]) {
      let frame: VisualCaptureFrame | undefined;
      const mid = shots.count;
      const post = await captureCandidatesWithSeams(page, labCandidates(page, LAB_IDS.slice(0, 4)), {}, {
        onFrame: (f) => {
          frame = f;
          observe(f);
        },
        afterScreenshot: async (p) => {
          await p.evaluate(`window.__visualLab.injectProtected('${kind}')`);
        }
      });
      check(`a ${kind} surface appearing AFTER the screenshot discards the whole frame (PROTECTED_SURFACE)`, outcome(post) === "PROTECTED_SURFACE", outcome(post));
      check(`...no candidate pixels are returned, and the one screenshot is not retaken`, !post.ok && shots.count === mid + 1);
      check(`...and the discarded frame is released (crop is CAPTURE_STALE)`, !!frame && outcome(cropFromVisualFrame(frame, { x: 20, y: 20, width: 100, height: 60 })) === "CAPTURE_STALE");
      await page.evaluate("window.__visualLab.removeProtected()");
    }
    await page.close();

    const account = await context.newPage();
    await account.goto(`${BASE}/visual-intelligence/account`);
    const accountShots = countScreenshots(account);
    const route = await captureCandidates(account, [{ id: "body", target: account.locator("body") }]);
    check("the protected account route refuses the cycle without a screenshot", outcome(route) === "PROTECTED_SURFACE" && accountShots.count === 0, outcome(route));
    await account.close();
  }

  // -------------------------------------------------------------------------------------------------------------
  section = "concurrency";
  console.log("\nConcurrency isolation (no process-global current screenshot):\n");
  {
    const ctxA = await newContext(1);
    const ctxB = await newContext(1);
    const pageA = await openLab(ctxA);
    const pageB = await openLab(ctxB);
    await pageB.evaluate("document.querySelector(\"[data-testid='vi-cal-red']\").style.background = '#0000ff'");
    const shotsA = countScreenshots(pageA);
    const shotsB = countScreenshots(pageB);

    // Both cycles take their screenshot, then wait for each other before either crops.
    let arrived = 0;
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const barrier = async (): Promise<void> => {
      arrived += 1;
      if (arrived === 2) open();
      await gate;
    };
    const [a, b] = await Promise.all([
      captureCandidatesWithSeams(pageA, labCandidates(pageA, ["vi-cal-red", "vi-pos-a"]), {}, { onFrame: observe, afterScreenshot: barrier }),
      captureCandidatesWithSeams(pageB, labCandidates(pageB, ["vi-cal-red", "vi-pos-a"]), {}, { onFrame: observe, afterScreenshot: barrier })
    ]);
    check("both interleaved cycles reached the barrier", arrived === 2);
    check("each page took exactly its own one screenshot", a.ok && b.ok && shotsA.count === 1 && shotsB.count === 1, `${outcome(a)} ${outcome(b)} ${shotsA.count} ${shotsB.count}`);
    check("the two cycles have distinct capture ids", a.ok && b.ok && a.value.captureId !== b.value.captureId);
    const redA = a.ok ? elements(a.value).get("vi-cal-red") : undefined;
    const redB = b.ok ? elements(b.value).get("vi-cal-red") : undefined;
    check("cycle A crops page A's red box, never page B's", !!redA && solid(redA.element.image, RED));
    check("cycle B crops page B's blue box, never page A's", !!redB && solid(redB.element.image, BLUE));

    // Two concurrent cycles on the SAME page each own their screenshot too.
    const same = await Promise.all([
      captureCandidatesWithSeams(pageA, labCandidates(pageA, ["vi-cal-red"]), {}, { onFrame: observe }),
      captureCandidatesWithSeams(pageA, labCandidates(pageA, ["vi-pos-a", "vi-pos-b"]), {}, { onFrame: observe })
    ]);
    check("two concurrent cycles on one page: two screenshots, two capture ids, each ok", same.every((r) => r.ok) && shotsA.count === 3 && new Set(same.map((r) => (r.ok ? r.value.captureId : null))).size === 2);
    await ctxA.close();
    await ctxB.close();
  }

  // -------------------------------------------------------------------------------------------------------------
  section = "memory";
  console.log("\nMemory (released after the cycle, nothing retained):\n");
  {
    const page = await openLab(context);
    // Page is a Node EventEmitter at runtime; its public typings omit listenerCount.
    const emitter = page as unknown as { listenerCount(event: string): number };
    const listeners = (): number => emitter.listenerCount("framenavigated") + emitter.listenerCount("popup") + emitter.listenerCount("close");
    // The strict protected capture window (awkit-3gtj follow-up) adds its own framenavigated and close listeners, plus
    // frameattached, framedetached and console ones, for the length of the cycle.
    const windowListeners = (): number => emitter.listenerCount("frameattached") + emitter.listenerCount("framedetached") + emitter.listenerCount("console");
    const baseline = listeners();
    const windowBaseline = windowListeners();
    let frame: VisualCaptureFrame | undefined;
    let during = -1;
    let windowDuring = -1;
    const result = await captureCandidatesWithSeams(page, labCandidates(page, LAB_IDS), {}, {
      onFrame: (f) => {
        frame = f;
        observe(f);
      },
      afterScreenshot: async () => {
        during = listeners();
        windowDuring = windowListeners();
      }
    });
    check("the cycle watched the page for invalidation while it ran (3 frame-watch + 2 capture-window listeners)", during === baseline + 5, `baseline ${baseline}, during ${during}`);
    check("...and the capture window watched frame attach, detach and its sentinel signal", windowDuring === windowBaseline + 3, `baseline ${windowBaseline}, during ${windowDuring}`);
    check("...and detached every listener when it ended", listeners() === baseline && windowListeners() === windowBaseline, `${listeners()} / ${windowListeners()}`);
    check("the cycle's frame is released when it returns (crop is CAPTURE_STALE)", !!frame && outcome(cropFromVisualFrame(frame, { x: 20, y: 20, width: 100, height: 60 })) === "CAPTURE_STALE");
    if (result.ok && frame) {
      const f = result.value;
      const vp = f.viewport!;
      const decoded = vp.imageWidth * vp.imageHeight * 4;
      check("memory.decodedBytes is the full RGBA frame", f.memory.decodedBytes === decoded && frame.memory.decodedBytes === decoded, `${f.memory.decodedBytes} vs ${decoded}`);
      check("memory.pngBytes is a real encoded size", f.memory.pngBytes > 0 && f.memory.pngBytes < decoded);
      const crops = [...elements(f).values()].reduce((sum, c) => sum + c.element.image.data.byteLength + (c.context?.image.data.byteLength ?? 0), 0);
      check("memory.cropBytes is the sum of every returned crop", f.memory.cropBytes === crops && crops > 0, `${f.memory.cropBytes} vs ${crops}`);
      check("memory.peakTemporaryBytes = png + decoded + crops", f.memory.peakTemporaryBytes === f.memory.pngBytes + f.memory.decodedBytes + f.memory.cropBytes);
      const retained = largestRetainedBuffer(f);
      check("no buffer reachable from the result is the full frame (every crop owns a copy)", retained > 0 && retained < decoded, `${retained} of ${decoded}`);
      const timing = f.timing;
      check(
        "timings are finite and consistent",
        [timing.resolveMs, timing.screenshotMs, timing.decodeMs, timing.recheckMs, timing.cropMs, timing.totalMs].every((n) => Number.isFinite(n) && n >= 0) &&
          timing.totalMs >= timing.screenshotMs + timing.decodeMs
      );

      const evidence = buildCandidateEvidence(f);
      const json = JSON.stringify(evidence);
      check("candidate evidence: one record per candidate, all carrying the cycle's capture id", evidence.candidates.length === 20 && evidence.captureId === f.captureId && evidence.candidates.every((c) => c.captureId === f.captureId && c.evidence.ok));
      check("candidate evidence holds no image bytes and fits the N1 per-record bound", largestRetainedBuffer(evidence) === 0 && evidence.candidates.every((c) => c.evidence.ok && JSON.stringify(c.evidence.value).length <= VISUAL_EVIDENCE_MAX_BYTES) && !json.includes("\"data\""));
      check("candidate evidence bytes are measured", evidence.evidenceBytes > 0 && evidence.evidenceBytes < 20 * VISUAL_EVIDENCE_MAX_BYTES);
      console.log(`    memory: png ${f.memory.pngBytes} B, decoded ${f.memory.decodedBytes} B, crops ${f.memory.cropBytes} B, peak ${f.memory.peakTemporaryBytes} B, evidence ${evidence.evidenceBytes} B`);
    }
    await page.close();

    check("cardinality: at least 30 cycle frames were observed", seenFrames.length >= 30, `${seenFrames.length}`);
    const unreleased = seenFrames.filter((f) => outcome(cropFromVisualFrame(f, { x: 0, y: 0, width: 10, height: 10 })) !== "CAPTURE_STALE");
    check("every frame any cycle produced was released", unreleased.length === 0, `${unreleased.length} still croppable`);
  }

  // -------------------------------------------------------------------------------------------------------------
  section = "shadow only";
  console.log("\nShadow only:\n");
  {
    check("MEASURED_FUSION_POLICY.contradictionEnabled === false", MEASURED_FUSION_POLICY.contradictionEnabled === false);
    check("MEASURED_FUSION_POLICY is frozen", Object.isFrozen(MEASURED_FUSION_POLICY));
    const sources = ["src/visual/internal/captureCore.ts", "src/visual/capture.ts", "src/visual/candidateEvidence.ts"].map((path) => [path, readFileSync(path, "utf8")] as const);
    // `.check(` is excluded only on the capture's own Budget (`this.check()` / `budget.check()`), never on a locator.
    const input = /\.(click|dblclick|fill|press|type|setChecked|selectOption|tap|hover|focus|dispatchEvent|scrollIntoViewIfNeeded)\(|(?<!\bthis|\bbudget)\.(un)?check\(|\b(mouse|keyboard|touchscreen)\./;
    const disk = /node:fs|from "fs"|writeFile|mkdir|createWriteStream|localStorage|indexedDB/;
    check(
      "the source scans are live: they flag a locator check(), a click() and a file write, but not the Budget's check()",
      input.test("target.check()") && input.test("page.click(") && !input.test("budget.check()") && !input.test("this.check()") && disk.test("await writeFile(")
    );
    check("the capture modules carry no input, focus or scroll call", sources.every(([, text]) => !input.test(text)), sources.filter(([, t]) => input.test(t)).map(([p]) => p).join(", "));
    check("the capture modules write nothing to disk or browser storage (no capture cache)", sources.every(([, text]) => !disk.test(text)), sources.filter(([, t]) => disk.test(t)).map(([p]) => p).join(", "));
    check("cardinality: three capture modules scanned, each non-empty", sources.length === 3 && sources.every(([, t]) => t.length > 500));
    check("no request left the local mock site", offSite.length === 0, offSite.join(", "));
  }
  await context.close();
} catch (error) {
  failed += 1;
  console.error(error);
} finally {
  if (browser) await browser.close().catch(() => undefined);
  server.kill();
  clearInterval(keepAlive);
}

if (failures.length > 0) console.error(`\nFailed:\n${failures.map((f) => `  ✗ ${f}`).join("\n")}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
