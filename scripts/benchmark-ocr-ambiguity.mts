/**
 * benchmark:ocr-ambiguity — Phase N, N7.6 (awkit-vra.9.7). DIAGNOSTIC ONLY: a feasibility probe of OCR character
 * ambiguity (l / 1 / I) with the pinned engine. It never counts toward OC-10, never writes a calibration session,
 * changes no verdict, threshold, deadline, engine, data, N0 or host policy, and nothing in the product imports it.
 *
 *  1. Reads the first qualifying session (2026-10-27T17-21-44-341Z-e52a5a5f) READ-ONLY and recounts the established
 *     defect from its codes; the file's SHA-256 must be identical before and after.
 *  2. Stages the pinned engine and data with the production prepare-ocr-assets.mjs and forks the diagnostic probe host
 *     (scripts/ocr-ambiguity/probe-host.cjs), which records the exposed bindings.
 *  3. In each of the six calibration cells (headed and headless x DPR 1, 1.25, 2), with a fresh Playwright Chromium per
 *     launch, renders each fixture on the OCR Lab stage in the bundled font, captures it with the production N0
 *     captureElement (stillness, no padding, as OcrStep does), preprocesses it with the production preprocessForOcr, and
 *     recognizes the same plane in rotated order as: A = production (mode 0, word walk), B = mode 0 symbol walk with
 *     ChoiceIterator, C = lstm_choice_mode 2 symbol walk; multiline items also get D = PSM 4.
 *  4. Reduces every trial to numbers and codes at once (the recognized text never leaves memory), then evaluates the
 *     candidate rules: a floor is chosen on the DEVELOPMENT set (calibration fixtures) only and judged on the
 *     pre-declared CONFIRMATION set (scripts/ocr-ambiguity/probe-fixtures.json).
 *  5. Writes the aggregate report to %LOCALAPPDATA%/SpecterStudio/ocr-calibration/ambiguity (never the sessions
 *     folder), after assertAggregateOnly proves it holds no text.
 *
 * Exit: 0 report written; 2 BLOCKED (font, assets or fonts not ready); 1 error.
 */
