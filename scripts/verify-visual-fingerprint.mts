/**
 * verify:visual-fingerprint — Phase N, N1 (awkit-vra.3.1): deterministic fingerprints and advisory comparison.
 *
 * Captures the Feature Test Lab's fixed /visual-intelligence fixtures through the real capture pipeline (Chromium,
 * DPR 1) and runs one suite over them: determinism, repeat capture, a slight rendering change, an icon change, an
 * unrelated image, a position change, a size change, an SVG difference, a theme change, non-vacuous grids, the payload
 * ceiling, symmetry, malformed input and a version mismatch. `decodePng` is cross-checked byte for byte against sharp.
 *
 * The same suite is then run against three mutants, each of which must make it FAIL:
 *   - a fingerprint function that returns one constant fingerprint;
 *   - a comparison that always scores 1;
 *   - an empty fixture-pair list (the suite must not pass by checking nothing);
 *   - a pair list or a fixture corpus one short of its hardcoded floor (caught by that floor, not by accident);
 *   - a fingerprint that yields NaN on tiny images, and a comparison that yields NaN for zero-variance fills.
 *
 * Every fixture is fingerprinted 100 times (alternating original and copied buffers), and synthetic tiny (1x1 to 3x3),
 * strip (8192x2, 2x8192) and huge (4096x4096) images must fingerprint within the ceiling with finite numbers.
 *
 * The score thresholds were set from a measured run, not predicted; the measured table is printed every run.
 * Scores are advisory evidence: nothing here, or in src/visual, picks, clicks or recovers an element.
 *
 * Run: npm run verify:visual-fingerprint
 */

import { spawn } from "node:child_process";

import { chromium, type Browser, type Page } from "playwright";
import sharp from "sharp";

import { captureElement, captureViewport } from "@src/visual/capture";
import { compareVisualFingerprints, type VisualComparison } from "@src/visual/compare";
import type { VisualResult } from "@src/visual/errors";
import { fingerprintVisualImage, VISUAL_FINGERPRINT_MAX_BYTES, type VisualFingerprint } from "@src/visual/fingerprint";
import { decodePng, PngDecodeError, VisualImage } from "@src/visual/png";

const PORT = 4424;
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * Set from the run measured on 2026-10-12 (Chromium, DPR 1): slight-render 0.9972, icon 0.8757, svg-twins 0.9434,
 * size 0.9628, unrelated 0.7307, restyle 0.6705, theme 0.4667. The unrelated ceiling also has to sit below the icon
 * pair, which the suite asserts relatively. Note the same-meaning restyle scores BELOW the unrelated pair: a score
 * measures appearance, never meaning.
 */
const SLIGHT_RENDER_MIN_SCORE = 0.9;
const UNRELATED_MAX_SCORE = 0.8;

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

type Fingerprinter = (image: VisualImage) => VisualResult<VisualFingerprint>;
type Comparer = (a: VisualFingerprint, b: VisualFingerprint) => VisualResult<VisualComparison>;
type Corpus = Record<string, VisualImage>;
interface Pair {
  name: string;
  a: string;
  b: string;
}
interface Outcome {
  label: string;
  ok: boolean;
  detail?: string;
}

const FIXTURES = [
  "vi-cal-red",
  "vi-render-base",
  "vi-render-minor",
  "vi-geom-base",
  "vi-geom-resized",
  "vi-pos-a",
  "vi-pos-b",
  "vi-theme-light",
  "vi-theme-dark",
  "vi-icon-base",
  "vi-icon-mutated",
  "vi-unrelated",
  "vi-twin-approve",
  "vi-twin-reject",
  "vi-approve-primary",
  "vi-approve-outline"
] as const;

