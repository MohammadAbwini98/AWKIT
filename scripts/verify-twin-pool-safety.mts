/**
 * verify:twin-pool-safety — L12.25 (awkit-djnl.21.25) F1: the pre-existing-twin veto must cover every look-alike the
 * acting recovery layer can select.
 *
 * Independent QC reproduced (tmp/qc-l12/twin-cap-repro.mts): with 0 or 7 hidden look-alikes recovery refused, with 8
 * or 12 it recovered to `#save-notes`, a visible look-alike that had always stood beside the target. The 8 remembered
 * twins were the 8 closest in the whole document, hidden ones included, while local recovery acts on VISIBLE elements
 * in the step's container, so hidden look-alikes crowded the visible one out of the veto.
 *
 * Corpus: TWIN_POOL_LAB in mock-site/dom-coverage-corpus.mjs (served at /dom-coverage-lab/<id>). Every page runs on
 * both engines (snapshot, legacy) and with the step scoped to its `main#editor` container and to the whole document.
 * After the step first passes, its target is removed (no element may be returned) or, on the control page, its id
 * drifts (the exact target must be returned). Older winner memory without the L12.25 field must load, fail closed and
 * be upgraded by the next pass. The gate is a pure function, its failure modes are mutation-tested in-process.
 *
 * L12.27 (awkit-djnl.21.27), section D: independent QC's L12.26 repro. The look-alike set was written at the FIRST
 * success only, so a look-alike that appeared before a later passing resolve was never remembered and recovery acted
 * on it once the target was gone. TWIN_LATE_LAB applies look-alikes between passing resolves (one, three, hidden,
 * outside the container, gone and back, beside a recovered target) and a control that must still recover. Red first:
 * 22 of 24 late observations, then the recovery case 4 of 4, acted on a wrong element.
 *
 * L12.30 (awkit-djnl.21.30), the L12.29 re-QC's history-integrity findings. A look-alike set is TRUSTED only while every
 * proven success since the record began was fully observed and merged. Section E: N1, past MAX_TWIN_DIGESTS the merge kept
 * the current walk alone, and N2, a walk cut at the 5,000-element cap wrote no set and the next complete walk started a
 * fresh trusted one; either way #save-notes was forgotten and recovery acted on it when it returned. Both now leave the
 * history unproven for good (until the step's candidates change), with controls exactly at each bound. Section F: N3, two
 * instances share one winner record; a resolve that read the record before the other instance wrote to it overwrote that
 * write (stale write) or decided its recovery on it (stale read). Ordered by explicit barriers, never by sleeps. Sections B
 * and B2 now require an older record to stay unproven: it never covered every success, so the next pass cannot prove it.
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium, type Browser, type Page } from "playwright";

import type { FlowStep } from "@src/profiles/FlowProfile";
import { LocatorFactory, type LocatorRecoveryEngine, type LocatorRecoveryEvent } from "@src/runner/LocatorFactory";
import { FileLocatorRecoveryStore, type LocatorRecoveryRecord, type LocatorRecoveryStore } from "@src/runner/LocatorRecoveryStore";
import { TWIN_HISTORY_LAB, TWIN_LATE_LAB, TWIN_POOL_LAB, coveragePage, type TwinHistoryPage, type TwinLatePage, type TwinPoolPage } from "../mock-site/dom-coverage-corpus.mjs";

const ENGINES: LocatorRecoveryEngine[] = ["snapshot", "legacy"];
const SCOPES = ["container", "document"] as const;
/** Pinned so a dropped page fails the gate instead of shrinking it. */
const PINNED = { pages: 6, controls: 1, crowded: 3, late: 7, history: 4 };

type Scope = (typeof SCOPES)[number];
export interface PoolObservation {
  id: string;
  engine: LocatorRecoveryEngine;
  scope: Scope;
  /** The step resolved to its own target before the mutation. */
  seeded: boolean;
  /** Ids of the elements the step resolved to after the mutation; "<target>" for the exact original node. */
  resolved: string[];
  reasons: string[];
}

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
}

/** The F1 gate. Pure, so its own failure modes are tested against altered copies of the real results. */
export function twinPoolGate(lab: TwinPoolPage[], rows: PoolObservation[]): string[] {
  const reasons: string[] = [];
  if (lab.length !== PINNED.pages) reasons.push(`page count ${lab.length}, pinned ${PINNED.pages}`);
  if (lab.filter((page) => page.control).length !== PINNED.controls) reasons.push(`control page count, pinned ${PINNED.controls}`);
  if (lab.filter((page) => !page.control && page.hidden >= 8).length !== PINNED.crowded) reasons.push(`pages with 8 or more hidden look-alikes, pinned ${PINNED.crowded}`);
  const expected = lab.length * ENGINES.length * SCOPES.length;
  if (rows.length !== expected) reasons.push(`${rows.length} observations, expected ${expected}`);
  for (const page of lab) {
    for (const engine of ENGINES) {
      for (const scope of SCOPES) {
        const at = `${page.id} ${engine}/${scope}`;
        const row = rows.find((o) => o.id === page.id && o.engine === engine && o.scope === scope);
        if (!row) {
          reasons.push(`${at}: not observed`);
          continue;
        }
        if (!row.seeded) reasons.push(`${at}: the step did not first resolve to its own target`);
        if (page.control) {
          if (row.resolved.length !== 1 || row.resolved[0] !== "<target>") reasons.push(`${at}: legitimate recovery lost (${row.resolved.join(",") || "none"})`);
        } else if (row.resolved.length) {
          reasons.push(`${at}: WRONG element after the target was removed: ${row.resolved.join(",")}`);
        }
      }
    }
  }
  return reasons;
}

