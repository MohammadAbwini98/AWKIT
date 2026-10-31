import { lumaOf } from "../fingerprint";
import { VisualImage } from "../png";

/**
 * N8 (awkit-vra.10): deterministic row/grid evidence. Plan: docs/plans/ai-upgrade-v5/N8-row-grid-intelligence.md, owner
 * decisions NR-0 to NR-5 (DECISIONS 2026-10-31).
 *
 * PURE. The DOM proves the structure (a container, its row boxes, each candidate's DOM row); the pixels of ONE container
 * crop only corroborate it. A row association is claimed only when every check passes; any doubt is `inconclusive`, and
 * unmounted or out-of-view rows are reported as not examined, never inferred. Codes only, effect none: nothing here
 * picks, acts on or recovers an element.
 */

export const VISUAL_ROWS_VERSION = "awkit-vrows-1";
/** The most row boxes the adapter reads from one container. */
export const VISUAL_ROWS_MAX_ROWS = 64;

/** Viewport CSS pixels. */
export interface VisualRowsBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisualRowsMember {
  box: VisualRowsBox;
  /** The candidate's DOM row index in the container, or -1 when it is outside the container. */
  rowIndex: number;
  /** The DOM's own hit test at the candidate's visible centre found the candidate (nothing on top of it). */
  topmost: boolean;
}

export interface VisualRowsInput {
  /** The container crop from N5's frame, and the CSS rectangle it covers; null when no crop could be taken. */
  image: VisualImage | null;
  cropCss: VisualRowsBox | null;
  viewport: { width: number; height: number };
  /** DOM facts; null when the first examined candidate has no DOM row ancestor (no structure to examine). */
  dom: null | {
    rows: VisualRowsBox[];
    totalRows: number;
    declaredRows: number | null;
    members: VisualRowsMember[];
  };
  /** The container moved between the DOM read and the frame. */
  stale?: boolean;
}

export interface VisualRowsPolicy {
  /** Allowed slack at a row edge, CSS px. */
  edgeTolerance: number;
  /** Rows thinner than this are not examined, CSS px. */
  minRowHeight: number;
  /** Two bands look alike when at most `alikeMaxCells` of their 32 x 4 luma cells differ by `alikeCellDelta` or more. */
  alikeCellDelta: number;
  alikeMaxCells: number;
  /** A boundary pixel row is quiet when its luma range across the candidate's span is at most this. */
  quietRange: number;
  /** A candidate shows ink when the luma range of its own pixels is at least this. */
  inkRange: number;
}

/** The starting policy (plan § 2). Development only until the baseline freezes it (plan § 5). */
export const DEVELOPMENT_VISUAL_ROWS_POLICY: Readonly<VisualRowsPolicy> = Object.freeze({
  edgeTolerance: 2,
  minRowHeight: 8,
  alikeCellDelta: 96,
  alikeMaxCells: 1,
  quietRange: 40,
  inkRange: 48
});

/**
 * The production policy, FROZEN 2026-10-31 (plan § 5) from the development baseline on variant `a` BEFORE any
 * qualification trial; a literal, so later development edits cannot move it.
 */
export const MEASURED_VISUAL_ROWS_POLICY: Readonly<VisualRowsPolicy> = Object.freeze({
  edgeTolerance: 2,
  minRowHeight: 8,
  alikeCellDelta: 96,
  alikeMaxCells: 1,
  quietRange: 40,
  inkRange: 48
});

export type VisualRowsStructure = "look-alike" | "distinct" | "mixed" | "inconclusive" | "not-examined";
export type VisualRowsAssociation = "consistent" | "inconclusive" | "none";
export type VisualRowsFailure = "outside-container" | "row-not-examined" | "outside-crop" | "crosses-row-edge" | "overlaps-other-row" | "edge-not-quiet" | "no-ink" | "covered" | "rows-overlap" | "no-pixels" | "stale";

export interface VisualRowsVerdict {
  version: typeof VISUAL_ROWS_VERSION;
  structure: VisualRowsStructure;
  association: VisualRowsAssociation;
  /** Some rows were not examined: declared beyond the mounted rows, past the cap, or outside the viewport. */
  partly: boolean;
  /** Rows whose band was examined. */
  examined: number;
  /** Why the association was withheld (the first failure per candidate), for the verifier and the benchmark only. */
  failures: VisualRowsFailure[];
  /** The record codes, at most three. */
  codes: string[];
}