import { createHash, randomBytes } from "node:crypto";
import { fork, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";

import { captureElement } from "@src/visual/capture";
import { preprocessForOcr } from "@src/visual/ocr/preprocess";
import { decideTextAssertion, TEXT_ASSERTION_CODES, TEXT_ASSERTION_INPUT_VERSION, type TextAssertionMatchMode } from "@src/visual/ocr/decideTextAssertion";
import { buildChromiumHardeningArgs } from "@src/runner/ChromiumHardening";
import { OCR_CALIBRATION_CELLS, cellIdOf, latencySummary } from "./lib/ocr-calibration-criteria.mts";
import {
  assertAggregateOnly,
  demotedBy,
  labelClassSymbols,
  quantiles,
  separability,
  trialFeatures,
  type ProbeWord,
  type TrialFeatures
} from "./lib/ocr-ambiguity-analysis.mts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
const SESSIONS_DIR = path.join(process.env.LOCALAPPDATA ?? os.homedir(), "SpecterStudio", "ocr-calibration", "sessions");
const OUT_DIR = path.join(process.env.LOCALAPPDATA ?? os.homedir(), "SpecterStudio", "ocr-calibration", "ambiguity");
const QUALIFYING_SESSION = "2026-10-27T17-21-44-341Z-e52a5a5f";
const REPS = 3;
const TIME_BUDGET_MS = 8 * 60 * 1000;
const VIEWPORT = { width: 800, height: 600 };

type Role = "negative" | "positive";
type ProbeSet = "development" | "confirmation" | "multiline-control";
interface Item {
  set: ProbeSet;
  id: string;
  role: Role;
  text: string;
  expected: string;
  match: TextAssertionMatchMode;
  fontSize: number;
  fromTable: boolean;
  multiline: boolean;
}
type Pass = "A" | "B" | "C" | "D";
const PASSES: Record<Pass, { psm: number; choiceMode: number; walk: "words" | "symbols" }> = {
  A: { psm: 6, choiceMode: 0, walk: "words" },
  B: { psm: 6, choiceMode: 0, walk: "symbols" },
  C: { psm: 6, choiceMode: 2, walk: "symbols" },
  D: { psm: 4, choiceMode: 0, walk: "symbols" }
};
interface ProbeReply {
  ok: boolean;
  reason?: string;
  words?: ProbeWord[];
  modeAccepted?: boolean;
  recognizeMs?: number;
  extractMs?: number;
  rss: number;
  wasmBytes: number | null;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const table = JSON.parse(readFileSync(path.join(root, "mock-site", "public", "ocr-fixtures.json"), "utf8")) as {
  fixtures: Array<{ id: string; class: string; text: string; expected: string; match: TextAssertionMatchMode; style?: { fontSize?: number } }>;
};
const probeFixtures = JSON.parse(readFileSync(path.join(root, "scripts", "ocr-ambiguity", "probe-fixtures.json"), "utf8")) as {
  confirmation: Array<{ id: string; role: Role; text: string; expected: string; fontSize: number }>;
  multilineControls: Array<{ id: string; role: Role; text: string; expected: string; fontSize: number }>;
};
const DEVELOPMENT_IDS = table.fixtures
  .filter((f) => f.id === "lookalike-l1" || f.id === "lookalike-I1" || f.id === "multiline" || (f.class === "supported" && /[lI1]/.test(f.text)))
  .map((f) => f.id);
const items: Item[] = [
  ...table.fixtures
    .filter((f) => DEVELOPMENT_IDS.includes(f.id))
    .map((f): Item => ({ set: "development", id: f.id, role: f.class === "confusable" ? "negative" : "positive", text: f.text, expected: f.expected, match: f.match, fontSize: f.style?.fontSize ?? 22, fromTable: true, multiline: f.id === "multiline" })),
  ...probeFixtures.confirmation.map((f): Item => ({ set: "confirmation", ...f, match: "normalized", fromTable: false, multiline: false })),
  ...probeFixtures.multilineControls.map((f): Item => ({ set: "multiline-control", ...f, match: "normalized", fromTable: false, multiline: true }))
];
const fixtureTexts = items.flatMap((i) => [i.text, i.expected]);

// ── Gates ────────────────────────────────────────────────────────────────────────────────────────────────────────────

function fontsVerified(): boolean {
  const dir = path.join(root, "mock-site", "public", "fonts");
  const manifestPath = path.join(dir, "fonts-manifest.json");
  if (!existsSync(manifestPath)) return false;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { files: Array<{ file: string; sha256: string }> };
  return manifest.files.length > 0 && manifest.files.every((f) => existsSync(path.join(dir, f.file)) && sha256(readFileSync(path.join(dir, f.file))) === f.sha256);
}

/** Step 1: the qualifying session, recounted from its codes, read-only. */
function reproduceSession(): Record<string, unknown> {
  const file = path.join(SESSIONS_DIR, `${QUALIFYING_SESSION}.json`);
  if (!existsSync(file)) return { available: false };
  const before = sha256(readFileSync(file));
  const session = JSON.parse(readFileSync(file, "utf8")) as {
    launches: Array<{ cell: { renderMode: string; devicePixelRatio: number }; complete: boolean; coldProbe: boolean; diagnostic: boolean; trials: Array<{ fixtureId: string; code: string; coldHost: boolean; verdict: string }> }>;
  };
  const counted = session.launches.filter((l) => !l.coldProbe);
  const byFixture = (id: string) => {
    const perCell: Record<string, Record<string, number>> = {};
    for (const launch of counted) {
      for (const trial of launch.trials.filter((t) => t.fixtureId === id)) {
        const cell = cellIdOf(launch.cell as never);
        perCell[cell] ??= {};
        perCell[cell][trial.code] = (perCell[cell][trial.code] ?? 0) + 1;
      }
    }
    return perCell;
  };
  const coldTrials = session.launches.flatMap((l) => l.trials.filter((t) => t.coldHost));
  const after = sha256(readFileSync(file));
  return {
    available: true,
    unchanged: before === after,
    launches: session.launches.length,
    complete: session.launches.filter((l) => l.complete).length,
    coldProbeLaunches: session.launches.filter((l) => l.coldProbe).length,
    lookalikeL1: byFixture("lookalike-l1"),
    multiline: byFixture("multiline"),
    coldHostTrials: coldTrials.length,
    coldHostBudgetExhausted: coldTrials.filter((t) => t.code === "budget-exhausted").length
  };
}

// ── Probe host client ────────────────────────────────────────────────────────────────────────────────────────────────

class ProbeHost {
  private readonly child: ChildProcess;
  private readonly pending = new Map<string, (reply: ProbeReply) => void>();
  readonly ready: Promise<Record<string, unknown>>;

  constructor(assets: string, expected: Record<string, string>) {
    this.child = fork(path.join(root, "scripts", "ocr-ambiguity", "probe-host.cjs"), [], {
      env: { SystemRoot: process.env.SystemRoot ?? "", AWKIT_OCR_PROBE_ASSET_DIR: assets, AWKIT_OCR_PROBE_EXPECTED: JSON.stringify(expected) },
      execArgv: [],
      serialization: "advanced",
      stdio: ["ignore", "ignore", "ignore", "ipc"]
    });
    this.ready = new Promise((resolve, reject) => {
      this.child.on("message", (message: { type: string; id?: string } & Record<string, unknown>) => {
        if (message.type === "ready") resolve(message);
        else if (message.type === "failed") reject(new Error(`probe host failed: ${String(message.reason)}`));
        else if (message.type === "result" && message.id) {
          this.pending.get(message.id)?.(message as unknown as ProbeReply);
          this.pending.delete(message.id);
        }
      });
      this.child.on("exit", () => reject(new Error("probe host exited")));
    });
  }

  recognize(image: { width: number; height: number; gray: Uint8Array }, pass: Pass): Promise<ProbeReply> {
    const id = randomBytes(6).toString("hex");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("probe recognize timed out")), 30_000);
      this.pending.set(id, (reply) => {
        clearTimeout(timer);
        resolve(reply);
      });
      this.child.send({ type: "recognize", id, width: image.width, height: image.height, gray: image.gray, ...PASSES[pass] });
    });
  }

  shutdown(): void {
    if (this.child.connected) this.child.send({ type: "shutdown", id: "shutdown" });
    setTimeout(() => this.child.kill(), 2000).unref();
  }
}

