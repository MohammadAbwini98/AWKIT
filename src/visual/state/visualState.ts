import { visualFailure, visualSuccess, type VisualResult } from "../errors";
import { downsamplePlane, edgePlane, lumaOf } from "../fingerprint";
import { VisualImage } from "../png";

/**
 * N9 (awkit-vra.11): deterministic screenshot state recognition. Plan: docs/plans/ai-upgrade-v5/N9-screenshot-state-
 * recognition.md, owner decisions NS-0 to NS-4 (DECISIONS 2026-10-31).
 *
 * PURE. Integer arithmetic over one viewport image (and, for motion, a second one), no I/O, no clock, no model, no OCR.
 * The result is advisory evidence for the N5 diagnosis record (codes only, effect none); it never picks, waits, retries
 * or decides a step. `unknown` is the default, and `ready` is never claimed without a measured, static second frame.
 */

export const VISUAL_STATE_VERSION = "awkit-vstate-1";
export const VISUAL_STATE_GRID_COLS = 8;
export const VISUAL_STATE_GRID_ROWS = 8;
/** Motion cells are this many analysis pixels square (about 8 CSS px). */
export const VISUAL_STATE_MOTION_CELL_PX = 8;

export type VisualStateKind = "loading" | "empty" | "error" | "ready" | "unknown";
export type VisualStateCue =
  | "motion"
  | "motion-widespread"
  | "skeleton"
  | "error-colour"
  | "blank"
  | "sparse-content"
  | "motion-unmeasured"
  | "dense-content"
  | "indeterminate";

/** Cell counts, line counts and whole-frame shares in permille. Numbers only: no pixels, text or coordinates. */
export interface VisualStateFrameFeatures {
  version: typeof VISUAL_STATE_VERSION;
  cols: number;
  rows: number;
  background: number;
  /** Text cells below the chrome band, and in it. */
  textCells: number;
  chromeTextCells: number;
  skeletonCells: number;
  redTextCells: number;
  redFillCells: number;
  /** Text lines (horizontal bands of edge ink) below the chrome band. */
  contentLines: number;
  /** Content text cells' bounding box in cells (0 when there are none). */
  textSpanCols: number;
  textSpanRows: number;
  /** Red stroke pixels as a share of all ink pixels, permille. */
  redStrokeOfInk: number;
  inkPermille: number;
  softPermille: number;
  edgePermille: number;
}

export interface VisualMotionPlane {
  cols: number;
  rows: number;
  plane: Uint8Array;
}

/** One measured frame: its features and its motion plane (held in memory only, never persisted). */
export interface VisualStateFrame {
  features: VisualStateFrameFeatures;
  motion: VisualMotionPlane;
}

export type VisualMotion = { measured: true; cells: number; total: number; sharePermille: number } | { measured: false };

export interface VisualStatePolicy {
  /** Per pixel. */
  hardDelta: number;
  softMin: number;
  softMax: number;
  softSpread: number;
  inkDelta: number;
  edgeMin: number;
  redSpread: number;
  redMargin: number;
  /** The top band treated as page chrome (header, title bar), permille of the height. */
  chromePermille: number;
  /** Per cell, permille of the cell area. */
  textEdge: number;
  skeletonSoft: number;
  skeletonMaxEdge: number;
  skeletonMaxInk: number;
  redTextStroke: number;
  redFill: number;
  /** Lines: a pixel row is inked with at least this many edge pixels; bands closer than the gap merge. */
  lineMinEdges: number;
  lineGap: number;
  lineMinHeight: number;
  /** Motion. */
  motionDelta: number;
  motionWidespread: number;
  /** Rules. */
  skeletonMinCells: number;
  skeletonMaxLines: number;
  errorMinCells: number;
  errorMinStrokeOfInk: number;
  emptyMaxLines: number;
  emptyMaxCells: number;
  readyMinLines: number;
}

/** The starting policy (plan § 3), revised on development variant `a` only (plan § 6). */
export const DEVELOPMENT_VISUAL_STATE_POLICY: Readonly<VisualStatePolicy> = Object.freeze({
  hardDelta: 96,
  softMin: 12,
  softMax: 64,
  softSpread: 24,
  inkDelta: 40,
  edgeMin: 40,
  redSpread: 64,
  redMargin: 48,
  chromePermille: 125,
  textEdge: 15,
  skeletonSoft: 100,
  skeletonMaxEdge: 8,
  skeletonMaxInk: 5,
  redTextStroke: 4,
  redFill: 300,
  lineMinEdges: 3,
  lineGap: 3,
  lineMinHeight: 4,
  motionDelta: 8,
  motionWidespread: 350,
  skeletonMinCells: 2,
  skeletonMaxLines: 4,
  errorMinCells: 1,
  errorMinStrokeOfInk: 150,
  emptyMaxLines: 3,
  emptyMaxCells: 6,
  readyMinLines: 5
});

