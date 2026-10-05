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
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium, type Browser, type Page } from "playwright";

import type { FlowStep } from "@src/profiles/FlowProfile";
import { LocatorFactory, type LocatorRecoveryEngine, type LocatorRecoveryEvent } from "@src/runner/LocatorFactory";
import { FileLocatorRecoveryStore } from "@src/runner/LocatorRecoveryStore";
import { TWIN_POOL_LAB, coveragePage, type TwinPoolPage } from "../mock-site/dom-coverage-corpus.mjs";

const ENGINES: LocatorRecoveryEngine[] = ["snapshot", "legacy"];
const SCOPES = ["container", "document"] as const;
/** Pinned so a dropped page fails the gate instead of shrinking it. */
const PINNED = { pages: 6, controls: 1, crowded: 3 };

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

    console.log("B. Older winner memory without the L12.25 field: loads, fails closed, is upgraded by the next pass");
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
      await tab.evaluate(() => document.getElementById("editor")!.prepend((window as unknown as { __kept: Element }).__kept));
      await factory().resolve(step);
      const upgraded = JSON.parse(await readFile(join(folder, file), "utf8")) as { twinDigests?: unknown };
      check("the next passing resolve writes the complete digest set", Array.isArray(upgraded.twinDigests) && upgraded.twinDigests.length === 1, upgraded.twinDigests);
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