// ── One trial, reduced at once ───────────────────────────────────────────────────────────────────────────────────────

const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();
const joined = (words: readonly ProbeWord[] | undefined): string => collapse((words ?? []).map((w) => w.text).join(" "));
const decide = (item: Item, words: readonly ProbeWord[] | undefined): string =>
  decideTextAssertion({
    version: TEXT_ASSERTION_INPUT_VERSION,
    expected: { text: item.expected, match: item.match },
    ocr: words ? { ok: true, words: words.map((w) => ({ text: w.text, confidence: w.confidence })) } : { ok: false, code: "ocr-unavailable" }
  }).code;
/** Production's look-alike gate for one word, asked of the production decision itself (85 sits between 80 and 92). */
const needsLookalikeConfidence = (word: string): boolean =>
  decideTextAssertion({ version: TEXT_ASSERTION_INPUT_VERSION, expected: { text: word, match: "normalized" }, ocr: { ok: true, words: [{ text: word, confidence: 85 }] } }).code === "lookalike-uncertain";

interface TrialRecord {
  set: ProbeSet;
  fixtureId: string;
  role: Role;
  cell: string;
  rep: number;
  refusal: string | null;
  code: string | null;
  codeC: string | null;
  correctReading: boolean | null;
  sameTextAB: boolean | null;
  sameTextAC: boolean | null;
  sameWordConfidenceAC: boolean | null;
  modeAccepted: boolean | null;
  featuresB: TrialFeatures | null;
  featuresC: TrialFeatures | null;
  symbolsC: Array<{ label: string; symbolConfidence: number; top: number; classMargin: number; anyMargin: number }> | null;
  unalignedC: boolean;
  timing: Record<string, number>;
  memory: Record<string, number | null>;
  multiline: Record<string, unknown> | null;
}