/**
 * The production policy, FROZEN 2026-10-31 (plan § 6) from the development baseline on variant `a` BEFORE any
 * qualification trial. Qualification results never change it: a missed criterion is recorded NOT MET and its code is
 * pruned from exposure instead. A literal, so later development edits cannot move it.
 */
export const MEASURED_VISUAL_STATE_POLICY: Readonly<VisualStatePolicy> = Object.freeze({
  hardDelta: 96,
  softMin: 12,
  softMax: 64,
  softSpread: 24,
  inkDelta: 40,
  edgeMin: 40,
  redSpread: 64,
  redMargin: 48,
  chromePermille: 125,
  textEdge: 15,
  skeletonSoft: 100,
  skeletonMaxEdge: 8,
  skeletonMaxInk: 5,
  redTextStroke: 4,
  redFill: 300,
  lineMinEdges: 3,
  lineGap: 3,
  lineMinHeight: 4,
  motionDelta: 8,
  motionWidespread: 350,
  skeletonMinCells: 2,
  skeletonMaxLines: 4,
  errorMinCells: 1,
  errorMinStrokeOfInk: 150,
  emptyMaxLines: 3,
  emptyMaxCells: 6,
  readyMinLines: 5
});

export interface VisualStateVerdict {
  version: typeof VISUAL_STATE_VERSION;
  state: VisualStateKind;
  cue: VisualStateCue;
}

function cellStart(index: number, cells: number, size: number): number {
  return Math.floor((index * size) / cells);
}

function cellEnd(index: number, cells: number, size: number): number {
  return Math.max(cellStart(index, cells, size) + 1, Math.floor(((index + 1) * size) / cells));
}

const permille = (part: number, whole: number): number => (whole > 0 ? Math.floor((part * 1000) / whole) : 0);

/** The most frequent luma bucket (64 buckets of 4), as that bucket's centre. */
function backgroundOf(luma: Uint8Array): number {
  const histogram = new Uint32Array(64);
  for (let i = 0; i < luma.length; i++) histogram[luma[i] >> 2] += 1;
  let best = 0;
  for (let bucket = 1; bucket < 64; bucket++) if (histogram[bucket] > histogram[best]) best = bucket;
  return best * 4 + 2;
}

/** The analysis image's sampling step: 2 at DPR 1.75 and above, otherwise 1 (see `analysisImage`). */
function analysisStep(scale: number): 1 | 2 {
  return Number.isFinite(scale) && scale >= 1.75 ? 2 : 1;
}

/**
 * awkit-vra.18 (campaign 10): the pixels `measureVisualStateFrame` and `measureVisualMotionPlane` actually analyse for an
 * image of `width` x `height` device pixels at `scale` (a quarter at DPR 2). A reserve for that work counts these.
 */
export function visualStateAnalysisPixels(width: number, height: number, scale: number): number {
  if (!(width > 0 && height > 0)) return 0;
  const step = analysisStep(scale);
  return Math.max(1, Math.floor(width / step)) * Math.max(1, Math.floor(height / step));
}

/**
 * The analysis image: device pixels at DPR below 1.75, every second pixel at 1.75 and above, so the features are taken
 * at about CSS resolution (thresholds hold across DPR, and the cost at DPR 2 is a quarter). Nearest sampling, exact.
 */
function analysisImage(image: VisualImage, scale: number): VisualImage {
  const step = analysisStep(scale);
  if (step === 1) return image;
  const width = Math.max(1, Math.floor(image.width / step));
  const height = Math.max(1, Math.floor(image.height / step));
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = ((y * step) * image.width + x * step) * 4;
      const to = (y * width + x) * 4;
      data[to] = image.data[from];
      data[to + 1] = image.data[from + 1];
      data[to + 2] = image.data[from + 2];
      data[to + 3] = image.data[from + 3];
    }
  }
  return new VisualImage(width, height, data);
}

function motionPlaneOf(luma: Uint8Array, width: number, height: number): VisualMotionPlane {
  const cols = Math.max(1, Math.ceil(width / VISUAL_STATE_MOTION_CELL_PX));
  const rows = Math.max(1, Math.ceil(height / VISUAL_STATE_MOTION_CELL_PX));
  return { cols, rows, plane: downsamplePlane(luma, width, height, cols, rows) };
}