/** L12.27: one late look-alike sequence on one engine and scope. */
export interface LateObservation {
  id: string;
  engine: LocatorRecoveryEngine;
  scope: Scope;
  /** Every passing resolve (the first and one after each `passes` entry) returned the original target node. */
  passed: boolean;
  /** Digests winner memory held after the last pass (undefined: none written). */
  remembered: number | undefined;
  resolved: string[];
  reasons: string[];
  /** The record's walk key and digest count after the first pass and after each later one. */
  history: Array<{ key?: string; digests?: number }>;
}

/** The L12.27 gate. Pure, like the F1 gate. */
export function lateTwinGate(lab: TwinLatePage[], rows: LateObservation[]): string[] {
  const reasons: string[] = [];
  if (lab.length !== PINNED.late) reasons.push(`late page count ${lab.length}, pinned ${PINNED.late}`);
  if (lab.filter((page) => page.expect === "recover").length !== 1) reasons.push("late control page count, pinned 1");
  const expected = lab.length * ENGINES.length * SCOPES.length;
  if (rows.length !== expected) reasons.push(`${rows.length} late observations, expected ${expected}`);
  for (const page of lab) {
    for (const engine of ENGINES) {
      for (const scope of SCOPES) {
        const at = `${page.id} ${engine}/${scope}`;
        const row = rows.find((o) => o.id === page.id && o.engine === engine && o.scope === scope);
        if (!row) {
          reasons.push(`${at}: not observed`);
          continue;
        }
        if (!row.passed) reasons.push(`${at}: a passing resolve did not return the original target`);
        if (row.remembered !== page.remembered) reasons.push(`${at}: memory holds ${row.remembered ?? "no"} look-alikes after the last pass, expected ${page.remembered}`);
        if (page.expect === "recover") {
          if (row.resolved.length !== 1 || row.resolved[0] !== "<target>") reasons.push(`${at}: legitimate recovery lost (${row.resolved.join(",") || "none"})`);
        } else if (row.resolved.length) {
          reasons.push(`${at}: WRONG element after the target was removed: ${row.resolved.join(",")}`);
        } else if (scope === "document" && !row.reasons.includes("local:pre-existing-twin")) {
          // In document scope every late look-alike is in the local layer's pool, so only the veto may refuse it
          // (not a thrown resolve, the container or visibility).
          reasons.push(`${at}: refused without the pre-existing-twin veto (${row.reasons.join(" ") || "no trace"})`);
        }
      }
    }
  }
  return reasons;
}

/**
 * The L12.30 history gate. Pure. Every sequence refuses with its stated reason on every engine and scope; the N1/N2
 * sequences keep no set (unproven) and the controls at each bound keep their exact count.
 */
export function historyGate(lab: TwinHistoryPage[], rows: LateObservation[]): string[] {
  const reasons: string[] = [];
  if (lab.length !== PINNED.history) reasons.push(`history page count ${lab.length}, pinned ${PINNED.history}`);
  if (lab.filter((page) => page.reason === "twins-unproven").length !== 2) reasons.push("unproven history page count, pinned 2");
  const expected = lab.length * ENGINES.length * SCOPES.length;
  if (rows.length !== expected) reasons.push(`${rows.length} history observations, expected ${expected}`);
  for (const page of lab) {
    for (const engine of ENGINES) {
      for (const scope of SCOPES) {
        const at = `${page.id} ${engine}/${scope}`;
        const row = rows.find((o) => o.id === page.id && o.engine === engine && o.scope === scope);
        if (!row) {
          reasons.push(`${at}: not observed`);
          continue;
        }
        if (!row.passed) reasons.push(`${at}: a passing resolve did not return the original target`);
        if (row.remembered !== page.remembered) reasons.push(`${at}: memory holds ${row.remembered ?? "no"} look-alikes after the last pass, expected ${page.remembered ?? "none (unproven)"}`);
        if (row.resolved.length) reasons.push(`${at}: WRONG element after the target was removed: ${row.resolved.join(",")}`);
        else if (!row.reasons.includes(`local:${page.reason}`)) reasons.push(`${at}: refused without local:${page.reason} (${row.reasons.join(" ") || "no trace"})`);
      }
    }
  }
  return reasons;
}

