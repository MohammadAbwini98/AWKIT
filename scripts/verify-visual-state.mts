/**
 * verify:visual-state — Phase N, N9 (awkit-vra.11): the pure screenshot state library and the frozen acceptance
 * criteria. Plan: docs/plans/ai-upgrade-v5/N9-screenshot-state-recognition.md.
 *
 *   A  decision rules (§ 3) on synthetic features, in order, including every path that must never reach `ready`;
 *   B  the feature extractor on synthetic images: blank, text lines, skeleton blocks, red strokes versus a red fill,
 *      the chrome band, DPR resolution, determinism;
 *   C  motion: identical, changed and resized planes;
 *   D  the frozen policy and criteria are pinned and frozen; the all-`unknown` classifier, one false `ready` and a
 *      false-`error` excess all fail;
 *   E  purity and boundaries: no I/O, clock, randomness, model, OCR or Playwright; the record sanitizer keeps the codes;
 *      the renderer has fixed copy for each; the flag is `on` only.
 *
 * Run: npm run verify:visual-state
 */

import { readFile } from "node:fs/promises";
import {
  MEASURED_VISUAL_STATE_POLICY,
  VisualImage,
  decideVisualState,
  measureVisualMotion,
  measureVisualMotionPlane,
  measureVisualStateFrame,
  type VisualStateFrameFeatures
} from "@src/visual";
import { VISUAL_STATE_CODES, VISUAL_STATE_EXTRA_MS, visualStateMode } from "@src/runner/visualDiagnosis/visualDiagnosisContract";
import { sanitizeVisualDiagnosisRecord } from "@src/runner/visualDiagnosis/visualDiagnosisRecord";
import { N9_FROZEN_CRITERIA, evaluateStateCriteria, type StateTrial } from "./lib/visual-state-criteria.mts";

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

const P = MEASURED_VISUAL_STATE_POLICY;
const base: VisualStateFrameFeatures = {
  version: "awkit-vstate-1",
  cols: 8,
  rows: 8,
  background: 254,
  textCells: 20,
  chromeTextCells: 4,
  skeletonCells: 0,
  redTextCells: 0,
  redFillCells: 0,
  contentLines: 9,
  textSpanCols: 8,
  textSpanRows: 5,
  redStrokeOfInk: 40,
  inkPermille: 30,
  softPermille: 10,
  edgePermille: 40
};
const f = (over: Partial<VisualStateFrameFeatures>): VisualStateFrameFeatures => ({ ...base, ...over });
const still = { measured: true as const, cells: 0, total: 7500, sharePermille: 0 };
const moving = (cells: number) => ({ measured: true as const, cells, total: 7500, sharePermille: Math.floor((cells * 1000) / 7500) });
const decide = (frame: VisualStateFrameFeatures | null, motion: Parameters<typeof decideVisualState>[0]["motion"]) => decideVisualState({ frame, motion }, P);

/** A white page with optional drawing. */
function canvas(width: number, height: number, draw?: (set: (x: number, y: number, rgb: [number, number, number]) => void) => void): VisualImage {
  const data = new Uint8Array(width * height * 4).fill(255);
  const set = (x: number, y: number, [r, g, b]: [number, number, number]) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = (y * width + x) * 4;
    data[p] = r;
    data[p + 1] = g;
    data[p + 2] = b;
  };
  draw?.(set);
  return new VisualImage(width, height, data);
}
const rect = (set: (x: number, y: number, rgb: [number, number, number]) => void, x0: number, y0: number, w: number, h: number, rgb: [number, number, number]) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, rgb);
};
/** Text-like ink: rows of 2 px vertical strokes, 10 px tall, every 32 px from `top`. */
const textLines = (set: Parameters<typeof rect>[0], top: number, lines: number, rgb: [number, number, number] = [20, 20, 20], scale = 1) => {
  for (let line = 0; line < lines; line++) {
    for (let x = 40 * scale; x < 740 * scale; x += 6 * scale) rect(set, x, (top + line * 32) * scale, 2 * scale, 10 * scale, rgb);
  }
};
const measure = (image: VisualImage, scale = 1) => {
  const r = measureVisualStateFrame(image, P, scale);
  if (!r.ok) throw new Error(r.code);
  return r.value;
};