/** The motion plane alone (the second frame needs nothing else). Never throws. */
export function measureVisualMotionPlane(image: VisualImage, scale = 1): VisualResult<VisualMotionPlane> {
  try {
    if (!(image instanceof VisualImage)) return visualFailure("FINGERPRINT_FAILED", "the input is not a decoded visual image");
    const analysed = analysisImage(image, scale);
    return visualSuccess(motionPlaneOf(lumaOf(analysed), analysed.width, analysed.height));
  } catch (error) {
    return visualFailure("FINGERPRINT_FAILED", error instanceof Error ? error.message : "the motion measurement failed");
  }
}

/**
 * Measure one viewport image. `scale` is device pixels per CSS pixel (the frame's `scaleX`): it picks the analysis
 * resolution so the features are taken at about CSS pixels. Never throws.
 */
export function measureVisualStateFrame(image: VisualImage, policy: Readonly<VisualStatePolicy>, scale = 1): VisualResult<VisualStateFrame> {
  try {
    if (!(image instanceof VisualImage)) return visualFailure("FINGERPRINT_FAILED", "the input is not a decoded visual image");
    const analysed = analysisImage(image, scale);
    const { width, height, data } = analysed;
    const luma = lumaOf(analysed);
    const edges = edgePlane(luma, width, height);
    const background = backgroundOf(luma);
    const pixels = width * height;
    const chromeHeight = Math.floor((height * policy.chromePermille) / 1000);

    // Saturated, red-hued pixels. A red pixel is a fill "core" when the pixels two away in all four directions are red
    // too; otherwise it is a stroke (thin glyphs and borders). Error text is strokes; buttons, brand bars and toasts
    // are mostly cores.
    const red = new Uint8Array(pixels);
    for (let i = 0, p = 0; i < pixels; i++, p += 4) {
      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];
      const max = Math.max(r, g, b);
      const spread = max - Math.min(r, g, b);
      if (r === max && spread >= policy.redSpread && r - Math.max(g, b) >= policy.redMargin && Math.abs(g - b) * 3 <= spread) red[i] = 1;
    }
    const reach = 2;

    const cols = VISUAL_STATE_GRID_COLS;
    const rows = VISUAL_STATE_GRID_ROWS;
    let textCells = 0;
    let chromeTextCells = 0;
    let skeletonCells = 0;
    let redTextCells = 0;
    let redFillCells = 0;
    let minCol = cols;
    let maxCol = -1;
    let minRow = rows;
    let maxRow = -1;
    let inkTotal = 0;
    let softTotal = 0;
    let edgeTotal = 0;
    let redStrokeTotal = 0;

    for (let cy = 0; cy < rows; cy++) {
      const y0 = cellStart(cy, rows, height);
      const y1 = cellEnd(cy, rows, height);
      const chrome = (y0 + y1) >> 1 < chromeHeight;
      for (let cx = 0; cx < cols; cx++) {
        const x0 = cellStart(cx, cols, width);
        const x1 = cellEnd(cx, cols, width);
        const area = (x1 - x0) * (y1 - y0);
        let ink = 0;
        let hard = 0;
        let soft = 0;
        let edge = 0;
        let redAll = 0;
        let redStroke = 0;
        let redCore = 0;
        for (let y = y0; y < y1; y++) {
          const row = y * width;
          for (let x = x0; x < x1; x++) {
            const i = row + x;
            const delta = Math.abs(luma[i] - background);
            if (edges[i] >= policy.edgeMin) edge += 1;
            if (red[i]) {
              redAll += 1;
              const core =
                x - reach >= 0 && x + reach < width && y - reach >= 0 && y + reach < height &&
                red[i - reach] === 1 && red[i + reach] === 1 && red[i - reach * width] === 1 && red[i + reach * width] === 1;
              if (core) redCore += 1;
              else redStroke += 1;
            }
            if (delta >= policy.inkDelta || red[i]) ink += 1;
            if (delta >= policy.hardDelta) hard += 1;
            if (delta >= policy.softMin && delta < policy.softMax) {
              const p = i * 4;
              const spread = Math.max(data[p], data[p + 1], data[p + 2]) - Math.min(data[p], data[p + 1], data[p + 2]);
              if (spread <= policy.softSpread) soft += 1;
            }
          }
        }
        inkTotal += ink;
        softTotal += soft;
        edgeTotal += edge;
        redStrokeTotal += redStroke;
        const edgeP = permille(edge, area);
        const isRedFill = permille(redAll, area) >= policy.redFill;
        const isText = edgeP >= policy.textEdge;
        if (isRedFill) redFillCells += 1;
        // Red text: thin red strokes are most of the cell's ink, with almost no solid red.
        if (!isRedFill && isText && permille(redStroke, area) >= policy.redTextStroke && redStroke * 2 >= ink && redCore * 4 <= redStroke) redTextCells += 1;
        if (isText) {
          if (chrome) {
            chromeTextCells += 1;
          } else {
            textCells += 1;
            minCol = Math.min(minCol, cx);
            maxCol = Math.max(maxCol, cx);
            minRow = Math.min(minRow, cy);
            maxRow = Math.max(maxRow, cy);
          }
        } else if (permille(soft, area) >= policy.skeletonSoft && edgeP < policy.skeletonMaxEdge && permille(hard, area) < policy.skeletonMaxInk) {
          skeletonCells += 1;
        }
      }
    }

    // Text lines below the chrome band: runs of pixel rows with edge ink, merged across small gaps.
    let contentLines = 0;
    let bandStart = -1;
    let lastInked = -1;
    const closeBand = (): void => {
      if (bandStart >= 0 && lastInked - bandStart + 1 >= policy.lineMinHeight) contentLines += 1;
    };
    for (let y = chromeHeight; y < height; y++) {
      let count = 0;
      const row = y * width;
      for (let x = 0; x < width && count < policy.lineMinEdges; x++) if (edges[row + x] >= policy.edgeMin) count += 1;
      if (count < policy.lineMinEdges) continue;
      if (bandStart < 0 || y - lastInked > policy.lineGap + 1) {
        closeBand();
        bandStart = y;
      }
      lastInked = y;
    }
    closeBand();

    return visualSuccess({
      features: {
        version: VISUAL_STATE_VERSION,
        cols,
        rows,
        background,
        textCells,
        chromeTextCells,
        skeletonCells,
        redTextCells,
        redFillCells,
        contentLines,
        textSpanCols: maxCol >= 0 ? maxCol - minCol + 1 : 0,
        textSpanRows: maxRow >= 0 ? maxRow - minRow + 1 : 0,
        redStrokeOfInk: permille(redStrokeTotal, inkTotal),
        inkPermille: permille(inkTotal, pixels),
        softPermille: permille(softTotal, pixels),
        edgePermille: permille(edgeTotal, pixels)
      },
      motion: motionPlaneOf(luma, width, height)
    });
  } catch (error) {
    return visualFailure("FINGERPRINT_FAILED", error instanceof Error ? error.message : "the state measurement failed");
  }
}