/** First pass, then each `passes` entry and another normal pass, then `final` and one more resolve. */
async function observeLate(
  browser: Browser,
  url: string,
  page: Pick<TwinLatePage, "id" | "passes" | "recovery" | "final">,
  engine: LocatorRecoveryEngine,
  scope: Scope,
  root: string
): Promise<LateObservation> {
  const tab: Page = await browser.newPage();
  try {
    await tab.goto(url);
    const folder = await mkdtemp(join(root, "late-"));
    const store = new FileLocatorRecoveryStore(folder);
    const events: LocatorRecoveryEvent[] = [];
    const step = {
      id: "save-profile",
      name: "Save profile",
      type: "click",
      locator: {
        strategy: "css",
        value: "#save-profile",
        ...(scope === "container" ? { context: { containers: [{ type: "landmark", strategy: "css", value: 'main[id="editor"]' }] } } : {})
      }
    } as unknown as FlowStep;
    const factory = () =>
      new LocatorFactory(tab, { recoveryStore: store, scope: { scenarioId: "l12-27", flowId: page.id }, recoveryGraceMs: 0, recoveryEngine: engine, onRecoveryEvent: (event) => events.push(event) });
    await tab.evaluate(() => {
      (window as unknown as { __target: Element }).__target = document.getElementById("save-profile")!;
    });
    const isTarget = async () =>
      (await factory().resolve(step)).evaluate((element) => element === (window as unknown as { __target: Element }).__target).catch(() => false);
    const history: LateObservation["history"] = [];
    const snapshot = async () => {
      const [name] = (await readdir(folder)).filter((entry) => entry.endsWith(".json"));
      const saved = name ? (JSON.parse(await readFile(join(folder, name), "utf8")) as { twinScanKey?: string; twinDigests?: unknown[] }) : undefined;
      history.push({ key: saved?.twinScanKey, digests: saved?.twinDigests?.length });
    };
    let passed = await isTarget();
    await snapshot();
    for (const ops of page.passes) {
      for (const op of ops) await tab.evaluate((value) => (window as unknown as { __fixture: { run(op: string): boolean } }).__fixture.run(value), op);
      passed = (await isTarget()) && passed;
      await snapshot();
    }
    if (page.recovery) {
      for (const op of page.recovery) await tab.evaluate((value) => (window as unknown as { __fixture: { run(op: string): boolean } }).__fixture.run(value), op);
      events.length = 0;
      // The original node, through a proven local recovery (not a candidate that still matched).
      passed = (await isTarget()) && events.some((event) => event.type === "local-recovery") && passed;
    }
    const [file] = (await readdir(folder)).filter((name) => name.endsWith(".json"));
    const record = file ? (JSON.parse(await readFile(join(folder, file), "utf8")) as { twinDigests?: unknown[] }) : undefined;
    for (const op of page.final) await tab.evaluate((value) => (window as unknown as { __fixture: { run(op: string): boolean } }).__fixture.run(value), op);
    events.length = 0;
    let resolved: string[] = [];
    try {
      const locator = await factory().resolve(step);
      resolved = await locator.evaluateAll((elements) => elements.map((element) => (element === (window as unknown as { __target: Element }).__target ? "<target>" : `#${element.id}`)));
    } catch {
      resolved = [];
    }
    const reasons = events.flatMap((event) => event.trace?.stages ?? []).flatMap((stage) => (stage.reason ? [`${stage.stage}:${stage.reason}`] : [`${stage.stage}:${stage.outcome}`]));
    return { id: page.id, engine, scope, passed, remembered: Array.isArray(record?.twinDigests) ? record.twinDigests.length : undefined, resolved, reasons, history };
  } finally {
    await tab.close();
  }
}