interface Band {
  index: number;
  y0: number;
  y1: number;
  x0: number;
  x1: number;
}

/** Area-averaged luma of a rectangle into `cols` x `rows` cells. */
function regionGrid(luma: Uint8Array, width: number, x0: number, y0: number, x1: number, y1: number, cols: number, rows: number): Uint8Array {
  const out = new Uint8Array(cols * rows);
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  for (let cy = 0; cy < rows; cy++) {
    const ys = y0 + Math.floor((cy * h) / rows);
    const ye = Math.max(ys + 1, y0 + Math.floor(((cy + 1) * h) / rows));
    for (let cx = 0; cx < cols; cx++) {
      const xs = x0 + Math.floor((cx * w) / cols);
      const xe = Math.max(xs + 1, x0 + Math.floor(((cx + 1) * w) / cols));
      let sum = 0;
      for (let y = ys; y < ye; y++) for (let x = xs; x < xe; x++) sum += luma[y * width + x];
      const count = (xe - xs) * (ye - ys);
      out[cy * cols + cx] = Math.floor((sum + (count >> 1)) / count);
    }
  }
  return out;
}

/** A band's 32 x 4 area-averaged luma grid: coarse enough that differing text averages out, fine enough for blocks. */
function bandGrid(luma: Uint8Array, width: number, band: Band): Uint8Array {
  return regionGrid(luma, width, band.x0, band.y0, band.x1, band.y1, 32, 4);
}

/** Cells whose luma differs by at least `delta`. */
function strongDifferences(a: Uint8Array, b: Uint8Array, delta: number): number {
  let cells = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) >= delta) cells += 1;
  return cells;
}