/** Compare two motion planes. A different grid (the viewport changed size) is unmeasured, never "no motion". */
export function measureVisualMotion(first: VisualMotionPlane, second: VisualMotionPlane, policy: Readonly<VisualStatePolicy>): VisualMotion {
  if (first.cols !== second.cols || first.rows !== second.rows || first.plane.length !== second.plane.length) return { measured: false };
  let cells = 0;
  for (let i = 0; i < first.plane.length; i++) if (Math.abs(first.plane[i] - second.plane[i]) >= policy.motionDelta) cells += 1;
  return { measured: true, cells, total: first.plane.length, sharePermille: permille(cells, first.plane.length) };
}

/** Plan § 3 rules, in order; the first match wins. `motion` null means no second frame was measured. */
export function decideVisualState(
  input: { frame: VisualStateFrameFeatures | null; motion: VisualMotion | null },
  policy: Readonly<VisualStatePolicy>
): VisualStateVerdict {
  const verdict = (state: VisualStateKind, cue: VisualStateCue): VisualStateVerdict => ({ version: VISUAL_STATE_VERSION, state, cue });
  const frame = input.frame;
  if (!frame || frame.version !== VISUAL_STATE_VERSION) return verdict("unknown", "indeterminate");
  const motion = input.motion;
  // 1. Anything moving: a spinner, shimmer or progress bar. Never `ready`.
  if (motion?.measured && motion.cells > 0) {
    return motion.sharePermille > policy.motionWidespread ? verdict("unknown", "motion-widespread") : verdict("loading", "motion");
  }
  // 2. Static skeleton blocks with little real text.
  if (frame.skeletonCells >= policy.skeletonMinCells && frame.contentLines <= policy.skeletonMaxLines) return verdict("loading", "skeleton");
  // 3. Red text strokes.
  if (frame.redTextCells >= policy.errorMinCells && frame.redStrokeOfInk >= policy.errorMinStrokeOfInk) return verdict("error", "error-colour");
  // 4. Nothing below the chrome band.
  if (frame.contentLines === 0 && frame.textCells === 0 && frame.skeletonCells === 0 && frame.redFillCells === 0) return verdict("unknown", "blank");
  // 5. A few lines of content: an empty state's message.
  if (frame.contentLines <= policy.emptyMaxLines && frame.textCells <= policy.emptyMaxCells) return verdict("empty", "sparse-content");
  // 6. `ready` needs a measured, static second frame.
  if (!motion?.measured) return verdict("unknown", "motion-unmeasured");
  // 7. Many lines of static content.
  if (frame.contentLines >= policy.readyMinLines) return verdict("ready", "dense-content");
  return verdict("unknown", "indeterminate");
}