const PAIRS: Pair[] = [
  { name: "repeat", a: "vi-render-base", b: "vi-render-base#repeat" },
  { name: "slight-render", a: "vi-render-base", b: "vi-render-minor" },
  { name: "icon", a: "vi-icon-base", b: "vi-icon-mutated" },
  { name: "unrelated", a: "vi-render-base", b: "vi-unrelated" },
  { name: "position", a: "vi-pos-a", b: "vi-pos-b" },
  { name: "size", a: "vi-geom-base", b: "vi-geom-resized" },
  { name: "svg-twins", a: "vi-twin-approve", b: "vi-twin-reject" },
  { name: "restyle", a: "vi-approve-primary", b: "vi-approve-outline" },
  { name: "theme", a: "vi-theme-light", b: "vi-theme-dark" }
];
// Hardcoded floors, never derived from the lists they guard: a deleted fixture or pair must fail the suite.
const MIN_PAIRS = 9;
const MIN_FIXTURES = 16;
const DETERMINISM_RUNS = 100;

function distinctCells(base64: string): number {
  return new Set(Buffer.from(base64, "base64")).size;
}

/**
 * The whole fingerprint contract over one corpus. Pure: no browser, no globals; the mutants call it with substituted
 * functions or an empty pair list.
 */
function evaluateSuite(corpus: Corpus, pairs: Pair[], fingerprint: Fingerprinter, compare: Comparer): Outcome[] {
  const outcomes: Outcome[] = [];
  const add = (label: string, ok: boolean, detail?: string): void => {
    outcomes.push({ label, ok, detail });
  };

  const fingerprints: Record<string, VisualFingerprint> = {};
  let fingerprintFailures = 0;
  for (const [name, image] of Object.entries(corpus)) {
    const result = fingerprint(image);
    if (result.ok) fingerprints[name] = result.value;
    else fingerprintFailures += 1;
  }
  add("every fixture image fingerprints", fingerprintFailures === 0 && Object.keys(fingerprints).length === Object.keys(corpus).length && Object.keys(corpus).filter((name) => !name.includes("#")).length >= MIN_FIXTURES);

  // 1. Determinism: the same pixels, fingerprinted DETERMINISM_RUNS times, alternately from the original and from a
  //    fresh copy of the buffer, give the same fingerprint every time. The run count is asserted, not assumed.
  let deterministic = Object.keys(corpus).length >= MIN_FIXTURES;
  let runs = 0;
  for (const [name, image] of Object.entries(corpus)) {
    const expected = JSON.stringify(fingerprints[name]);
    for (let i = 0; i < DETERMINISM_RUNS; i += 1) {
      const source = i % 2 === 0 ? image : new VisualImage(image.width, image.height, Uint8Array.from(image.data));
      const again = fingerprint(source);
      runs += 1;
      if (!again.ok || JSON.stringify(again.value) !== expected) deterministic = false;
    }
  }
  add(`the same pixels give the same fingerprint ${DETERMINISM_RUNS} times out of ${DETERMINISM_RUNS}`, deterministic && runs === DETERMINISM_RUNS * Object.keys(corpus).length, `${runs} runs`);

  const results: Record<string, VisualComparison> = {};
  let compareFailures = 0;
  let symmetric = pairs.length > 0;
  for (const pair of pairs) {
    const a = fingerprints[pair.a];
    const b = fingerprints[pair.b];
    if (!a || !b) {
      compareFailures += 1;
      continue;
    }
    const ab = compare(a, b);
    const ba = compare(b, a);
    if (!ab.ok || !ba.ok) {
      compareFailures += 1;
      continue;
    }
    results[pair.name] = ab.value;
    if (JSON.stringify(ab.value) !== JSON.stringify(ba.value)) symmetric = false;
  }
  add(`every fixture pair compares (${pairs.length} of at least ${MIN_PAIRS})`, compareFailures === 0 && pairs.length >= MIN_PAIRS && Object.keys(results).length === pairs.length);
  add("comparison is symmetric for every pair", symmetric);
  add("every comparison is advisory", Object.keys(results).length > 0 && Object.values(results).every((c) => c.advisory === true));

  const get = (name: string): VisualComparison | undefined => results[name];
  const differs = (c: VisualComparison): boolean => c.dHashDistance > 0 || c.gridDistance > 0 || c.edgeDistance > 0;
  const repeat = get("repeat");
  const render = get("slight-render");
  const icon = get("icon");
  const unrelated = get("unrelated");
  const position = get("position");
  const size = get("size");
  const twins = get("svg-twins");
  const restyle = get("restyle");
  const theme = get("theme");

  // 2. Repeat capture.
  add("a repeat capture is identical and scores 1", !!repeat && repeat.identical && repeat.score === 1 && !differs(repeat));
  // 3. Slight rendering change: close, but not identical.
  add(`a slight rendering change scores high (>= ${SLIGHT_RENDER_MIN_SCORE}) but is not identical`, !!render && !render.identical && render.score < 1 && render.score >= SLIGHT_RENDER_MIN_SCORE);
  // 4. Icon change is detected.
  add("an icon change is detected", !!icon && !icon.identical && differs(icon) && icon.score < 1);
  // 5. Unrelated image scores low, and below every related pair.
  add(
    `an unrelated image scores low (<= ${UNRELATED_MAX_SCORE}) and below the related pairs`,
    !!unrelated && !!render && !!icon && !unrelated.identical && unrelated.score <= UNRELATED_MAX_SCORE && unrelated.score < render.score && unrelated.score < icon.score
  );
  // 6. Position change: the same control elsewhere on the page fingerprints identically (a fingerprint is position-free).
  add("a position change alone leaves the fingerprint identical", !!position && position.identical && position.score === 1);
  // 7. Size change is reported.
  add("a size change is reported as not the same size", !!size && !size.sameSize && !size.identical && size.score < 1);
  // 8. SVG difference: look-alike controls with different meaning differ, yet still score above an unrelated image.
  add("an SVG glyph difference is detected", !!twins && !twins.identical && differs(twins) && twins.score < 1);
  add("...and look-alikes still score above an unrelated image (appearance is not identity)", !!twins && !!unrelated && twins.score > unrelated.score);
  add("a restyled control of the same meaning scores below a slight rendering change", !!restyle && !!render && !restyle.identical && restyle.score < render.score);
  add("a theme change moves mean luma and scores below a slight rendering change", !!theme && !!render && theme.meanLumaDelta >= 60 && theme.score < render.score);

  // 9. Non-vacuous grids: textured fixtures have real structure; the solid calibration fill has none.
  const textured = ["vi-render-base", "vi-icon-base", "vi-unrelated", "vi-theme-light"].map((n) => fingerprints[n]);
  add("textured fixtures have varied luma and edge grids", textured.every((f) => !!f && f.lumaVariance > 0 && f.meanEdge > 0 && distinctCells(f.grid) >= 3 && distinctCells(f.edgeGrid) >= 2));
  const solid = fingerprints["vi-cal-red"];
  add("NEGATIVE CONTROL: a solid fill has zero variance and zero edges", !!solid && solid.lumaVariance === 0 && solid.meanEdge === 0 && distinctCells(solid.grid) === 1);

  // 10. Payload ceiling.
  const sizes = Object.values(fingerprints).map((f) => JSON.stringify(f).length);
  add(`every fingerprint serialises within ${VISUAL_FINGERPRINT_MAX_BYTES} bytes`, sizes.length > 0 && Math.max(...sizes) <= VISUAL_FINGERPRINT_MAX_BYTES, `max ${Math.max(0, ...sizes)}`);
  return outcomes;
}