/** Luma range along one pixel row between two columns. */
function rowRange(luma: Uint8Array, width: number, y: number, x0: number, x1: number): number {
  let min = 255;
  let max = 0;
  for (let x = x0; x < x1; x++) {
    const v = luma[y * width + x];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return x1 > x0 ? max - min : 0;
}

function rectRange(luma: Uint8Array, width: number, x0: number, y0: number, x1: number, y1: number): number {
  let min = 255;
  let max = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = luma[y * width + x];
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return x1 > x0 && y1 > y0 ? max - min : 0;
}

const STRUCTURE_CODES: Record<VisualRowsStructure, string> = {
  "look-alike": "rows-look-alike",
  distinct: "rows-distinct",
  mixed: "rows-mixed",
  inconclusive: "rows-inconclusive",
  "not-examined": "rows-not-examined"
};

/** Plan § 2. Never throws: malformed input is `inconclusive`. */
export function decideVisualRows(input: VisualRowsInput, policy: Readonly<VisualRowsPolicy>): VisualRowsVerdict {
  const make = (structure: VisualRowsStructure, association: VisualRowsAssociation, partly: boolean, examined: number, failures: VisualRowsFailure[]): VisualRowsVerdict => {
    const codes = [STRUCTURE_CODES[structure]];
    if (association !== "none") codes.push(association === "consistent" ? "row-association-consistent" : "row-association-inconclusive");
    if (partly) codes.push("rows-partly-examined");
    return { version: VISUAL_ROWS_VERSION, structure, association, partly, examined, failures, codes };
  };
  try {
    const dom = input.dom;
    if (!dom) return make("not-examined", "none", false, 0, []);
    const hasMembers = dom.members.length > 0;
    const { viewport } = input;
    const inView = (r: VisualRowsBox) => r.x >= -policy.edgeTolerance && r.y >= -policy.edgeTolerance && r.x + r.width <= viewport.width + policy.edgeTolerance && r.y + r.height <= viewport.height + policy.edgeTolerance;
    let partly =
      (dom.declaredRows !== null && dom.declaredRows > dom.totalRows) || dom.totalRows > dom.rows.length || dom.rows.some((r) => !inView(r));
    const withheld = (failure: VisualRowsFailure, examined = 0): VisualRowsVerdict => make("inconclusive", hasMembers ? "inconclusive" : "none", partly, examined, hasMembers ? [failure] : []);
    if (input.stale) return withheld("stale");
    const image = input.image;
    const crop = input.cropCss;
    if (!image || !crop || crop.width <= 0 || crop.height <= 0 || !(image instanceof VisualImage)) return withheld("no-pixels");

    const sx = image.width / crop.width;
    const sy = image.height / crop.height;
    const tol = policy.edgeTolerance;
    const toBand = (r: VisualRowsBox, index: number): Band | null => {
      if (r.height < policy.minRowHeight || r.width <= 0) return null;
      if (r.x < crop.x - tol || r.y < crop.y - tol || r.x + r.width > crop.x + crop.width + tol || r.y + r.height > crop.y + crop.height + tol) return null;
      const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
      return {
        index,
        x0: clamp(Math.round((r.x - crop.x) * sx), image.width),
        x1: clamp(Math.round((r.x + r.width - crop.x) * sx), image.width),
        y0: clamp(Math.round((r.y - crop.y) * sy), image.height),
        y1: clamp(Math.round((r.y + r.height - crop.y) * sy), image.height)
      };
    };
    const bands = dom.rows.map(toBand).filter((b): b is Band => b !== null && b.y1 > b.y0 && b.x1 > b.x0);
    if (bands.length < dom.rows.length) partly = true;
    const byIndex = new Map(bands.map((b) => [b.index, b]));
    const sorted = [...bands].sort((a, b) => a.y0 - b.y0);
    const tolPx = Math.max(1, Math.round(tol * sy));
    for (let i = 1; i < sorted.length; i++) if (sorted[i].y0 < sorted[i - 1].y1 - tolPx) return withheld("rows-overlap", bands.length);

    const luma = lumaOf(image);
    const width = image.width;
    let structure: VisualRowsStructure = "inconclusive";
    if (bands.length >= 2) {
      const grids = bands.map((b) => bandGrid(luma, width, b));
      let alike = 0;
      for (let i = 0; i < grids.length; i++) {
        let hasTwin = false;
        for (let j = 0; j < grids.length && !hasTwin; j++) if (i !== j && strongDifferences(grids[i], grids[j], policy.alikeCellDelta) <= policy.alikeMaxCells) hasTwin = true;
        if (hasTwin) alike += 1;
      }
      structure = alike === grids.length ? "look-alike" : alike === 0 ? "distinct" : "mixed";
    }

    if (!hasMembers) return make(structure, "none", partly, bands.length, []);
    const failures: VisualRowsFailure[] = [];
    for (const member of dom.members) {
      const failure = ((): VisualRowsFailure | null => {
        if (member.rowIndex < 0) return "outside-container";
        const band = byIndex.get(member.rowIndex);
        if (!band) return "row-not-examined";
        const b = member.box;
        if (b.x < crop.x - tol || b.y < crop.y - tol || b.x + b.width > crop.x + crop.width + tol || b.y + b.height > crop.y + crop.height + tol) return "outside-crop";
        const mx0 = Math.max(0, Math.round((b.x - crop.x) * sx));
        const mx1 = Math.min(image.width, Math.round((b.x + b.width - crop.x) * sx));
        const my0 = Math.max(0, Math.round((b.y - crop.y) * sy));
        const my1 = Math.min(image.height, Math.round((b.y + b.height - crop.y) * sy));
        if (mx1 <= mx0 || my1 <= my0) return "no-ink";
        if (my0 < band.y0 - tolPx || my1 > band.y1 + tolPx) return "crosses-row-edge";
        for (const other of bands) if (other !== band && Math.min(my1, other.y1) - Math.max(my0, other.y0) > tolPx) return "overlaps-other-row";
        if (!member.topmost) return "covered";
        for (const y of [band.y0, band.y1 - 1]) if (y >= 0 && y < image.height && rowRange(luma, width, y, mx0, mx1) > policy.quietRange) return "edge-not-quiet";
        if (rectRange(luma, width, mx0, my0, mx1, my1) < policy.inkRange) return "no-ink";
        return null;
      })();
      if (failure) failures.push(failure);
    }
    return make(structure, failures.length === 0 ? "consistent" : "inconclusive", partly, bands.length, failures);
  } catch {
    return make("inconclusive", input.dom && input.dom.members.length > 0 ? "inconclusive" : "none", false, 0, ["no-pixels"]);
  }
}