async function main(): Promise<void> {
  console.log("A. Decision rules");
  check("no frame is unknown", decide(null, still).state === "unknown");
  check("a frame of another version is unknown", decide({ ...base, version: "awkit-vstate-0" as never }, still).state === "unknown");
  check("dense, static content is ready", decide(base, still).state === "ready" && decide(base, still).cue === "dense-content");
  check("dense content with ANY localized motion is loading, never ready", decide(base, moving(1)).state === "loading" && decide(base, moving(400)).state === "loading");
  check("widespread motion is unknown, never ready", decide(base, moving(3000)).state === "unknown" && decide(base, moving(3000)).cue === "motion-widespread");
  check("dense content with no second frame is unknown (motion-unmeasured), never ready", decide(base, null).state === "unknown" && decide(base, null).cue === "motion-unmeasured");
  check("dense content whose second frame was a different size is unknown, never ready", decide(base, { measured: false }).state === "unknown");
  check("skeleton blocks with few lines are loading", decide(f({ skeletonCells: 12, contentLines: 2, textCells: 3 }), still).state === "loading");
  check("skeleton-looking blocks among many lines are not a skeleton (gray media)", decide(f({ skeletonCells: 19, contentLines: 6 }), still).state === "ready");
  check("one skeleton cell is not enough", decide(f({ skeletonCells: 1, contentLines: 1, textCells: 1 }), still).state === "empty");
  check("red text strokes with enough share are error", decide(f({ redTextCells: 2, redStrokeOfInk: 400 }), still).state === "error");
  check("red text cells below the stroke share are not error", decide(f({ redTextCells: 2, redStrokeOfInk: 149 }), still).state === "ready");
  check("a red fill alone is never error", decide(f({ redFillCells: 8, redStrokeOfInk: 900 }), still).state === "ready");
  check("motion outranks error (a moving page is loading)", decide(f({ redTextCells: 2, redStrokeOfInk: 400 }), moving(10)).state === "loading");
  check("nothing below the chrome is blank, unknown", decide(f({ textCells: 0, contentLines: 0, chromeTextCells: 4 }), still).cue === "blank");
  check("a few lines in few cells is empty", decide(f({ textCells: 3, contentLines: 2 }), still).state === "empty");
  check("empty needs no second frame (never ready-dependent)", decide(f({ textCells: 3, contentLines: 2 }), null).state === "empty");
  check("between empty and ready is unknown", decide(f({ textCells: 12, contentLines: 4 }), still).state === "unknown");
  let neverReadyWithMotion = true;
  for (const lines of [0, 3, 5, 9, 40]) for (const cells of [0, 6, 30]) for (const m of [1, 50, 2000]) if (decide(f({ contentLines: lines, textCells: cells }), moving(m)).state === "ready") neverReadyWithMotion = false;
  check("sweep: no feature combination with motion is ever ready", neverReadyWithMotion);

  console.log("B. Feature extractor");
  const blank = measure(canvas(800, 600));
  check("a white page has no lines, text, skeleton or red, and decides unknown", blank.features.contentLines === 0 && blank.features.textCells === 0 && blank.features.skeletonCells === 0 && decide(blank.features, still).state === "unknown");
  const lines = measure(canvas(800, 600, (set) => textLines(set, 120, 9)));
  check("nine text lines below the chrome count as nine and decide ready when still", lines.features.contentLines === 9 && decide(lines.features, still).state === "ready", JSON.stringify(lines.features));
  const chromeOnly = measure(canvas(800, 600, (set) => textLines(set, 20, 1)));
  check("text only inside the chrome band counts as chrome, not content", chromeOnly.features.contentLines === 0 && chromeOnly.features.chromeTextCells > 0 && chromeOnly.features.textCells === 0);
  const sparse = measure(canvas(800, 600, (set) => rect(set, 340, 240, 120, 12, [60, 60, 60])));
  check("one short line decides empty", decide(sparse.features, still).state === "empty", JSON.stringify(sparse.features));
  const skeleton = measure(canvas(800, 600, (set) => {
    for (let row = 0; row < 10; row++) for (const [x, w] of [[24, 90], [140, 160], [330, 110], [470, 90], [590, 120]]) rect(set, x, 100 + row * 45, w, 15, [229, 231, 235]);
  }));
  check("light gray blocks are skeleton cells with no lines, deciding loading", skeleton.features.skeletonCells >= 2 && skeleton.features.contentLines === 0 && decide(skeleton.features, still).state === "loading", JSON.stringify(skeleton.features));
  const redStrokes = measure(canvas(800, 600, (set) => textLines(set, 200, 2, [185, 28, 28])));
  check("thin red strokes are red text and decide error", redStrokes.features.redTextCells >= 1 && decide(redStrokes.features, still).state === "error", JSON.stringify(redStrokes.features));
  const redBlock = measure(canvas(800, 600, (set) => {
    textLines(set, 120, 9);
    rect(set, 300, 300, 200, 80, [198, 40, 40]);
  }));
  check("a solid red block is a fill, never red text", redBlock.features.redTextCells === 0 && decide(redBlock.features, still).state !== "error", JSON.stringify(redBlock.features));
  const dpr2 = measure(canvas(1600, 1200, (set) => textLines(set, 120, 9, [20, 20, 20], 2)), 2);
  check("the same nine lines at DPR 2 (analysed at half resolution) still count nine", dpr2.features.contentLines === 9, String(dpr2.features.contentLines));
  const again = measure(canvas(800, 600, (set) => textLines(set, 120, 9)));
  check("measurement is deterministic", JSON.stringify(again.features) === JSON.stringify(lines.features) && Buffer.from(again.motion.plane).equals(Buffer.from(lines.motion.plane)));
  check("a non-image is refused, never thrown", !measureVisualStateFrame({} as VisualImage, P).ok && !measureVisualMotionPlane({} as VisualImage).ok);
  check("features carry numbers only (no arrays, strings beyond the version)", Object.entries(lines.features).every(([k, v]) => (k === "version" ? v === "awkit-vstate-1" : Number.isInteger(v))));

  console.log("C. Motion");
  const a = measureVisualMotionPlane(canvas(800, 600, (set) => rect(set, 380, 280, 40, 40, [37, 99, 235])));
  const b = measureVisualMotionPlane(canvas(800, 600, (set) => rect(set, 384, 280, 40, 40, [37, 99, 235])));
  const c = measureVisualMotionPlane(canvas(800, 500));
  if (!a.ok || !b.ok || !c.ok) throw new Error("motion plane failed");
  const same = measureVisualMotion(a.value, a.value, P);
  const moved = measureVisualMotion(a.value, b.value, P);
  check("identical frames have zero motion cells", same.measured && same.cells === 0);
  check("a moved square is localized motion", moved.measured && moved.cells > 0 && moved.sharePermille <= P.motionWidespread);
  check("a resized viewport is unmeasured, never 'still'", measureVisualMotion(a.value, c.value, P).measured === false);
  check("the frame's own motion plane equals the stand-alone plane", Buffer.from(measure(canvas(800, 600, (set) => rect(set, 380, 280, 40, 40, [37, 99, 235]))).motion.plane).equals(Buffer.from(a.value.plane)));

  console.log("D. Frozen policy and criteria");
  const pinned = {
    hardDelta: 96, softMin: 12, softMax: 64, softSpread: 24, inkDelta: 40, edgeMin: 40, redSpread: 64, redMargin: 48, chromePermille: 125,
    textEdge: 15, skeletonSoft: 100, skeletonMaxEdge: 8, skeletonMaxInk: 5, redTextStroke: 4, redFill: 300, lineMinEdges: 3, lineGap: 3,
    lineMinHeight: 4, motionDelta: 8, motionWidespread: 350, skeletonMinCells: 2, skeletonMaxLines: 4, errorMinCells: 1, errorMinStrokeOfInk: 150,
    emptyMaxLines: 3, emptyMaxCells: 6, readyMinLines: 5
  };
  check("MEASURED_VISUAL_STATE_POLICY equals the plan § 6 freeze and is frozen", JSON.stringify(P) === JSON.stringify(pinned) && Object.isFrozen(P));
  const C = N9_FROZEN_CRITERIA;
  check(
    "N9_FROZEN_CRITERIA is frozen with the plan § 6 numbers",
    C.frozen && C.frozenAt === "2026-10-31" && C.criteria.falseErrorCeilingPermille === 20 && C.criteria.falseErrorPerFixturePermille === 333 &&
      JSON.stringify(C.criteria.recallFloorPermille) === JSON.stringify({ loading: 700, empty: 600, error: 600, ready: 700 }) &&
      C.criteria.decidedFloorPermille === 750 && C.criteria.p95BudgetMs === 600 && C.criteria.p95BudgetMs === VISUAL_STATE_EXTRA_MS
  );
  const truths = ["loading", "empty", "error", "ready"] as const;
  const perfect: StateTrial[] = truths.flatMap((truth) => Array.from({ length: 10 }, (_, i) => ({ fixture: `${truth}-${i % 3}`, truth, adversarial: false, decided: truth, stateMs: 100 })));
  const met = (trials: StateTrial[], id: string, state?: string) => evaluateStateCriteria(trials, C.criteria).filter((r) => r.id === id && (!state || r.state === state)).every((r) => r.met);
  check("a perfect classifier meets S-1 to S-5", ["S-1", "S-2", "S-3", "S-4", "S-5"].every((id) => met(perfect, id)));
  const allUnknown = perfect.map((t) => ({ ...t, decided: "unknown" as const }));
  check("NOT VACUOUS: the all-unknown classifier fails S-3 for every state and S-4", truths.every((s) => !met(allUnknown, "S-3", s)) && !met(allUnknown, "S-4"));
  check("one false ready on a loading trial fails S-1", !met(perfect.map((t, i) => (i === 0 ? { ...t, decided: "ready" as const } : t)), "S-1"));
  check("false errors above the ceiling fail S-2", !met(perfect.map((t) => (t.truth === "ready" ? { ...t, decided: "error" as const } : t)), "S-2"));
  check("a late record fails S-5 even with a fast p95", !met(perfect.map((t, i) => (i === 0 ? { ...t, late: true } : t)), "S-5"));
  check("a slow p95 fails S-5", !met(perfect.map((t) => ({ ...t, stateMs: 900 })), "S-5"));

  console.log("E. Purity and boundaries");
  const source = await readFile("src/visual/state/visualState.ts", "utf8");
  const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).sort();
  check("visualState.ts imports only ../errors, ../fingerprint and ../png", JSON.stringify(imports) === JSON.stringify(["../errors", "../fingerprint", "../png"]), imports.join(","));
  check("no clock, randomness, I/O, model or OCR in the library", !/Date\.|performance\.|Math\.random|require\(|process\.|tesseract|ocr/i.test(source.replace(/^\s*\/?\*.*$/gm, "")));
  const record = sanitizeVisualDiagnosisRecord({ version: 1, stepId: "s1", attempt: 0, failureKind: "locator", outcome: "observed", conditions: "unproven", observations: ["no-target", ...VISUAL_STATE_CODES.slice(0, 6)], referenceSource: "none", examined: 0, domNamed: 0, truncated: false, ms: 10 });
  check("the record sanitizer keeps every visual-state code", !!record && VISUAL_STATE_CODES.slice(0, 6).every((code) => record.observations.includes(code)));
  const copy = await readFile("app/renderer/components/reports/VisualDiagnosisSection.tsx", "utf8");
  check("the drawer has fixed copy for every visual-state code", VISUAL_STATE_CODES.every((code) => copy.includes(`"${code}":`)));
  check("AWKIT_VISUAL_STATE is on only for the exact value 'on'", visualStateMode({ AWKIT_VISUAL_STATE: "on" }) === "on" && ["", "ON", "1", "true", undefined].every((v) => visualStateMode({ AWKIT_VISUAL_STATE: v }) === "off"));
  const engine = await readFile("src/runner/ExecutionEngine.ts", "utf8");
  check("the engine turns state on only together with the N5 diagnosis", /visualStateRecognition: visualDiagnosisMode\(\) === "on" && visualStateMode\(\) === "on"/.test(engine));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

await main();
