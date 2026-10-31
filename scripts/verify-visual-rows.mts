/**
 * verify:visual-rows — Phase N, N8 (awkit-vra.10): the pure row/grid decision and its runtime inside the REAL N5
 * adapter, in real Chromium against the Visual Rows Lab. Plan: docs/plans/ai-upgrade-v5/N8-row-grid-intelligence.md.
 *
 *   A  decideVisualRows on synthetic inputs: each withheld path (outside the container, crossing a row edge,
 *      overlapping rows, covered, no ink, a noisy edge, stale, no pixels), the consistent path, coverage flags
 *      (declared beyond mounted, out of view, the cap), look-alike versus distinct bands, never more than three codes;
 *   B  the frozen policy and criteria pinned; one adversarial claim fails R-1, one missed coverage code fails R-4;
 *   C  runtime (R-6, R-7): flag off adds no row code and reads no DOM row; flag on: consistent, displaced
 *      (withheld), no rows (not examined), virtualized (partly examined), still exactly one frame; protected and
 *      handed-off pages take zero frames and add no code; the N5 part of the record is unchanged; no page interaction;
 *      2026-11-01 review fixes: S1 (a password form injected before the frame: refused, no row or state code), F4
 *      (opacity compounds up the chain), F6 (no page read after a cut during the row read; the container crop is
 *      dropped before its frame is released, also after a cut while the frame is held);
 *   D  purity and wiring: the library's imports; the engine, runner and adapter gates; drawer copy for each code.
 *
 * Run: npm run verify:visual-rows
 */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { VisualFailureDiagnosis } from "@src/runner/visualDiagnosis/VisualFailureDiagnosis";
import { VISUAL_ROWS_CODES, visualRowsMode, type VisualDiagnosisRecord } from "@src/runner/visualDiagnosis/visualDiagnosisContract";
import type { FlowStep } from "@src/profiles/FlowProfile";
import { MEASURED_VISUAL_ROWS_POLICY, VisualImage, decideVisualRows, type VisualRowsInput } from "@src/visual";
import { N8_FROZEN_CRITERIA, evaluateRowsCriteria, type RowsTrial } from "./lib/visual-rows-criteria.mts";

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

const P = MEASURED_VISUAL_ROWS_POLICY;
/** A 600 x 400 container crop at (0,0) with `rows` 40-px bands, each drawn by `draw(row, set)`. */
function container(rows: number, draw: (row: number, set: (x: number, y: number, v: number) => void) => void): VisualImage {
  const width = 600;
  const height = 400;
  const data = new Uint8Array(width * height * 4).fill(255);
  const set = (x: number, y: number, v: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = (y * width + x) * 4;
    data[p] = data[p + 1] = data[p + 2] = v;
  };
  for (let r = 0; r < rows; r++) draw(r, set);
  return new VisualImage(width, height, data);
}
const rowBoxes = (n: number) => Array.from({ length: n }, (_, i) => ({ x: 0, y: i * 40, width: 600, height: 40 }));
/** A row with a text-like label and an outlined button at (500, 10, 80, 20). */
const plainRow = (r: number, set: (x: number, y: number, v: number) => void) => {
  for (let x = 20; x < 120; x += 4) for (let y = r * 40 + 14; y < r * 40 + 26; y++) set(x, y, 40);
  for (let x = 500; x < 580; x++) {
    set(x, r * 40 + 10, 30);
    set(x, r * 40 + 29, 30);
  }
  for (let y = r * 40 + 10; y < r * 40 + 30; y++) {
    set(500, y, 30);
    set(579, y, 30);
  }
};
const base = (over: Partial<VisualRowsInput> = {}, dom: Partial<NonNullable<VisualRowsInput["dom"]>> = {}): VisualRowsInput => ({
  image: container(10, plainRow),
  cropCss: { x: 0, y: 0, width: 600, height: 400 },
  viewport: { width: 800, height: 600 },
  dom: { rows: rowBoxes(10), totalRows: 10, declaredRows: null, members: [{ box: { x: 500, y: 130, width: 80, height: 20 }, rowIndex: 3, topmost: true }], ...dom },
  ...over
});
const decide = (input: VisualRowsInput) => decideVisualRows(input, P);

const PORT = 4614;
const BASE = `http://127.0.0.1:${PORT}`;
const LAB = `${BASE}/visual-intelligence/rows`;
let browser: Browser | undefined;
let seq = 0;