function multilineFacts(item: Item, words: readonly ProbeWord[] | undefined): Record<string, unknown> {
  const list = words ?? [];
  const expectedWords = collapse(item.expected).split(" ");
  return {
    wordsRead: list.length,
    expectedWords: expectedWords.length,
    linesRead: new Set(list.map((w) => w.line ?? 0)).size,
    readEqualsExpected: joined(list).toLowerCase() === collapse(item.expected).toLowerCase(),
    perWord: list.slice(0, 12).map((w, index) => ({ index, line: w.line ?? 0, confidence: Math.round(w.confidence * 100) / 100, needsLookalike: needsLookalikeConfidence(w.text) }))
  };
}

async function runTrial(page: Page, host: ProbeHost, item: Item, cell: string, rep: number, order: number): Promise<TrialRecord> {
  const record: TrialRecord = {
    set: item.set, fixtureId: item.id, role: item.role, cell, rep, refusal: null, code: null, codeC: null, correctReading: null,
    sameTextAB: null, sameTextAC: null, sameWordConfidenceAC: null, modeAccepted: null, featuresB: null, featuresC: null,
    symbolsC: null, unalignedC: false, timing: {}, memory: {}, multiline: null
  };
  if (item.fromTable) {
    await page.evaluate((id) => (window as unknown as { __ocrCalibration: { show(id: string): Promise<string> } }).__ocrCalibration.show(id), item.id);
  } else {
    // The lab stage and its styling, with this probe's text; the same two-frame settle as show().
    await page.evaluate(
      ({ id, text, fontSize }) =>
        new Promise<void>((resolve) => {
          const stage = document.getElementById("ocf-stage") as HTMLElement;
          stage.setAttribute("data-shown", "");
          document.getElementById("ocf-protected")?.remove();
          stage.textContent = text;
          Object.assign(stage.style, { fontSize: `${fontSize}px`, color: "#000000", background: "#ffffff", transform: "none", writingMode: "horizontal-tb" });
          requestAnimationFrame(() => requestAnimationFrame(() => {
            stage.setAttribute("data-shown", id);
            resolve();
          }));
        }),
      { id: item.id, text: item.text, fontSize: item.fontSize }
    );
  }
  await page.waitForSelector(`#ocf-stage[data-shown="${item.id}"]`);
  const fontSizeCssPx = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.getElementById("ocf-stage") as HTMLElement).fontSize));
  const shot = await captureElement(page, page.getByTestId("ocf-stage"), { timeoutMs: 5000, contextPaddingCss: 0, stillness: true });
  if (!shot.ok) {
    record.refusal = `capture-${String(shot.code).toLowerCase()}`;
    return record;
  }
  const prepared = preprocessForOcr({ image: shot.value.element.image, fontSizeCssPx, devicePixelRatio: shot.value.viewport.devicePixelRatio, clipped: shot.value.element.wasClipped });
  if (!prepared.ok) {
    record.refusal = prepared.code;
    return record;
  }
  const passes: Pass[] = item.multiline ? ["A", "B", "C", "D"] : ["A", "B", "C"];
  const rotated = passes.map((_, i) => passes[(i + order) % passes.length]);
  const replies = {} as Record<Pass, ProbeReply>;
  for (const pass of rotated) replies[pass] = await host.recognize(prepared, pass);
  const { A, B, C, D } = replies;
  for (const [pass, reply] of Object.entries(replies)) {
    if (!reply.ok) {
      record.refusal = `probe-${reply.reason ?? "failed"}`;
      return record;
    }
    record.timing[`recognize${pass}`] = reply.recognizeMs ?? 0;
    record.timing[`extract${pass}`] = reply.extractMs ?? 0;
    record.memory[`rss${pass}`] = reply.rss;
    record.memory[`wasm${pass}`] = reply.wasmBytes;
  }
  record.code = decide(item, A.words);
  record.codeC = decide(item, C.words);
  record.correctReading = joined(A.words) === collapse(item.text);
  record.sameTextAB = joined(A.words) === joined(B.words);
  record.sameTextAC = joined(A.words) === joined(C.words);
  record.sameWordConfidenceAC = (A.words ?? []).length === (C.words ?? []).length && (A.words ?? []).every((w, i) => Math.abs(w.confidence - (C.words ?? [])[i].confidence) < 1e-6);
  record.modeAccepted = C.modeAccepted ?? null;
  record.featuresB = trialFeatures(B.words ?? []);
  record.featuresC = trialFeatures(C.words ?? []);
  const labels = labelClassSymbols(C.words ?? [], item.text);
  record.unalignedC = labels === null;
  record.symbolsC = labels?.map((l) => ({ label: l.label, symbolConfidence: l.margins.symbolConfidence, top: l.margins.top, classMargin: l.margins.classMargin, anyMargin: l.margins.anyMargin })) ?? null;
  if (item.multiline) {
    record.multiline = { ...multilineFacts(item, B.words), psm4: { ...multilineFacts(item, D?.words), code: decide(item, D?.words) } };
  }
  return record;
}