/** A synthetic image: a solid fill, or deterministic noise from a fixed-seed LCG. */
function synthetic(width: number, height: number, fill: [number, number, number] | "noise"): VisualImage {
  const data = new Uint8Array(width * height * 4);
  let seed = 0x2545f491;
  for (let p = 0; p < data.length; p += 4) {
    if (fill === "noise") {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      data[p] = seed >>> 24;
      data[p + 1] = (seed >>> 16) & 0xff;
      data[p + 2] = (seed >>> 8) & 0xff;
    } else {
      data[p] = fill[0];
      data[p + 1] = fill[1];
      data[p + 2] = fill[2];
    }
    data[p + 3] = 255;
  }
  return new VisualImage(width, height, data);
}

const finiteNumbers = (value: object): boolean => Object.values(value).every((v) => typeof v !== "number" || Number.isFinite(v));

/**
 * Tiny and huge images: every size fingerprints within the ceiling with finite numbers and a full grid, is stable
 * across repeat runs, and compares (including two zero-variance fills, the divide-by-zero case) to a finite score in
 * [0, 1]. Pure, so the NaN mutant can be run through it.
 */
function evaluateExtremes(fingerprint: Fingerprinter, compare: Comparer): Outcome[] {
  const outcomes: Outcome[] = [];
  const add = (label: string, ok: boolean, detail?: string): void => {
    outcomes.push({ label, ok, detail });
  };
  const sizes: Array<[string, VisualImage]> = [
    ["1x1", synthetic(1, 1, [200, 30, 30])],
    ["1x2", synthetic(1, 2, "noise")],
    ["2x1", synthetic(2, 1, "noise")],
    ["2x2", synthetic(2, 2, "noise")],
    ["3x3", synthetic(3, 3, "noise")],
    ["8192x2", synthetic(8192, 2, "noise")],
    ["2x8192", synthetic(2, 8192, "noise")],
    ["4096x4096", synthetic(4096, 4096, "noise")]
  ];
  const prints: Record<string, VisualFingerprint> = {};
  for (const [name, image] of sizes) {
    const result = fingerprint(image);
    if (!result.ok) {
      add(`${name} fingerprints`, false, result.code);
      continue;
    }
    const f = result.value;
    prints[name] = f;
    const cells = f.gridSize * f.gridSize;
    add(
      `${name} fingerprints within the ceiling, finite, with a full grid and its own size`,
      JSON.stringify(f).length <= VISUAL_FINGERPRINT_MAX_BYTES &&
        finiteNumbers(f) &&
        f.width === image.width &&
        f.height === image.height &&
        Buffer.from(f.grid, "base64").length === cells &&
        Buffer.from(f.edgeGrid, "base64").length === cells &&
        /^[0-9a-f]{16}$/.test(f.dHash),
      `${JSON.stringify(f).length} bytes`
    );
    const repeats = image.width * image.height <= 64 ? DETERMINISM_RUNS : 3;
    let stable = true;
    for (let i = 0; i < repeats; i += 1) {
      const again = fingerprint(new VisualImage(image.width, image.height, Uint8Array.from(image.data)));
      if (!again.ok || JSON.stringify(again.value) !== JSON.stringify(f)) stable = false;
    }
    add(`${name} is stable over ${repeats} runs`, stable);
  }
  add("every size fingerprinted", Object.keys(prints).length === sizes.length, `${Object.keys(prints).length} of ${sizes.length}`);

  const scored = (label: string, x: VisualFingerprint | undefined, y: VisualFingerprint | undefined, identical: boolean): void => {
    const result = x && y ? compare(x, y) : null;
    const c = result?.ok ? result.value : null;
    add(label, !!c && finiteNumbers(c) && c.score >= 0 && c.score <= 1 && c.identical === identical && (!identical || c.score === 1), c ? `score ${c.score}` : "compare failed");
  };
  const black = fingerprint(synthetic(16, 16, [0, 0, 0]));
  const white = fingerprint(synthetic(16, 16, [255, 255, 255]));
  scored("1x1 compared with itself is identical and scores 1", prints["1x1"], prints["1x1"], true);
  scored("1x1 compared with 4096x4096 gives a finite score in [0, 1]", prints["1x1"], prints["4096x4096"], false);
  scored("two zero-variance fills (black, white) give a finite score in [0, 1], never NaN", black.ok ? black.value : undefined, white.ok ? white.value : undefined, false);
  scored("a 1-pixel-wide and a 1-pixel-tall strip compare finitely", prints["1x2"], prints["2x1"], false);
  return outcomes;
}