async function lab(fixture: string, variant = "b"): Promise<Page> {
  const page = await browser!.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto(LAB);
  await page.waitForSelector("body[data-fixtures]");
  await page.evaluate(([id, v]) => (window as unknown as { __rowsLab: { show(i: string, x: string): Promise<unknown> } }).__rowsLab.show(id, v), [fixture, variant]);
  await page.waitForSelector(`#rw-stage[data-shown="${fixture}:${variant}"]`);
  // Count DOM row reads: the adapter's row read is the only caller of Element.closest on this page.
  await page.evaluate(() => {
    const original = Element.prototype.closest;
    (window as unknown as { __closest: number }).__closest = 0;
    Element.prototype.closest = function (this: Element, selector: string) {
      (window as unknown as { __closest: number }).__closest += 1;
      return original.call(this, selector);
    } as typeof Element.prototype.closest;
  });
  return page;
}

async function diagnose(
  page: Page,
  options: { rows?: boolean; state?: boolean; handedOff?: boolean; locator?: string; deadlineMs?: number; beforeFrame?: () => Promise<void>; afterFrame?: () => Promise<void> } = {}
) {
  const frames = { taken: 0, released: 0 };
  /** Frame and container-crop events in order (QC finding 7: the crop never outlives its frame). */
  const events: string[] = [];
  const records: VisualDiagnosisRecord[] = [];
  const diagnosis = new VisualFailureDiagnosis({
    folder: join(process.cwd(), "build", "n8-verify-no-references"),
    handedOff: () => options.handedOff === true,
    reader: { get: async () => ({ status: "missing" }) as never },
    onRecord: (record) => records.push(record),
    ...(options.rows ? { rowEvidence: true } : {}),
    ...(options.state ? { stateRecognition: true } : {}),
    ...(options.deadlineMs ? { deadlineMs: options.deadlineMs } : {}),
    probe: {
      hold: async (stage) => {
        if (stage === "before-frame") await options.beforeFrame?.();
        else await options.afterFrame?.();
      },
      onFrame: (event) => {
        events.push(`frame-${event}`);
        if (event === "taken") frames.taken += 1;
        else if (event === "released") frames.released += 1;
      },
      onRowCrop: (event) => events.push(`crop-${event}`)
    }
  });
  const step = { id: "n8-verify", name: "Rows", type: "click", timeoutMs: 800, locator: { strategy: "testId", value: options.locator ?? "rw-target" } } as unknown as FlowStep;
  const record = await diagnosis.diagnoseFinalFailure({
    step,
    attempt: 0,
    errorClass: "locator",
    executionId: `n8-verify-${(seq += 1)}`,
    scenarioId: "n8",
    flowId: "n8-flow",
    page: async () => page,
    limitScreenshot: (fn) => fn()
  });
  const closest = await page.evaluate(() => (window as unknown as { __closest: number }).__closest);
  const interactions = await page.evaluate(() => (window as unknown as { __rowsLab: { interactions: number } }).__rowsLab.interactions);
  const observations = record?.observations ?? [];
  return {
    record,
    frames,
    events,
    diagnosis,
    closest,
    interactions,
    codes: observations.filter((c) => c.startsWith("rows-") || c.startsWith("row-association-")),
    state: observations.filter((c) => c.startsWith("visual-state-"))
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  console.log("A. Decision (pure)");
  const ok = decide(base());
  check("a candidate inside its own quiet, inked row is consistent", ok.association === "consistent" && ok.codes.includes("row-association-consistent"), JSON.stringify(ok));
  check("identical rows are look-alike", ok.structure === "look-alike");
  check("no DOM row structure is not examined, with no association code", JSON.stringify(decide({ ...base(), dom: null }).codes) === '["rows-not-examined"]');
  check("a stale container withholds everything", decide({ ...base(), stale: true }).association === "inconclusive" && decide({ ...base(), stale: true }).structure === "inconclusive");
  check("no pixels withholds everything", decide({ ...base(), image: null }).association === "inconclusive");
  check("a candidate outside the container is withheld", decide(base({}, { members: [{ box: { x: 500, y: 130, width: 80, height: 20 }, rowIndex: -1, topmost: true }] })).failures[0] === "outside-container");
  check("a candidate straddling two rows is withheld (crosses-row-edge)", decide(base({}, { members: [{ box: { x: 500, y: 150, width: 80, height: 20 }, rowIndex: 3, topmost: true }] })).failures[0] === "crosses-row-edge");
  check("a candidate drawn in another row is withheld", decide(base({}, { members: [{ box: { x: 500, y: 170, width: 80, height: 20 }, rowIndex: 3, topmost: true }] })).association === "inconclusive");
  check("QC 3: a candidate reaching past its row sideways is withheld", decide(base({}, { rows: rowBoxes(10).map((r) => ({ ...r, width: 520 })), members: [{ box: { x: 500, y: 130, width: 80, height: 20 }, rowIndex: 3, topmost: true }] })).failures[0] === "crosses-row-edge");
  check("a covered candidate is withheld", decide(base({}, { members: [{ box: { x: 500, y: 130, width: 80, height: 20 }, rowIndex: 3, topmost: false }] })).failures[0] === "covered");
  check("an invisible candidate (no ink) is withheld", decide(base({ image: container(10, () => undefined) })).failures[0] === "no-ink");
  const noisy = container(10, (r, set) => {
    plainRow(r, set);
    if (r === 3) for (let x = 500; x < 580; x += 2) set(x, r * 40, 0);
  });
  check("ink crossing the row's edge is withheld (edge-not-quiet)", decide(base({ image: noisy })).failures[0] === "edge-not-quiet");
  const overlapping = rowBoxes(10).map((r, i) => ({ ...r, y: i * 30 }));
  check("overlapping rows are inconclusive, never an association", decide(base({}, { rows: overlapping.map((r) => ({ ...r, height: 40 })) })).failures[0] === "rows-overlap");
  check("one bad candidate among several withholds the association", decide(base({}, { members: [{ box: { x: 500, y: 130, width: 80, height: 20 }, rowIndex: 3, topmost: true }, { box: { x: 500, y: 170, width: 80, height: 20 }, rowIndex: 4, topmost: false }] })).association === "inconclusive");
  check("declared rows beyond the mounted ones are partly examined", decide(base({}, { declaredRows: 500 })).codes.includes("rows-partly-examined"));
  check("rows below the viewport are partly examined", decide(base({}, { rows: [...rowBoxes(10), { x: 0, y: 700, width: 600, height: 40 }], totalRows: 11 })).partly);
  check("rows past the read cap are partly examined", decide(base({}, { totalRows: 200 })).partly);
  const distinct = container(10, (r, set) => {
    for (let x = 30 + r * 50; x < 30 + r * 50 + 40; x++) for (let y = r * 40 + 5; y < r * 40 + 35; y++) set(x, y, 20);
  });
  check("bands with a solid block in a different place each are distinct", decide(base({ image: distinct }, { members: [] })).structure === "distinct");
  check("fewer than two examined rows is structure-inconclusive", decide(base({}, { rows: rowBoxes(1), totalRows: 1, members: [] })).structure === "inconclusive");
  check("never more than three codes", [base(), base({}, { declaredRows: 500 }), { ...base(), dom: null }].every((i) => decide(i).codes.length <= 3));
  check("malformed input never throws", (() => {
    try {
      decide({ image: {} as VisualImage, cropCss: { x: 0, y: 0, width: 1, height: 1 }, viewport: { width: 1, height: 1 }, dom: { rows: [], totalRows: 0, declaredRows: null, members: [] } });
      return true;
    } catch {
      return false;
    }
  })());

  console.log("B. Frozen policy and criteria");
  check("MEASURED_VISUAL_ROWS_POLICY equals the plan § 5 freeze and is frozen", JSON.stringify(P) === JSON.stringify({ edgeTolerance: 2, minRowHeight: 8, alikeCellDelta: 96, alikeMaxCells: 1, quietRange: 40, inkRange: 48 }) && Object.isFrozen(P));
  const C = N8_FROZEN_CRITERIA;
  check("N8_FROZEN_CRITERIA is frozen with the plan § 5 numbers", C.frozen && C.frozenAt === "2026-10-31" && JSON.stringify(C.criteria) === JSON.stringify({ associationFloorPermille: 800, alikeFloorPermille: 800, alikeOnDistinctCeilingPermille: 100, p95BudgetMs: 150 }));
  const good: RowsTrial[] = [
    ...Array.from({ length: 5 }, () => ({ fixture: "u", adversarial: false, truthAssociation: "consistent" as const, truthStructure: "look-alike" as const, truthCoverage: "full" as const, codes: ["rows-look-alike", "row-association-consistent"], rowMs: 20 })),
    ...Array.from({ length: 5 }, () => ({ fixture: "d", adversarial: false, truthAssociation: "consistent" as const, truthStructure: "distinct" as const, truthCoverage: "full" as const, codes: ["rows-distinct", "row-association-consistent"], rowMs: 20 })),
    ...Array.from({ length: 5 }, () => ({ fixture: "x", adversarial: true, truthAssociation: "inconclusive" as const, truthStructure: "any" as const, truthCoverage: "full" as const, codes: ["rows-look-alike", "row-association-inconclusive"], rowMs: 20 })),
    { fixture: "v", adversarial: false, truthAssociation: "consistent", truthStructure: "any", truthCoverage: "partly", codes: ["rows-look-alike", "row-association-consistent", "rows-partly-examined"], rowMs: 20 },
    { fixture: "n", adversarial: false, truthAssociation: "none", truthStructure: "not-examined", truthCoverage: "none", codes: ["rows-not-examined"], rowMs: 5 }
  ];
  const allMet = (trials: RowsTrial[]) => evaluateRowsCriteria(trials, C.criteria).every((r) => r.met);
  check("a correct run meets R-1 to R-5", allMet(good));
  check("one consistent claim on an adversarial trial fails R-1", !allMet(good.map((t, i) => (i === 10 ? { ...t, codes: ["rows-look-alike", "row-association-consistent"] } : t))));
  check("a missing not-examined code fails R-4", !allMet(good.map((t) => (t.fixture === "n" ? { ...t, codes: [] } : t))));
  check("a late record fails R-5", !allMet(good.map((t, i) => (i === 0 ? { ...t, late: true } : t))));

  console.log("C. Runtime (real adapter, real Chromium)");
  const server = spawn(process.execPath, ["mock-site/server.mjs"], { env: { ...process.env, MOCK_SITE_PORT: String(PORT) }, stdio: ["ignore", "ignore", "inherit"], windowsHide: true });
  try {
    for (let attempt = 0; attempt < 80 && !(await fetch(LAB).then((r) => r.ok, () => false)); attempt += 1) await new Promise((r) => setTimeout(r, 100));
    browser = await chromium.launch();
    const offPage = await lab("table-uniform");
    const off = await diagnose(offPage);
    const onPage = await lab("table-uniform");
    const on = await diagnose(onPage, { rows: true });
    check("off (R-6): no row code and no DOM row read", off.codes.length === 0 && off.closest === 0, `${off.codes} ${off.closest}`);
    check("on: consistent and look-alike on the uniform table", on.codes.includes("row-association-consistent") && on.codes.includes("rows-look-alike"), JSON.stringify(on.codes));
    check("on: still exactly one frame, released", on.frames.taken === 1 && on.frames.released === 1 && off.frames.taken === 1, JSON.stringify(on.frames));
    const n5 = (r: VisualDiagnosisRecord | undefined) => (r ? { ...r, ms: 0, observations: r.observations.filter((c) => !c.startsWith("rows-") && !c.startsWith("row-association-")) } : null);
    check("on: the N5 part of the record is unchanged", JSON.stringify(n5(off.record)) === JSON.stringify(n5(on.record)), `${JSON.stringify(n5(off.record))} vs ${JSON.stringify(n5(on.record))}`);
    check("on: no click, key, focus or scroll reached the page", on.interactions === 0);
    check(
      "QC F6 (finding 7): the container crop is taken from the frame and dropped before the frame is released",
      JSON.stringify(on.events) === JSON.stringify(["frame-taken", "crop-taken", "crop-dropped", "frame-released"]),
      JSON.stringify(on.events)
    );
    await offPage.close();
    await onPage.close();
    for (const [fixture, expected, absent] of [
      ["displaced", "row-association-inconclusive", "row-association-consistent"],
      ["no-rows", "rows-not-examined", "row-association-consistent"],
      ["virtualized", "rows-partly-examined", "rows-not-examined"],
      ["overlapping-rows", "rows-inconclusive", "row-association-consistent"]
    ] as const) {
      const page = await lab(fixture);
      const d = await diagnose(page, { rows: true });
      check(`${fixture}: ${expected}, never ${absent}`, d.codes.includes(expected) && !d.codes.includes(absent), JSON.stringify(d.codes));
      await page.close();
    }
    const multiPage = await lab("multi-match");
    const multi = await diagnose(multiPage, { rows: true, locator: "rw-action" });
    check("several matches: each in its own row, consistent", multi.codes.includes("row-association-consistent") && multi.record?.observations.includes("target-multiple-matches"), JSON.stringify(multi.record?.observations));
    await multiPage.close();
    // QC finding 4: an invisible target placed over its row's own text (ink behind it) is never "seen in its row".
    const ghostPage = await lab("table-uniform");
    await ghostPage.evaluate(() => {
      const target = document.querySelector('[data-testid="rw-target"]') as HTMLElement;
      const nameCell = target.closest("tr")!.children[1] as HTMLElement;
      nameCell.style.position = "relative";
      target.style.cssText += ";position:absolute;left:0;top:50%;transform:translateY(-50%);opacity:0";
      nameCell.append(target);
    });
    const ghost = await diagnose(ghostPage, { rows: true });
    check("QC 4: an opacity-0 target over row text is withheld, never consistent", ghost.codes.includes("row-association-inconclusive") && !ghost.codes.includes("row-association-consistent"), JSON.stringify(ghost.codes));
    await ghostPage.close();
    // QC F4: the same placement at opacity 0.2 on the target and 0.2 on its wrapper (0.04 combined; each alone >= 0.05).
    const fadedPage = await lab("table-uniform");
    await fadedPage.evaluate(() => {
      const target = document.querySelector('[data-testid="rw-target"]') as HTMLElement;
      const nameCell = target.closest("tr")!.children[1] as HTMLElement;
      const wrap = document.createElement("span");
      wrap.style.cssText = "position:absolute;left:0;top:50%;transform:translateY(-50%);opacity:0.2";
      target.style.opacity = "0.2";
      nameCell.style.position = "relative";
      wrap.append(target);
      nameCell.append(wrap);
    });
    const faded = await diagnose(fadedPage, { rows: true });
    check("QC F4: opacity compounds up the chain (0.2 x 0.2): withheld, never consistent", faded.codes.includes("row-association-inconclusive") && !faded.codes.includes("row-association-consistent"), JSON.stringify(faded.codes));
    await fadedPage.close();
    // Security S1: a password form appears after the inspection, just before the frame. N0 refuses the frame, and the
    // refused record carries no row or state code (the row facts were already read; they must not leak into it).
    const pwPage = await lab("table-uniform");
    const pw = await diagnose(pwPage, {
      rows: true,
      state: true,
      beforeFrame: async () => {
        await pwPage.evaluate(() => document.body.insertAdjacentHTML("afterbegin", '<form style="position:fixed;top:0;left:0"><input type="password" name="pw"></form>'));
      }
    });
    check(
      "S1: a password form before the frame: refused, zero frames, no row or state code",
      pw.record?.outcome === "refused" && JSON.stringify(pw.record.observations) === '["protected-surface"]' && pw.frames.taken === 0 && pw.codes.length === 0 && pw.state.length === 0,
      JSON.stringify({ outcome: pw.record?.outcome, observations: pw.record?.observations, frames: pw.frames })
    );
    await pwPage.close();
    // QC F6 (finding 6): the deadline cuts while the first row read is in flight (the page is busy inside it). Once that
    // read returns, no further page read is started: exactly one row read reaches the page.
    const busyPage = await lab("table-uniform");
    await busyPage.evaluate(() => {
      const counted = Element.prototype.closest;
      let armed = true;
      Element.prototype.closest = function (this: Element, selector: string) {
        if (armed) {
          armed = false;
          const until = Date.now() + 2500;
          while (Date.now() < until) {
            // the page is busy inside the first row read
          }
        }
        return counted.call(this, selector);
      } as typeof Element.prototype.closest;
    });
    const busy = await diagnose(busyPage, { rows: true, deadlineMs: 1600 });
    await busyPage.evaluate(() => 0);
    await sleep(600);
    const busyReads = await busyPage.evaluate(() => (window as unknown as { __closest: number }).__closest);
    check(
      "QC F6 (finding 6): a cut during the row read: budget-exhausted, no row code, no page read after the cut",
      busy.record?.observations[0] === "budget-exhausted" && busy.codes.length === 0 && busyReads === 1,
      JSON.stringify({ observations: busy.record?.observations, reads: busyReads })
    );
    await busyPage.close();
    // QC F6 (finding 7): the deadline cuts while the frame is held (after the crop): the crop is still dropped before
    // the frame is released, and nothing is left in flight.
    const heldPage = await lab("table-uniform");
    const held = await diagnose(heldPage, { rows: true, deadlineMs: 1600, afterFrame: () => sleep(2500) });
    for (let at = 0; at < 60 && held.diagnosis.inFlight() > 0; at += 1) await sleep(100);
    check(
      "QC F6 (finding 7): a cut while the frame is held: budget-exhausted, crop dropped before the frame is released",
      held.record?.observations[0] === "budget-exhausted" &&
        held.codes.length === 0 &&
        held.diagnosis.inFlight() === 0 &&
        JSON.stringify(held.events) === JSON.stringify(["frame-taken", "crop-taken", "crop-dropped", "frame-released"]),
      JSON.stringify({ observations: held.record?.observations, events: held.events })
    );
    await heldPage.close();
    // QC finding 1: rows re-sorted after the DOM read but before the frame (the container keeps its size).
    const sortPage = await lab("table-uniform");
    const sorted = await diagnose(sortPage, {
      rows: true,
      beforeFrame: async () => {
        await sortPage.evaluate(() => {
          const row = document.querySelector('[data-testid="rw-target"]')!.closest("tr")!;
          row.parentElement!.append(row);
        });
      }
    });
    check("QC 1: rows re-sorted between the read and the frame are inconclusive, never consistent", sorted.codes.includes("rows-inconclusive") && !sorted.codes.includes("row-association-consistent"), JSON.stringify(sorted.codes));
    await sortPage.close();
    const protPage = await lab("protected");
    const prot = await diagnose(protPage, { rows: true });
    check("protected (R-7): zero frames, no row code, no DOM row read", prot.frames.taken === 0 && prot.codes.length === 0 && prot.closest === 0, JSON.stringify(prot));
    await protPage.close();
    const handedPage = await lab("table-uniform");
    const handed = await diagnose(handedPage, { rows: true, handedOff: true });
    check("handed off (R-7): zero frames, no row code, no DOM row read", handed.frames.taken === 0 && handed.codes.length === 0 && handed.closest === 0, JSON.stringify(handed));
    await handedPage.close();
  } finally {
    await browser?.close();
    server.kill();
  }

  console.log("D. Purity and wiring");
  const source = await readFile("src/visual/rows/visualRows.ts", "utf8");
  const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).sort();
  check("visualRows.ts imports only ../fingerprint and ../png", JSON.stringify(imports) === JSON.stringify(["../fingerprint", "../png"]), imports.join(","));
  check("no clock, randomness or I/O in the library", !/Date\.|performance\.|Math\.random|require\(|process\./.test(source));
  check("AWKIT_VISUAL_ROWS is on only for the exact value 'on'", visualRowsMode({ AWKIT_VISUAL_ROWS: "on" }) === "on" && ["", "ON", "1", undefined].every((v) => visualRowsMode({ AWKIT_VISUAL_ROWS: v }) === "off"));
  const engine = await readFile("src/runner/ExecutionEngine.ts", "utf8");
  check("the engine enables rows only together with the N5 diagnosis", /visualRowEvidence: visualDiagnosisMode\(\) === "on" && visualRowsMode\(\) === "on"/.test(engine));
  const runner = await readFile("src/runner/PlaywrightRunner.ts", "utf8");
  check("the runner passes rowEvidence only when enabled, with no extra deadline", /this\.options\.visualRowEvidence === true \? \{ rowEvidence: true \} : \{\}/.test(runner));
  const adapter = await readFile("src/runner/visualDiagnosis/VisualFailureDiagnosis.ts", "utf8");
  check("the adapter reads rows only under rowEvidence === true and a failed read is caught", /this\.options\.rowEvidence === true/.test(adapter) && /this\.rowFacts\(mainMembers, signal\)\.catch\(\(\) => null\)/.test(adapter));
  check("S4: the row facts' hit test fails closed (an unreadable hit test is covered)", /members\.map\(\(\{ handle \}\) => this\.occluded\(handle, true\)\)/.test(adapter) && /\.catch\(\(\) => failClosed\)/.test(adapter));
  check("S1: no advisory code is added to a refused verdict", /const advisory = verdict\.outcome !== "refused"/.test(adapter) && (adapter.match(/if \(advisory && /g) ?? []).length === 3);
  const copy = await readFile("app/renderer/components/reports/VisualDiagnosisSection.tsx", "utf8");
  check("the drawer has fixed copy for every row code", VISUAL_ROWS_CODES.every((code) => copy.includes(`"${code}":`)));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

await main();