// ── Aggregation ──────────────────────────────────────────────────────────────────────────────────────────────────────

const METRICS = ["minSymbolConfidence", "minClassMargin", "minAnyMargin", "minClassWordConfidence"] as const;

function aggregate(trials: TrialRecord[]): Record<string, unknown> {
  const measured = trials.filter((t) => t.code !== null);
  const isFalse = (t: TrialRecord) => t.role === "negative" && t.code === "text-matched";
  const isLegit = (t: TrialRecord) => t.role === "positive" && t.code === "text-matched";
  const values = (list: TrialRecord[], metric: (typeof METRICS)[number]) => list.map((t) => t.featuresC?.[metric]).filter((v): v is number => typeof v === "number");
  const outcomes = (list: TrialRecord[]) => {
    const out: Record<string, Record<string, number>> = {};
    for (const t of list) {
      const key = t.code ?? t.refusal ?? "unmeasured";
      out[t.fixtureId] ??= {};
      out[t.fixtureId][key] = (out[t.fixtureId][key] ?? 0) + 1;
    }
    return out;
  };
  const perCell = (list: TrialRecord[]) => {
    const out: Record<string, { falseMatched: number; negatives: number; legitMatched: number; positives: number }> = {};
    for (const t of list) {
      out[t.cell] ??= { falseMatched: 0, negatives: 0, legitMatched: 0, positives: 0 };
      if (t.role === "negative") {
        out[t.cell].negatives += 1;
        if (isFalse(t)) out[t.cell].falseMatched += 1;
      } else {
        out[t.cell].positives += 1;
        if (isLegit(t)) out[t.cell].legitMatched += 1;
      }
    }
    return out;
  };
  const bySet = (set: ProbeSet) => measured.filter((t) => t.set === set);
  const development = bySet("development");
  const confirmation = bySet("confirmation");
  const distributions = (list: TrialRecord[]) => {
    const falseTrials = list.filter(isFalse);
    const legitTrials = list.filter((t) => isLegit(t) && (t.featuresC?.classSymbols ?? 0) > 0);
    const symbols = list.flatMap((t) => t.symbolsC ?? []);
    const symbolDistribution = (label: string) => {
      const chosen = symbols.filter((s) => s.label === label);
      return { symbolConfidence: quantiles(chosen.map((s) => s.symbolConfidence)), top: quantiles(chosen.map((s) => s.top)), classMargin: quantiles(chosen.map((s) => s.classMargin)), anyMargin: quantiles(chosen.map((s) => s.anyMargin)) };
    };
    return {
      falseMatchTrials: falseTrials.length,
      legitMatchTrialsWithClassSymbols: legitTrials.length,
      falseMatch: Object.fromEntries(METRICS.map((m) => [m, quantiles(values(falseTrials, m))])),
      legitMatch: Object.fromEntries(METRICS.map((m) => [m, quantiles(values(legitTrials, m))])),
      classSymbols: { correct: symbolDistribution("correct"), incorrect: symbolDistribution("incorrect") },
      unalignedTrials: list.filter((t) => t.unalignedC).length
    };
  };
  // Candidate rules: chosen on development only, judged on confirmation.
  const rules = Object.fromEntries(
    METRICS.map((metric) => {
      const dev = separability(values(development.filter(isFalse), metric), values(development.filter((t) => isLegit(t) && (t.featuresC?.classSymbols ?? 0) > 0), metric));
      const confFalse = values(confirmation.filter(isFalse), metric);
      const confLegit = values(confirmation.filter((t) => isLegit(t) && (t.featuresC?.classSymbols ?? 0) > 0), metric);
      const positives = measured.filter((t) => t.role === "positive" && t.set !== "multiline-control");
      const positivesMatched = positives.filter(isLegit);
      const lost = dev.floor === null ? null : positivesMatched.filter((t) => typeof t.featuresC?.[metric] === "number" && (t.featuresC[metric] as number) < (dev.floor as number)).length;
      return [
        metric,
        {
          development: dev,
          confirmation: {
            separabilityIfRechosen: separability(confFalse, confLegit),
            falseMatches: confFalse.length,
            falseEliminatedByDevelopmentFloor: dev.floor === null ? null : demotedBy(confFalse, dev.floor),
            legitMatchesWithClassSymbols: confLegit.length,
            legitLostToDevelopmentFloor: dev.floor === null ? null : demotedBy(confLegit, dev.floor)
          },
          supportedImpact: {
            positiveTrials: positives.length,
            matchedBefore: positivesMatched.length,
            matchedAfter: lost === null ? null : positivesMatched.length - lost,
            matchRateBefore: positives.length ? Math.round((positivesMatched.length / positives.length) * 10000) / 10000 : null,
            matchRateAfter: lost === null || !positives.length ? null : Math.round(((positivesMatched.length - lost) / positives.length) * 10000) / 10000
          }
        }
      ];
    })
  );
  const ms = (pass: Pass, kind: "recognize" | "extract") => latencySummary(measured.map((t) => t.timing[`${kind}${pass}`]).filter((v): v is number => typeof v === "number"));
  const mem = (pass: Pass, kind: "rss" | "wasm") => quantiles(measured.map((t) => t.memory[`${kind}${pass}`]).filter((v): v is number => typeof v === "number").map((v) => Math.round(v / 1048576)));
  const multiline = measured.filter((t) => t.multiline);
  const multilineByFixture = Object.fromEntries(
    [...new Set(multiline.map((t) => t.fixtureId))].map((id) => {
      const list = multiline.filter((t) => t.fixtureId === id);
      const facts = list.map((t) => t.multiline as { wordsRead: number; expectedWords: number; linesRead: number; readEqualsExpected: boolean; perWord: Array<{ index: number; line: number; confidence: number; needsLookalike: boolean }>; psm4: { code: string; readEqualsExpected: boolean; wordsRead: number; linesRead: number } });
      const indices = [...new Set(facts.flatMap((f) => f.perWord.map((w) => w.index)))].sort((a, b) => a - b);
      return [
        id,
        {
          trials: list.length,
          codes: outcomes(list)[id],
          readEqualsExpected: facts.filter((f) => f.readEqualsExpected).length,
          wordCountMatches: facts.filter((f) => f.wordsRead === f.expectedWords).length,
          linesRead: quantiles(facts.map((f) => f.linesRead)),
          perWordIndex: Object.fromEntries(
            indices.map((index) => {
              const words = facts.flatMap((f) => f.perWord.filter((w) => w.index === index));
              return [`w${index}`, { line: quantiles(words.map((w) => w.line)), confidence: quantiles(words.map((w) => w.confidence)), needsLookalike: words.filter((w) => w.needsLookalike).length, below92: words.filter((w) => w.confidence < 92).length, below80: words.filter((w) => w.confidence < 80).length }];
            })
          ),
          psm4: {
            codes: facts.reduce<Record<string, number>>((acc, f) => ({ ...acc, [f.psm4.code]: (acc[f.psm4.code] ?? 0) + 1 }), {}),
            readEqualsExpected: facts.filter((f) => f.psm4.readEqualsExpected).length,
            wordCountMatches: facts.filter((f) => f.psm4.wordsRead === f.expectedWords).length
          }
        }
      ];
    })
  );
  return {
    trials: { total: trials.length, measured: measured.length, refused: trials.filter((t) => t.refusal !== null).length, refusals: trials.filter((t) => t.refusal).reduce<Record<string, number>>((acc, t) => ({ ...acc, [t.refusal as string]: (acc[t.refusal as string] ?? 0) + 1 }), {}) },
    modeTwo: {
      accepted: measured.filter((t) => t.modeAccepted === true).length,
      sameTextAsProduction: measured.filter((t) => t.sameTextAC).length,
      sameWordConfidenceAsProduction: measured.filter((t) => t.sameWordConfidenceAC).length,
      verdictChanged: measured.filter((t) => t.code !== t.codeC).length,
      symbolWalkSameTextAsProduction: measured.filter((t) => t.sameTextAB).length,
      maxChoicesModeZero: quantiles(measured.map((t) => t.featuresB?.maxChoiceCount ?? 0)),
      maxChoicesModeTwo: quantiles(measured.map((t) => t.featuresC?.maxChoiceCount ?? 0)),
      classSymbolsModeTwo: measured.reduce((n, t) => n + (t.featuresC?.classSymbols ?? 0), 0),
      classMatesOfferedModeTwo: measured.reduce((n, t) => n + (t.featuresC?.classMatesOffered ?? 0), 0),
      classMatesOfferedModeZero: measured.reduce((n, t) => n + (t.featuresB?.classMatesOffered ?? 0), 0)
    },
    outcomes: { development: outcomes(development), confirmation: outcomes(confirmation), multilineControl: outcomes(bySet("multiline-control")) },
    perCell: { development: perCell(development), confirmation: perCell(confirmation) },
    distributions: { development: distributions(development), confirmation: distributions(confirmation) },
    rules,
    latencyMs: {
      productionRecognize: ms("A", "recognize"),
      modeTwoRecognize: ms("C", "recognize"),
      productionWordWalk: ms("A", "extract"),
      modeZeroSymbolWalk: ms("B", "extract"),
      modeTwoSymbolWalk: ms("C", "extract")
    },
    memoryMiB: { rssProduction: mem("A", "rss"), rssModeTwo: mem("C", "rss"), wasmProduction: mem("A", "wasm"), wasmModeTwo: mem("C", "wasm") },
    multiline: multilineByFixture
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const startedAt = performance.now();
if (!fontsVerified()) {
  console.error("BLOCKED: the bundled OCR Lab font is missing or altered (mock-site/public/fonts). Nothing measured.");
  process.exit(2);
}
const pin = JSON.parse(readFileSync(path.join(root, "src", "offline", "ocr-runtime.json"), "utf8")) as { files: Array<{ target: string; sha256: string }> };
const expected = Object.fromEntries(pin.files.map((f) => [f.target, f.sha256]));
const work = mkdtempSync(path.join(os.tmpdir(), "awkit-ocr-ambiguity-"));
const assets = path.join(work, "assets");
let server: ReturnType<typeof spawn> | undefined;
let host: ProbeHost | undefined;
let exitCode = 1;
try {
  const session = reproduceSession();
  console.log(`Qualifying session ${QUALIFYING_SESSION} (read-only): ${JSON.stringify(session)}`);
  const staged = spawnSync(process.execPath, [path.join(root, "scripts", "prepare-ocr-assets.mjs"), "--out", assets], { cwd: root, encoding: "utf8", timeout: 120_000 });
  if (staged.status !== 0) {
    console.error(`BLOCKED: asset staging failed: ${String(staged.stderr).trim().slice(0, 300)}`);
    exitCode = 2;
    throw new Error("blocked");
  }
  host = new ProbeHost(assets, expected);
  const ready = await host.ready;
  console.log(`Probe host ready: init ${Math.round(Number(ready.initMs))} ms, API ${JSON.stringify(ready.api)}`);

  const port = await new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => (address && typeof address === "object" ? resolve(address.port) : reject(new Error("no free port"))));
    });
  });
  const lab = `http://127.0.0.1:${port}/visual-intelligence/ocr`;
  server = spawn(process.execPath, ["mock-site/server.mjs"], { cwd: root, env: { ...process.env, MOCK_SITE_PORT: String(port) }, stdio: ["ignore", "ignore", "inherit"], windowsHide: true });
  for (let attempt = 0; attempt < 100 && !(await fetch(lab).then((r) => r.ok, () => false)); attempt += 1) await new Promise((r) => setTimeout(r, 100));

  const trials: TrialRecord[] = [];
  let launches = 0;
  let launchErrors = 0;
  outer: for (let rep = 0; rep < REPS; rep += 1) {
    for (const cell of OCR_CALIBRATION_CELLS) {
      if (performance.now() - startedAt > TIME_BUDGET_MS) break outer;
      let browser: Browser | undefined;
      try {
        browser = await chromium.launch({ headless: cell.renderMode === "headless", args: buildChromiumHardeningArgs(process.env) });
        const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: cell.devicePixelRatio });
        const page = await context.newPage();
        await page.goto(`${lab}?calibration=1`);
        await page.waitForSelector("body[data-fonts][data-fixtures]");
        if ((await page.getAttribute("body", "data-fonts")) !== "ready") {
          console.error("BLOCKED: the bundled font did not load in the lab.");
          exitCode = 2;
          throw new Error("blocked");
        }
        for (const [index, item] of items.entries()) trials.push(await runTrial(page, host, item, cellIdOf(cell), rep, index + rep));
        launches += 1;
      } catch (error) {
        if (exitCode === 2) throw error;
        launchErrors += 1;
        console.error(`launch error (${cellIdOf(cell)}): ${(error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 160)}`);
      } finally {
        await browser?.close().catch(() => undefined);
      }
    }
  }

  const aggregated = aggregate(trials);
  const report = {
    version: 1,
    kind: "ocr-ambiguity-diagnostic",
    diagnostic: true,
    qualifying: false,
    generated: new Date().toISOString().slice(0, 10),
    durationSec: Math.round((performance.now() - startedAt) / 1000),
    environment: {
      platform: process.platform,
      hostArch: process.env.PROCESSOR_ARCHITEW6432 ?? process.env.PROCESSOR_ARCHITECTURE ?? os.arch(),
      processArch: process.arch,
      engineAssets: pin.files.map((f) => f.sha256.slice(0, 16)),
      probeFixtures: sha256(readFileSync(path.join(root, "scripts", "ocr-ambiguity", "probe-fixtures.json"))).slice(0, 16),
      calibrationFixtures: sha256(readFileSync(path.join(root, "mock-site", "public", "ocr-fixtures.json"))).slice(0, 16)
    },
    session,
    api: ready.api,
    probeInit: { initMs: Math.round(Number(ready.initMs)), rssBeforeEngineMiB: Math.round(Number(ready.rssBeforeEngine) / 1048576), rssAfterEngineMiB: Math.round(Number(ready.rss) / 1048576) },
    launches: { completed: launches, errors: launchErrors, repetitions: REPS },
    sets: { development: DEVELOPMENT_IDS, confirmation: probeFixtures.confirmation.map((f) => f.id), multilineControl: probeFixtures.multilineControls.map((f) => f.id) },
    ...aggregated
  };
  const vocabulary = new Set<string>([
    ...items.map((i) => i.id),
    ...OCR_CALIBRATION_CELLS.map((c) => cellIdOf(c)),
    ...Object.keys(TEXT_ASSERTION_CODES),
    ...trials.map((t) => t.refusal).filter((r): r is string => typeof r === "string"),
    "ocr-ambiguity-diagnostic", "unmeasured", "separable", "overlapping", "insufficient", "win32", "x64", "arm64", "ARM64", "AMD64",
    process.platform, process.arch, report.environment.hostArch, report.generated, report.environment.probeFixtures, report.environment.calibrationFixtures,
    ...report.environment.engineAssets
  ]);
  assertAggregateOnly(report, vocabulary, fixtureTexts);
  mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(4).toString("hex")}.json`);
  writeFileSync(outFile, `${JSON.stringify(report, null, 1)}\n`);
  console.log(`\nAggregate report (numbers and fixture ids only): ${outFile}`);
  console.log(JSON.stringify({ launches: report.launches, trials: aggregated.trials, modeTwo: aggregated.modeTwo, perCell: aggregated.perCell, rules: aggregated.rules }, null, 1));
  exitCode = 0;
} catch (error) {
  if (exitCode !== 2) console.error(`ERROR: ${(error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 200)}`);
} finally {
  host?.shutdown();
  server?.kill();
  rmSync(work, { recursive: true, force: true });
}
process.exit(exitCode);