/** Seed winner memory with one passing resolve, mutate, resolve again. */
async function observe(browser: Browser, url: string, page: TwinPoolPage, engine: LocatorRecoveryEngine, scope: Scope, root: string): Promise<PoolObservation & { record: unknown }> {
  const tab: Page = await browser.newPage();
  try {
    await tab.goto(url);
    const folder = await mkdtemp(join(root, "store-"));
    const store = new FileLocatorRecoveryStore(folder);
    const events: LocatorRecoveryEvent[] = [];
    const step = {
      id: "save-profile",
      name: "Save profile",
      type: "click",
      locator: {
        strategy: "css",
        value: "#save-profile",
        ...(scope === "container" ? { context: { containers: [{ type: "landmark", strategy: "css", value: 'main[id="editor"]' }] } } : {})
      }
    } as unknown as FlowStep;
    const factory = () =>
      new LocatorFactory(tab, { recoveryStore: store, scope: { scenarioId: "l12-25", flowId: page.id }, recoveryGraceMs: 0, recoveryEngine: engine, onRecoveryEvent: (event) => events.push(event) });
    const seeded = await (await factory().resolve(step)).evaluate((element) => {
      (window as unknown as { __target: Element }).__target = element;
      return element.id;
    });
    await tab.evaluate((control) => {
      const target = document.getElementById("save-profile")!;
      if (control) target.id = "save-profile-v2";
      else target.remove();
    }, page.control === true);
    let resolved: string[] = [];
    try {
      const locator = await factory().resolve(step);
      resolved = await locator.evaluateAll((elements) => elements.map((element) => (element === (window as unknown as { __target: Element }).__target ? "<target>" : `#${element.id}`)));
    } catch {
      resolved = [];
    }
    const reasons = events.flatMap((event) => event.trace?.stages ?? []).flatMap((stage) => (stage.reason ? [`${stage.stage}:${stage.reason}`] : [`${stage.stage}:${stage.outcome}`]));
    const [file] = (await readdir(folder)).filter((name) => name.endsWith(".json"));
    return { id: page.id, engine, scope, seeded: seeded === "save-profile", resolved, reasons, record: file ? JSON.parse(await readFile(join(folder, file), "utf8")) : undefined };
  } finally {
    await tab.close();
  }
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "awkit-l12-25-twins-"));
  const server: Server = createServer((request, response) => {
    const match = /^\/dom-coverage-lab\/([a-z0-9-]+)$/.exec(new URL(request.url ?? "/", "http://x").pathname);
    const body = match ? coveragePage(match[1]) : undefined;
    if (!body) return void response.writeHead(404).end();
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
  });
  const base = await new Promise<string>((done) => server.listen(0, "127.0.0.1", () => done(`http://127.0.0.1:${(server.address() as { port: number }).port}`)));
  const urlOf = (id: string) => `${base}/dom-coverage-lab/${id}`;
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();

    console.log(`A. ${TWIN_POOL_LAB.length} twin-pool pages x ${ENGINES.length} engines x ${SCOPES.length} scopes`);
    const rows: PoolObservation[] = [];
    let sample: unknown;
    for (const page of TWIN_POOL_LAB) {
      for (const engine of ENGINES) {
        for (const scope of SCOPES) {
          const { record, ...row } = await observe(browser, urlOf(page.id), page, engine, scope, root);
          rows.push(row);
          if (page.id === "twins-hidden-12" && engine === "snapshot" && scope === "container") sample = record;
          console.log(`    ${page.id.padEnd(24)} ${engine.padEnd(8)} ${scope.padEnd(9)} -> ${row.resolved.join(",") || "no element"}  [${row.reasons.join(" ")}]`);
        }
      }
    }
    const reasons = twinPoolGate(TWIN_POOL_LAB, rows);
    check("no removed target ever recovers to another element, and the control still recovers its exact target", reasons.length === 0, reasons.slice(0, 12));
    check(
      "the visible look-alike inside the container is never returned, with 8 or more hidden look-alikes inside or outside it",
      rows.filter((o) => TWIN_POOL_LAB.find((p) => p.id === o.id)!.hidden >= 8).every((o) => !o.resolved.includes("#save-notes"))
    );
    // The memory is bounded and compact: identity digests, not fingerprints or page text.
    const digests = (sample as { twinDigests?: unknown } | undefined)?.twinDigests;
    check("winner memory keeps every look-alike as a compact digest (the notes' Save and 12 hidden tabs: 13)", Array.isArray(digests) && digests.length === 13 && digests.every((d) => typeof d === "string" && /^[0-9a-f]{16}$/.test(d)), digests);

    console.log("B. Older winner memory without the L12.25 field: loads, fails closed, and stays unproven after the next pass (L12.30)");
    {
      const tab = await browser.newPage();
      await tab.goto(urlOf("twins-hidden-0"));
      const folder = await mkdtemp(join(root, "legacy-"));
      const store = new FileLocatorRecoveryStore(folder);
      const events: LocatorRecoveryEvent[] = [];
      const step = { id: "save-profile", name: "Save profile", type: "click", locator: { strategy: "css", value: "#save-profile" } } as unknown as FlowStep;
      const factory = () => new LocatorFactory(tab, { recoveryStore: store, scope: { scenarioId: "l12-25", flowId: "legacy" }, recoveryGraceMs: 0, onRecoveryEvent: (event) => events.push(event) });
      await factory().resolve(step);
      const [file] = (await readdir(folder)).filter((name) => name.endsWith(".json"));
      const record = JSON.parse(await readFile(join(folder, file), "utf8")) as Record<string, unknown>;
      // The L12.23/L12.24 shape: up to 8 fingerprints in `twins`, no digests.
      delete record.twinDigests;
      record.twins = [];
      await writeFile(join(folder, file), JSON.stringify(record));
      check("the older record still loads", (await store.get(String(record.scopeKey)))?.fingerprint !== undefined);
      await tab.evaluate(() => {
        const target = document.getElementById("save-profile")!;
        (window as unknown as { __kept: Element }).__kept = target;
        target.remove();
      });
      const recovered = await factory()
        .resolve(step)
        .then((locator) => locator.count())
        .catch(() => 0);
      const stages = events.flatMap((event) => event.trace?.stages ?? []);
      check("...and recovery from it acts on nothing (the visible look-alike stays untouched)", recovered === 0, recovered);
      check("...refused as twins-unproven, not by luck", stages.some((stage) => stage.reason === "twins-unproven"), stages.map((stage) => `${stage.stage}:${stage.reason ?? stage.outcome}`));
      // Back where it was, so a later recovery reaches the look-alike veto rather than the ancestry veto.
      await tab.evaluate(() => document.querySelector("#profile .actions")!.append((window as unknown as { __kept: Element }).__kept));
      await factory().resolve(step);
      const after = JSON.parse(await readFile(join(folder, file), "utf8")) as { twinDigests?: unknown; twinScanKey?: unknown; fingerprint?: unknown };
      // L12.30: the older record never covered the successes it was written at, so one complete walk now cannot prove
      // what stood beside the target before it. It stays unproven (until the step's candidates change).
      check("L12.30: the next passing resolve does NOT turn it into a trusted set (no digests, no walk key)", after.fingerprint !== undefined && after.twinDigests === undefined && after.twinScanKey === undefined, after);
      await tab.evaluate(() => document.getElementById("save-profile")!.remove());
      events.length = 0;
      const again = await factory()
        .resolve(step)
        .then((locator) => locator.count())
        .catch(() => 0);
      const later = events.flatMap((event) => event.trace?.stages ?? []);
      check("...so a later recovery still acts on nothing, refused as twins-unproven", again === 0 && later.some((stage) => stage.reason === "twins-unproven"), later.map((stage) => `${stage.stage}:${stage.reason ?? stage.outcome}`));
      await tab.close();
    }

    // L12.28 QC: a record written before L12.27 holds the set of its FIRST success and no walk key. Trusting it kept the
    // L12.26 bug alive on existing installs: recovery acted on #save-notes on both engines.
    console.log("B2. L12.25-era winner memory (a set but no walk key): fails closed, and stays unproven after the next pass (L12.30)");
    for (const engine of ENGINES) {
      const tab = await browser.newPage();
      await tab.goto(urlOf("late-one"));
      const folder = await mkdtemp(join(root, "frozen-"));
      const store = new FileLocatorRecoveryStore(folder);
      const events: LocatorRecoveryEvent[] = [];
      const step = { id: "save-profile", name: "Save profile", type: "click", locator: { strategy: "css", value: "#save-profile" } } as unknown as FlowStep;
      const factory = () => new LocatorFactory(tab, { recoveryStore: store, scope: { scenarioId: "l12-27", flowId: "frozen" }, recoveryGraceMs: 0, recoveryEngine: engine, onRecoveryEvent: (event) => events.push(event) });
      const run = (op: string) => tab.evaluate((value) => (window as unknown as { __fixture: { run(op: string): boolean } }).__fixture.run(value), op);
      await factory().resolve(step);
      await run("add:notes:save-notes:Save");
      await factory().resolve(step);
      const [file] = (await readdir(folder)).filter((name) => name.endsWith(".json"));
      const record = JSON.parse(await readFile(join(folder, file), "utf8")) as Record<string, unknown>;
      // Exactly what the L12.25 code left: the set of the first success (no look-alike then), no walk key.
      record.twinDigests = [];
      delete record.twinScanKey;
      await writeFile(join(folder, file), JSON.stringify(record));
      if (engine === "snapshot") {
        // L12.30: a frozen set missed what came and went since its first success; one walk cannot prove that history.
        await run("drop:notes");
        await factory().resolve(step);
        await run("add:notes:save-notes:Save");
        const after = JSON.parse(await readFile(join(folder, file), "utf8")) as { twinDigests?: unknown[]; twinScanKey?: unknown };
        check("B2: the next passing resolve does NOT turn an L12.25-era record into a trusted set (no walk key, no set)", after.twinScanKey === undefined && after.twinDigests === undefined, after);
      }
      await run("drop-target");
      events.length = 0;
      let resolved: string[] = [];
      try {
        resolved = await (await factory().resolve(step)).evaluateAll((elements) => elements.map((element) => `#${element.id}`));
      } catch {
        resolved = [];
      }
      const stages = events.flatMap((event) => event.trace?.stages ?? []).map((stage) => `${stage.stage}:${stage.reason ?? stage.outcome}`);
      check(`B2 ${engine}: recovery from an L12.25-era record acts on nothing, refused as twins-unproven`, resolved.length === 0 && stages.includes("local:twins-unproven"), { resolved, stages });
      await tab.close();
    }

    console.log("C. Mutation controls: the gate fails for each defect it exists to catch");
    const copy = () => structuredClone(rows);
    const crowded = rows.findIndex((o) => o.id === "twins-hidden-8");
    const control = rows.findIndex((o) => TWIN_POOL_LAB.find((p) => p.id === o.id)?.control);
    let altered = copy();
    altered[crowded].resolved = ["#save-notes"];
    check("a recovery to the visible look-alike fails the gate", twinPoolGate(TWIN_POOL_LAB, altered).some((r) => r.includes("WRONG element")));
    altered = copy();
    altered[control].resolved = [];
    check("a lost legitimate recovery fails the gate", twinPoolGate(TWIN_POOL_LAB, altered).some((r) => r.includes("legitimate recovery lost")));
    altered = copy();
    altered[control].resolved = ["#save-notes"];
    check("a control that recovers the wrong element fails the gate", twinPoolGate(TWIN_POOL_LAB, altered).some((r) => r.includes("legitimate recovery lost")));
    check("a missing observation fails the gate", twinPoolGate(TWIN_POOL_LAB, rows.slice(1)).some((r) => r.includes("not observed")));
    check(
      "a crowded page dropped from the lab fails the gate",
      twinPoolGate(TWIN_POOL_LAB.filter((p) => p.id !== "twins-hidden-12"), rows.filter((o) => o.id !== "twins-hidden-12")).some((r) => r.includes("pinned"))
    );

    // ── D. L12.27: look-alikes that arrive after the first success ───────────────────────────────────
    console.log(`D. L12.27: ${TWIN_LATE_LAB.length} late look-alike sequences x ${ENGINES.length} engines x ${SCOPES.length} scopes`);
    const late: LateObservation[] = [];
    for (const page of TWIN_LATE_LAB) {
      for (const engine of ENGINES) {
        for (const scope of SCOPES) {
          const row = await observeLate(browser, urlOf(page.id), page, engine, scope, root);
          late.push(row);
          console.log(`    ${page.id.padEnd(16)} ${engine.padEnd(8)} ${scope.padEnd(9)} remembered=${row.remembered ?? "-"} -> ${row.resolved.join(",") || "no element"}  [${row.reasons.join(" ")}]`);
        }
      }
    }
    const lateReasons = lateTwinGate(TWIN_LATE_LAB, late);
    check("a look-alike that arrives after the first success is remembered by the next passing resolve, and recovery never acts on it", lateReasons.length === 0, lateReasons.slice(0, 12));
    check(
      "the QC repro (late-one) refuses on every engine and scope, by the pre-existing-twin veto",
      late.filter((o) => o.id === "late-one").every((o) => o.resolved.length === 0 && o.reasons.includes("local:pre-existing-twin")),
      late.filter((o) => o.id === "late-one").map((o) => o.reasons)
    );
    // The walk key: a new look-alike changes it (so the set is derived again), an unchanged page keeps it (and the set).
    check(
      "late-one: the added Save changes the walk key and the set (0 -> 1), the unchanged pass after it keeps both",
      late
        .filter((o) => o.id === "late-one")
        .every((o) => o.history.length === 3 && o.history.every((h) => typeof h.key === "string") && o.history[0].key !== o.history[1].key && o.history[1].key === o.history[2].key && o.history.map((h) => h.digests).join() === "0,1,1"),
      late.filter((o) => o.id === "late-one").map((o) => o.history)
    );
    check(
      "the L12.26 P2 path (late-after-recovery): a Save that stood beside the target at a recovery is remembered, so recovery never acts on it",
      late.filter((o) => o.id === "late-after-recovery").every((o) => o.passed && o.resolved.length === 0 && o.reasons.includes("local:pre-existing-twin")),
      late.filter((o) => o.id === "late-after-recovery").map((o) => ({ passed: o.passed, resolved: o.resolved, reasons: o.reasons }))
    );
    {
      const lateCopy = () => structuredClone(late);
      const one = late.findIndex((o) => o.id === "late-one");
      const control = late.findIndex((o) => o.id === "late-control");
      let altered = lateCopy();
      altered[one].resolved = ["#save-notes"];
      check("D mutation: a recovery to the late look-alike fails the gate", lateTwinGate(TWIN_LATE_LAB, altered).some((r) => r.includes("WRONG element")));
      altered = lateCopy();
      altered[one].remembered = 0;
      check("D mutation: memory frozen at the first success (0 look-alikes) fails the gate", lateTwinGate(TWIN_LATE_LAB, altered).some((r) => r.includes("expected 1")));
      altered = lateCopy();
      altered[control].resolved = [];
      check("D mutation: a lost legitimate recovery fails the gate", lateTwinGate(TWIN_LATE_LAB, altered).some((r) => r.includes("legitimate recovery lost")));
      altered = lateCopy();
      altered[one].passed = false;
      check("D mutation: a passing resolve that returned another element fails the gate", lateTwinGate(TWIN_LATE_LAB, altered).some((r) => r.includes("did not return the original")));
      altered = lateCopy();
      altered[late.findIndex((o) => o.id === "late-one" && o.scope === "document")].reasons = ["local:no-candidate"];
      check("D mutation: a document-scope refusal without the veto fails the gate", lateTwinGate(TWIN_LATE_LAB, altered).some((r) => r.includes("without the pre-existing-twin veto")));
      check("D mutation: a dropped late page fails the gate", lateTwinGate(TWIN_LATE_LAB.slice(1), late.filter((o) => o.id !== TWIN_LATE_LAB[0].id)).some((r) => r.includes("pinned")));
    }

    // ── E. L12.30 N1/N2: overflow and a cut-short walk never turn an incomplete history into a trusted one ──
    console.log(`E. L12.30 N1/N2: ${TWIN_HISTORY_LAB.length} history sequences x ${ENGINES.length} engines x ${SCOPES.length} scopes`);
    const history: LateObservation[] = [];
    for (const page of TWIN_HISTORY_LAB) {
      for (const engine of ENGINES) {
        for (const scope of SCOPES) {
          const row = await observeLate(browser, urlOf(page.id), page, engine, scope, root);
          history.push(row);
          console.log(`    ${page.id.padEnd(20)} ${engine.padEnd(8)} ${scope.padEnd(9)} remembered=${row.remembered ?? "-"} -> ${row.resolved.join(",") || "no element"}  [${row.reasons.join(" ")}]`);
        }
      }
    }
    const historyReasons = historyGate(TWIN_HISTORY_LAB, history);
    check("N1/N2: past either bound the history stays unproven and recovery refuses; exactly at each bound it stays complete and vetoes", historyReasons.length === 0, historyReasons.slice(0, 12));
    {
      const historyCopy = () => structuredClone(history);
      const overflow = history.findIndex((o) => o.id === "hist-overflow");
      const truncated = history.findIndex((o) => o.id === "hist-truncated");
      let altered = historyCopy();
      altered[overflow] = { ...altered[overflow], resolved: ["#save-notes"], remembered: 1024 };
      check("E mutation: N1 as it was (the current walk kept, recovery on #save-notes) fails the gate", historyGate(TWIN_HISTORY_LAB, altered).some((r) => r.includes("WRONG element")));
      altered = historyCopy();
      altered[truncated] = { ...altered[truncated], remembered: 0 };
      check("E mutation: N2 as it was (a fresh trusted set after the cut-short walk) fails the gate", historyGate(TWIN_HISTORY_LAB, altered).some((r) => r.includes("expected none")));
      altered = historyCopy();
      altered[truncated] = { ...altered[truncated], reasons: ["local:pre-existing-twin"] };
      check("E mutation: a refusal for another reason than twins-unproven fails the gate", historyGate(TWIN_HISTORY_LAB, altered).some((r) => r.includes("refused without local:twins-unproven")));
      check("E mutation: a dropped history page fails the gate", historyGate(TWIN_HISTORY_LAB.slice(1), history.filter((o) => o.id !== TWIN_HISTORY_LAB[0].id)).some((r) => r.includes("pinned")));
    }

    // ── F. L12.30 N3: two instances, one shared winner record, ordered by barriers ──────────────────────
    // Each instance has its own page, its own LocatorFactory and its own FileLocatorRecoveryStore on the SAME folder, as two
    // PlaywrightRunner instances in one engine do. Instance A's first read of the record is held at a barrier while B runs
    // to completion, so A then works from a record B has since replaced. Nothing is timed.
    console.log("F. L12.30 N3: concurrent instances sharing one winner record (barriers, no sleeps)");
    for (const engine of ENGINES) {
      // stale-write: A's page is unchanged, so its walk reuses the set it read. stale-write-merge: A's page gained its own
      // look-alike, so its walk is merged. stale-read: A's target is gone and it recovers.
      for (const order of ["stale-write", "stale-write-merge", "stale-read"] as const) {
        const folder = await mkdtemp(join(root, "race-"));
        const tabA = await browser.newPage();
        const tabB = await browser.newPage();
        await tabA.goto(urlOf("late-one"));
        await tabB.goto(urlOf("late-one"));
        const run = (tab: Page, op: string) => tab.evaluate((value) => (window as unknown as { __fixture: { run(op: string): boolean } }).__fixture.run(value), op);
        const step = { id: "save-profile", name: "Save profile", type: "click", locator: { strategy: "css", value: "#save-profile" } } as unknown as FlowStep;
        const storeA = new FileLocatorRecoveryStore(folder);
        const storeB = new FileLocatorRecoveryStore(folder);
        let held: { arrived: () => void; release: Promise<void> } | undefined;
        // A's store, with its NEXT read held after it returns (the record as it was), until released.
        const gatedA = Object.assign(Object.create(storeA) as LocatorRecoveryStore, {
          async get(key: string): Promise<LocatorRecoveryRecord | undefined> {
            const record = await storeA.get(key);
            const hold = held;
            held = undefined;
            if (hold) {
              hold.arrived();
              await hold.release;
            }
            return record;
          }
        });
        const eventsA: LocatorRecoveryEvent[] = [];
        const eventsB: LocatorRecoveryEvent[] = [];
        const factoryA = () => new LocatorFactory(tabA, { recoveryStore: gatedA, scope: { scenarioId: "l12-30", flowId: "race" }, recoveryGraceMs: 0, recoveryEngine: engine, onRecoveryEvent: (event) => eventsA.push(event) });
        const factoryB = () => new LocatorFactory(tabB, { recoveryStore: storeB, scope: { scenarioId: "l12-30", flowId: "race" }, recoveryGraceMs: 0, recoveryEngine: engine, onRecoveryEvent: (event) => eventsB.push(event) });
        const ids = (locator: import("playwright").Locator) => locator.evaluateAll((elements) => elements.map((element) => `#${element.id}`)).catch(() => [] as string[]);
        const stagesOf = (events: LocatorRecoveryEvent[]) => events.flatMap((event) => event.trace?.stages ?? []).map((stage) => `${stage.stage}:${stage.reason ?? stage.outcome}`);
        // Both instances have passed once with the target alone: one trusted record with no look-alike.
        await factoryA().resolve(step);
        await factoryB().resolve(step);
        await run(tabB, "add:notes:save-notes:Save");
        if (order === "stale-write-merge") await run(tabA, "add:comments:save-comments:Save comment");
        if (order === "stale-read") {
          await run(tabA, "drop-target");
          await run(tabA, "add:notes:save-notes:Save");
        }
        let arrived!: () => void;
        const atBarrier = new Promise<void>((done) => (arrived = done));
        let release!: () => void;
        held = { arrived, release: new Promise<void>((done) => (release = done)) };
        const resolvingA = factoryA()
          .resolve(step)
          .then(ids, () => [] as string[]);
        await atBarrier;
        check(`F ${engine}/${order}: instance B passes while A holds its stale read`, (await ids(await factoryB().resolve(step))).join() === "#save-profile");
        release();
        const resolvedA = await resolvingA;
        const [file] = (await readdir(folder)).filter((name) => name.endsWith(".json"));
        const record = JSON.parse(await readFile(join(folder, file), "utf8")) as { twinDigests?: string[] };
        if (order !== "stale-read") {
          const kept = order === "stale-write" ? 1 : 2;
          check(`F ${engine}/${order}: A's write merges into what B wrote meanwhile: ${kept} look-alike(s) kept`, resolvedA.join() === "#save-profile" && record.twinDigests?.length === kept, { resolvedA, digests: record.twinDigests?.length });
          await run(tabB, "drop-target");
          eventsB.length = 0;
          const resolvedB = await factoryB()
            .resolve(step)
            .then(ids, () => [] as string[]);
          check(`F ${engine}/${order}: B's recovery never acts on #save-notes (pre-existing-twin)`, resolvedB.length === 0 && stagesOf(eventsB).includes("local:pre-existing-twin"), { resolvedB, stages: stagesOf(eventsB) });
        } else {
          check(`F ${engine}/stale-read: A's recovery decides on the record B wrote: never #save-notes (pre-existing-twin)`, resolvedA.length === 0 && stagesOf(eventsA).includes("local:pre-existing-twin"), { resolvedA, stages: stagesOf(eventsA) });
        }
        await tabA.close();
        await tabB.close();
      }
    }
    {
      // The lane itself: 40 merges from two store instances on one folder, all issued at once. Every one must survive.
      const folder = await mkdtemp(join(root, "lane-"));
      const stores = [new FileLocatorRecoveryStore(folder), new FileLocatorRecoveryStore(folder)];
      const base: LocatorRecoveryRecord = { version: 1, scopeKey: "lane", candidatesDigest: "d", winningCandidateSignature: "s", twinDigests: [], twinScanKey: "k", source: "recorded-candidate", updatedAt: "" };
      await stores[0].put(base);
      // Without the lane the merges lose updates, and on Windows concurrent renames onto one file fail with EPERM.
      const error = await Promise.all(
        Array.from({ length: 40 }, (_, i) =>
          stores[i % 2].update("lane", (latest) => ({ ...(latest ?? base), twinDigests: [...(latest?.twinDigests ?? []), i.toString(16).padStart(16, "0")] }))
        )
      ).then(
        () => undefined,
        (failure: unknown) => String(failure)
      );
      const merged = (await stores[1].get("lane"))?.twinDigests ?? [];
      check("F lane: 40 concurrent read-merge-writes from two store instances on one folder all succeed and keep all 40", !error && new Set(merged).size === 40, error ?? merged.length);
    }
  } finally {
    await browser?.close().catch(() => undefined);
    server.close();
    await rm(root, { recursive: true, force: true });
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