function printTable(corpus: Corpus): void {
  const fingerprints: Record<string, VisualFingerprint> = {};
  for (const [name, image] of Object.entries(corpus)) {
    const result = fingerprintVisualImage(image);
    if (result.ok) fingerprints[name] = result.value;
  }
  console.log("\nMeasured comparisons (informational):\n");
  for (const pair of PAIRS) {
    const result = fingerprints[pair.a] && fingerprints[pair.b] ? compareVisualFingerprints(fingerprints[pair.a], fingerprints[pair.b]) : null;
    if (!result?.ok) {
      console.log(`  ${pair.name.padEnd(14)} unavailable`);
      continue;
    }
    const c = result.value;
    console.log(`  ${pair.name.padEnd(14)} score ${c.score.toFixed(4)}  dHash ${String(c.dHashDistance).padStart(2)}  grid ${String(c.gridDistance).padStart(3)}  edge ${String(c.edgeDistance).padStart(3)}  luma Δ ${String(c.meanLumaDelta).padStart(3)}  identical ${c.identical}  sameSize ${c.sameSize}`);
  }
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

async function captureImage(page: Page, testId: string): Promise<VisualImage> {
  const result = await captureElement(page, page.getByTestId(testId), { contextPaddingCss: 0 });
  if (!result.ok) throw new Error(`capture of ${testId} failed: ${result.code}`);
  return result.value.element.image;
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
  const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(`${BASE}/visual-intelligence`);
  await page.frameLocator('[data-testid="vi-frame"]').getByTestId("vi-frame-target").waitFor();

  const corpus: Corpus = {};
  for (const id of FIXTURES) corpus[id] = await captureImage(page, id);
  corpus["vi-render-base#repeat"] = await captureImage(page, "vi-render-base");

  console.log("\nPNG decoding:\n");
  const png = await page.screenshot({ scale: "device" });
  const ours = decodePng(png);
  const reference = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  check(
    "decodePng matches sharp byte for byte on a real Chromium screenshot",
    ours.width === reference.info.width && ours.height === reference.info.height && Buffer.compare(Buffer.from(ours.data), reference.data) === 0
  );
  let corruptCode = "";
  try {
    const corrupt = Buffer.from(png);
    corrupt[corrupt.length - 20] ^= 0xff;
    decodePng(corrupt.subarray(0, Math.floor(corrupt.length / 2)));
  } catch (error) {
    corruptCode = error instanceof PngDecodeError ? "PngDecodeError" : String(error);
  }
  check("a truncated PNG is a typed decode error", corruptCode === "PngDecodeError", corruptCode);
  let notPng = "";
  try {
    decodePng(new TextEncoder().encode("this is not a png, only some text that is long enough"));
  } catch (error) {
    notPng = error instanceof PngDecodeError ? "PngDecodeError" : String(error);
  }
  check("bytes that are not a PNG are a typed decode error", notPng === "PngDecodeError", notPng);

  printTable(corpus);

  console.log("\nFingerprint suite (real implementation):\n");
  for (const outcome of evaluateSuite(corpus, PAIRS, fingerprintVisualImage, compareVisualFingerprints)) check(outcome.label, outcome.ok, outcome.detail);

  console.log("\nMalformed input and versions:\n");
  const base = fingerprintVisualImage(corpus["vi-render-base"]);
  const other = fingerprintVisualImage(corpus["vi-icon-base"]);
  if (!base.ok || !other.ok) throw new Error("baseline fingerprints failed");
  const a = base.value;
  const b = other.value;
  const code = (result: VisualResult<unknown>): string => (result.ok ? "ok" : result.code);
  check("a fingerprint from another version is UNSUPPORTED_FINGERPRINT_VERSION", code(compareVisualFingerprints({ ...a, version: "awkit-vfp-0" } as unknown as VisualFingerprint, b)) === "UNSUPPORTED_FINGERPRINT_VERSION");
  check("...on either side", code(compareVisualFingerprints(a, { ...b, version: "awkit-vfp-2" } as unknown as VisualFingerprint)) === "UNSUPPORTED_FINGERPRINT_VERSION");
  check("a truncated grid is FINGERPRINT_FAILED", code(compareVisualFingerprints({ ...a, grid: a.grid.slice(0, 40) }, b)) === "FINGERPRINT_FAILED");
  check("a truncated edge grid is FINGERPRINT_FAILED", code(compareVisualFingerprints(a, { ...b, edgeGrid: "" })) === "FINGERPRINT_FAILED");
  check("a non-hex difference hash is FINGERPRINT_FAILED", code(compareVisualFingerprints({ ...a, dHash: "zzzzzzzzzzzzzzzz" }, b)) === "FINGERPRINT_FAILED");
  check("a missing digest is FINGERPRINT_FAILED", code(compareVisualFingerprints(a, { ...b, contentDigest: undefined } as unknown as VisualFingerprint)) === "FINGERPRINT_FAILED");
  check("a non-image input is FINGERPRINT_FAILED, not a throw", code(fingerprintVisualImage({ width: 2, height: 2, data: new Uint8Array(16) } as unknown as VisualImage)) === "FINGERPRINT_FAILED");
  check("NEGATIVE CONTROL: the well-formed pair still compares", compareVisualFingerprints(a, b).ok);

  const viewport = await captureViewport(page);
  const viewportPrint = viewport.ok ? fingerprintVisualImage(viewport.value.image) : null;
  check(
    "a full-viewport fingerprint stays within the ceiling and contains no image",
    !!viewportPrint?.ok && JSON.stringify(viewportPrint.value).length <= VISUAL_FINGERPRINT_MAX_BYTES && !JSON.stringify(viewportPrint.value).includes("[omitted]"),
    viewportPrint?.ok ? `${JSON.stringify(viewportPrint.value).length} bytes` : "capture failed"
  );

  console.log("\nTiny and huge images:\n");
  for (const outcome of evaluateExtremes(fingerprintVisualImage, compareVisualFingerprints)) check(outcome.label, outcome.ok, outcome.detail);

  console.log("\nMutation controls (each must make the suite fail):\n");
  const constantPrint = fingerprintVisualImage(corpus["vi-cal-red"]);
  const constant: Fingerprinter = () => constantPrint;
  const alwaysOne: Comparer = (x, y) => {
    const result = compareVisualFingerprints(x, y);
    return result.ok ? { ...result, value: { ...result.value, score: 1 } } : result;
  };
  // The optional third entry names the check that must be among the failures, so a floor mutant is caught by its floor.
  const mutants: Array<[string, Outcome[], string?]> = [
    ["a constant fingerprint", evaluateSuite(corpus, PAIRS, constant, compareVisualFingerprints)],
    ["a comparison that always scores 1", evaluateSuite(corpus, PAIRS, fingerprintVisualImage, alwaysOne)],
    ["an empty fixture-pair list", evaluateSuite(corpus, [], fingerprintVisualImage, compareVisualFingerprints)],
    ["a fixture-pair list one short of the floor", evaluateSuite(corpus, PAIRS.filter((p) => p.name !== "theme"), fingerprintVisualImage, compareVisualFingerprints), "every fixture pair compares"],
    ["a corpus one fixture short of the floor", evaluateSuite(Object.fromEntries(Object.entries(corpus).filter(([name]) => name !== "vi-cal-red")), PAIRS, fingerprintVisualImage, compareVisualFingerprints), "every fixture image fingerprints"],
    ["a fingerprint that divides by zero on tiny images (NaN)", evaluateExtremes((image) => {
      const result = fingerprintVisualImage(image);
      return result.ok && image.width * image.height < 4 ? { ...result, value: { ...result.value, lumaVariance: NaN } } : result;
    }, compareVisualFingerprints)],
    ["a comparison that returns NaN for zero-variance fills", evaluateExtremes(fingerprintVisualImage, (x, y) => {
      const result = compareVisualFingerprints(x, y);
      return result.ok && x.lumaVariance === 0 && y.lumaVariance === 0 ? { ...result, value: { ...result.value, score: NaN } } : result;
    })]
  ];
  for (const [name, outcomes, mustFail] of mutants) {
    const failing = outcomes.filter((o) => !o.ok).map((o) => o.label);
    const caughtBy = mustFail === undefined || failing.some((label) => label.startsWith(mustFail));
    check(`MUTATION: ${name} fails the suite (${failing.length} checks${mustFail ? `, including "${mustFail}"` : ""})`, failing.length > 0 && caughtBy, `the suite passed a mutant: ${failing.join("; ") || "nothing failed"}`);
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
