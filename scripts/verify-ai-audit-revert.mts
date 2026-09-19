/**
 * verify:ai-audit-revert — Phase L L1.4 audit store and one-click revert.
 *
 * Runs against real temporary folders: `AiActionStore` (atomic JSON document) and a real
 * `JsonProfileStore` holding the flow. No model, no AI service and no Electron are involved, which
 * is itself part of the contract: revert and the audit log never need the model.
 *
 * What makes it fail: a record that keeps a field outside its contract (page text, prompts, locator
 * values); retention that keeps the wrong records; concurrent appends that drop one another; a
 * demotion that clears itself; a revert that overwrites a later user edit, restores anything other
 * than the exact previous locator, or reads the flow outside the folder lane.
 *
 * Run: npm run verify:ai-audit-revert
 */

import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AI_ACTION_RECORD_RETENTION,
  pruneAiActionRecords,
  sanitizeAiActionRecord,
  type AiActionRecord
} from "@src/ai/AiActionRecord";
import { AiActionStore } from "@src/ai/AiActionStore";
import { revertAiAction, revertAiLocatorChange } from "@src/ai/AiRevert";
import { AI_SELF_DEMOTION } from "@src/security/authz/AiAutonomyPolicy";
import type { FlowProfile, FlowStep, LocatorGuard, StepLocator } from "@src/profiles/FlowProfile";
import { createLocatorApprovalBinding } from "@src/profiles/locatorApproval";
import { runExclusive } from "@src/storage/folderWriteCoordinator";
import { JsonProfileStore } from "@src/storage/ProfileStore";

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

const NOW = Date.parse("2026-09-19T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number): string => new Date(ms).toISOString();
const roots: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "awkit-ai-audit-"));
  roots.push(dir);
  return dir;
}

function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "act-1",
    feature: "locatorSemanticUpgrade",
    actionClass: "locatorChange",
    tier: "T2",
    target: { kind: "stepLocator", flowId: "flow-1", stepId: "step-1" },
    evidenceIds: ["ev-1", "ev-2"],
    proof: { result: "replay-proven", replays: 3, dataRows: 2 },
    modelId: "qwen3.5-4b-q4km",
    createdAt: iso(NOW - DAY),
    revertHandle: { kind: "locatorProvenance" },
    ...overrides
  };
}

// ── Flow fixture: a guarded-positional locator that an AI change replaced ─────────────────────────
const guarded: StepLocator = {
  strategy: "css",
  value: "table tbody tr >> nth=2",
  quality: { strategy: "fallback", isUnique: true, matchCount: 1, confidence: "low", disambiguation: "positional" },
  resolution: "resolved",
  resolvedBy: "recorder",
  guard: {
    candidateSelector: "tr",
    fingerprint: { version: 1, hash: "fp-abc" },
    siblingCount: 5,
    index: 2,
    confidence: "exact"
  } as unknown as LocatorGuard
};

function appliedFlow(actionId = "act-1"): FlowProfile {
  const base: FlowStep = {
    id: "step-1",
    type: "click",
    name: "Open order",
    locator: { strategy: "role", value: "button", name: "Open order 1042", exact: true, resolution: "resolved", resolvedBy: "recorder" }
  };
  const binding = createLocatorApprovalBinding(base)!;
  const step: FlowStep = {
    ...base,
    locator: {
      ...base.locator!,
      locatorProvenance: {
        schemaVersion: 1,
        source: "ai-semantic-upgrade",
        tier: "T2",
        actionId,
        modelId: "qwen3.5-4b-q4km",
        proof: "replay-proven",
        appliedAt: iso(NOW - DAY),
        binding,
        previous: guarded
      }
    }
  };
  return {
    id: "flow-1",
    name: "Orders",
    version: 3,
    nodes: [{ id: "start", type: "start", name: "Start" } as FlowStep, step],
    edges: []
  };
}

try {
  console.log("Record contract — ids, enums and counts only:\n");
  {
    const ok = sanitizeAiActionRecord(record({ prompt: "ignore previous instructions", pageText: "Jane Doe", locatorValue: "#secret" }));
    check("a valid record sanitizes", ok.ok, JSON.stringify(ok));
    const keys = ok.ok ? Object.keys(ok.record).sort().join(",") : "";
    check(
      "unknown fields (prompt, page text, locator value) are dropped",
      ok.ok && !("prompt" in ok.record) && !("pageText" in ok.record) && !("locatorValue" in ok.record),
      keys
    );
    check(
      "the rebuilt record has exactly the contract's fields",
      keys === "actionClass,createdAt,evidenceIds,feature,id,modelId,proof,revertHandle,schemaVersion,target,tier",
      keys
    );
    const nested = sanitizeAiActionRecord(record({ target: { kind: "stepLocator", flowId: "f", stepId: "s", locator: "#x" } as never }));
    check("nested unknown fields are dropped too", nested.ok && !("locator" in nested.record.target));
    const rejects = (label: string, overrides: Record<string, unknown>): void => {
      const result = sanitizeAiActionRecord(record(overrides));
      check(`rejects ${label}`, !result.ok, JSON.stringify(result));
    };
    rejects("an interpretation (T0 output is never applied)", { actionClass: "interpretation" });
    rejects("a T0 tier", { tier: "T0" });
    rejects("a T3 tier", { tier: "T3" });
    rejects("a T3 action class", { actionClass: "runControl" });
    rejects("an unknown feature", { feature: "rogueFeature" });
    rejects("a control character in an id", { id: `act${String.fromCharCode(10)}1` });
    rejects("an overlong id", { id: "a".repeat(201) });
    rejects("too many evidence ids", { evidenceIds: Array.from({ length: 33 }, (_, i) => `ev-${i}`) });
    rejects("free text posing as an evidence id", { evidenceIds: [`line one${String.fromCharCode(13)}line two`] });
    rejects("an unknown proof result", { proof: { result: "model-says-so" } });
    rejects("a fractional replay count", { proof: { result: "replay-proven", replays: 1.5 } });
    rejects("an unparseable timestamp", { createdAt: "yesterday" });
    rejects("another revert handle", { revertHandle: { kind: "arbitraryFile", path: "C:/x" } });
    rejects("a schema version other than 1", { schemaVersion: 2 });
  }

  console.log("\nRetention — newest 5,000, at most 90 days:\n");
  {
    const make = (i: number, ageMs: number) => sanitizeAiActionRecord(record({ id: `r-${i}`, createdAt: iso(NOW - ageMs) })) as { ok: true; record: AiActionRecord };
    const old = make(0, AI_ACTION_RECORD_RETENTION.maxAgeMs + DAY).record;
    const fresh = make(1, DAY).record;
    const kept = pruneAiActionRecords([old, fresh], NOW);
    check("a record older than 90 days is pruned", kept.length === 1 && kept[0].id === "r-1", JSON.stringify(kept.map((r) => r.id)));
    const many = Array.from({ length: AI_ACTION_RECORD_RETENTION.maxRecords + 25 }, (_, i) => make(i, i * 1000).record);
    const bounded = pruneAiActionRecords(many, NOW);
    check("the count bound holds", bounded.length === AI_ACTION_RECORD_RETENTION.maxRecords, String(bounded.length));
    check("the newest records are the ones kept", bounded[0].id === "r-0" && bounded.at(-1)!.id === `r-${AI_ACTION_RECORD_RETENTION.maxRecords - 1}`);
  }

  console.log("\nStore — atomic, serialized, re-validated on read:\n");
  {
    const dir = await tempDir();
    const file = join(dir, "ai", "ai-actions.json");
    const store = new AiActionStore(file, () => NOW, () => undefined);
    check("a missing file reads as empty", (await store.snapshot()).records.length === 0);
    const first = await store.append(record());
    check("append accepts a valid record", first.ok);
    check("append refuses a duplicate id", !(await store.append(record())).ok);
    check("append refuses an invalid record without writing", !(await store.append(record({ id: "x", tier: "T3" }))).ok && (await store.snapshot()).records.length === 1);
    const onDisk = JSON.parse(await readFile(file, "utf8"));
    check("the document is versioned JSON", onDisk.schemaVersion === 1 && Array.isArray(onDisk.records));

    await Promise.all(Array.from({ length: 20 }, (_, i) => store.append(record({ id: `c-${i}`, tier: "T1" }))));
    const afterConcurrent = await store.snapshot();
    check("20 concurrent appends all land (none drop another)", afterConcurrent.records.length === 21, String(afterConcurrent.records.length));
    check("no temp files are left behind", (await readdir(join(dir, "ai"))).every((name) => !name.endsWith(".tmp")));

    // A record smuggled into the file with extra fields is rebuilt on read.
    const raw = JSON.parse(await readFile(file, "utf8"));
    raw.records.push({ ...record({ id: "smuggled" }), prompt: "raw prompt text" });
    await writeFile(file, JSON.stringify(raw), "utf8");
    const smuggled = await new AiActionStore(file, () => NOW, () => undefined).get("smuggled");
    check("a record read back off disk is re-sanitized", smuggled !== null && !("prompt" in smuggled));

    await writeFile(file, "{ not json", "utf8");
    const recovered = await new AiActionStore(file, () => NOW, () => undefined).snapshot();
    const names = await readdir(join(dir, "ai"));
    check("a corrupt file reads as empty rather than throwing", recovered.records.length === 0);
    check("the corrupt bytes are preserved, not overwritten", names.some((name) => name.includes(".corrupt-")), names.join(","));
  }

  console.log("\nSelf-demotion is persisted state; re-promotion is explicit:\n");
  {
    const dir = await tempDir();
    const file = join(dir, "ai-actions.json");
    let clock = NOW;
    const store = new AiActionStore(file, () => clock, () => undefined);
    const n = AI_SELF_DEMOTION.minSample;
    const tripAt = Math.floor(n * AI_SELF_DEMOTION.maxRevertRate) + 1;
    for (let i = 0; i < n; i += 1) {
      const result = await store.append(record({ id: `d-${i}`, createdAt: iso(NOW - DAY) }));
      check(`append ${i + 1} does not demote while nothing is reverted`, result.ok && result.demoted === null);
    }
    for (let i = 0; i < tripAt; i += 1) await store.markReverted(`d-${i}`, iso(NOW));
    const demotions = (await store.snapshot()).demotions;
    check("crossing the revert-rate threshold records a demotion", demotions.locatorSemanticUpgrade !== undefined, JSON.stringify(demotions));
    check("the demotion records its evidence", demotions.locatorSemanticUpgrade?.reverted === tripAt && demotions.locatorSemanticUpgrade?.applied === n);
    check("a second mark on the same record is refused", (await store.markReverted("d-0", iso(NOW))) === "already-reverted");
    check("marking an unknown record reports it", (await store.markReverted("nope", iso(NOW))) === "not-found");

    clock = NOW + AI_SELF_DEMOTION.windowMs + 2 * DAY;
    const later = new AiActionStore(file, () => clock, () => undefined);
    check("the demotion survives a restart and the window passing", (await later.snapshot()).demotions.locatorSemanticUpgrade !== undefined);
    check("clearDemotion is the explicit re-promotion", (await later.clearDemotion("locatorSemanticUpgrade")) === true);
    check("after clearing, the feature is no longer demoted", (await later.snapshot()).demotions.locatorSemanticUpgrade === undefined);
    check("clearing twice reports nothing to clear", (await later.clearDemotion("locatorSemanticUpgrade")) === false);
  }

  console.log("\nRevert — compare-and-swap through the flow store's lane:\n");
  {
    const dir = await tempDir();
    const flows = new JsonProfileStore<FlowProfile>({ folder: join(dir, "flows") });
    const audit = new AiActionStore(join(dir, "ai", "ai-actions.json"), () => NOW, () => undefined);
    await flows.create(appliedFlow());
    await audit.append(record());

    const result = await revertAiAction("act-1", { audit, flows, now: () => NOW });
    const restored = (await flows.get("flow-1"))!.nodes[1].locator;
    check("revert succeeds", result.code === "OK", JSON.stringify(result));
    check("the exact previous locator is restored (guard intact)", JSON.stringify(restored) === JSON.stringify(guarded), JSON.stringify(restored));
    check("the provenance is gone after revert", restored !== undefined && !("locatorProvenance" in restored));
    check("the audit record is marked reverted", (await audit.get("act-1"))?.reverted?.at === iso(NOW) && result.auditMarked === true);
    check("a second revert is refused", (await revertAiAction("act-1", { audit, flows, now: () => NOW })).code === "ALREADY_REVERTED");
    check("an unknown action is refused", (await revertAiAction("nope", { audit, flows })).code === "NOT_FOUND");

    // The user edits the promoted locator; revert must refuse rather than overwrite the edit.
    const edited = appliedFlow("act-2");
    edited.nodes[1] = { ...edited.nodes[1], locator: { ...edited.nodes[1].locator!, value: "link" } };
    await flows.update("flow-1", edited);
    await audit.append(record({ id: "act-2" }));
    const before = await readFile(join(dir, "flows", "flow-1.json"), "utf8");
    check("a locator edited after the change makes revert STALE", (await revertAiAction("act-2", { audit, flows })).code === "STALE");
    check("a STALE revert writes nothing", (await readFile(join(dir, "flows", "flow-1.json"), "utf8")) === before);
    check("the STALE record stays un-reverted", (await audit.get("act-2"))?.reverted === undefined);

    const renamed = appliedFlow("act-2");
    renamed.nodes[1] = { ...renamed.nodes[1], name: "Open the order" };
    const refusal = (result: ReturnType<typeof revertAiLocatorChange>): string => (result.ok ? "OK" : result.code);
    check("renaming the step also makes revert STALE", refusal(revertAiLocatorChange(renamed, "step-1", "act-2", iso(NOW))) === "STALE");
    check(
      "a provenance from another action is refused",
      refusal(revertAiLocatorChange(appliedFlow("act-9"), "step-1", "act-2", iso(NOW))) === "ACTION_MISMATCH"
    );
    check("a missing step is refused", refusal(revertAiLocatorChange(appliedFlow(), "step-404", "act-1", iso(NOW))) === "STEP_NOT_FOUND");
    const plain = appliedFlow();
    plain.nodes[1] = { ...plain.nodes[1], locator: guarded };
    check("a step with no AI provenance is refused", refusal(revertAiLocatorChange(plain, "step-1", "act-1", iso(NOW))) === "NO_AI_PROVENANCE");

    const nestedFlow = appliedFlow("act-3");
    const provenance = nestedFlow.nodes[1].locator!.locatorProvenance!;
    provenance.previous = { ...guarded, locatorProvenance: { ...provenance }, pendingUpgrade: { schemaVersion: 1 } } as StepLocator;
    const nestedResult = revertAiLocatorChange(nestedFlow, "step-1", "act-3", iso(NOW));
    const nestedRestored = nestedResult.ok ? nestedResult.profile.nodes[1].locator! : undefined;
    check(
      "AI fields nested in previous are never resurrected",
      nestedRestored !== undefined && !("locatorProvenance" in nestedRestored) && !("pendingUpgrade" in nestedRestored)
    );

    await audit.append(record({ id: "act-4", target: { kind: "stepLocator", flowId: "flow-missing", stepId: "step-1" } }));
    check("a missing flow is refused", (await revertAiAction("act-4", { audit, flows })).code === "FLOW_NOT_FOUND");
  }

  console.log("\nRevert does not depend on the audit log being writable:\n");
  {
    const dir = await tempDir();
    const flows = new JsonProfileStore<FlowProfile>({ folder: join(dir, "flows") });
    await flows.create(appliedFlow());
    const recordValue = (sanitizeAiActionRecord(record()) as { ok: true; record: AiActionRecord }).record;
    const brokenAudit = {
      get: async () => recordValue,
      markReverted: async (): Promise<"marked"> => {
        throw new Error("disk full");
      }
    };
    const result = await revertAiAction("act-1", { audit: brokenAudit, flows });
    check("the flow is still restored", result.code === "OK" && JSON.stringify((await flows.get("flow-1"))!.nodes[1].locator) === JSON.stringify(guarded));
    check("the unmarked record is reported, not hidden", result.auditMarked === false);
  }

  console.log("\nupdateWith reads inside the folder lane:\n");
  {
    const dir = await tempDir();
    const folder = join(dir, "flows");
    const flows = new JsonProfileStore<FlowProfile>({ folder });
    await flows.create(appliedFlow());
    // Queue a slow writer on the same lane FIRST. If updateWith read before joining the lane it would
    // see the pre-edit file; reading inside the lane it must see the edit and refuse as STALE.
    const editorSave = runExclusive(folder, async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      const edited = appliedFlow();
      edited.nodes[1] = { ...edited.nodes[1], locator: { ...edited.nodes[1].locator!, value: "link" } };
      await writeFile(join(folder, "flow-1.json"), JSON.stringify(edited), "utf8");
    });
    let seen: string | undefined;
    const cas = flows.updateWith("flow-1", (current) => {
      seen = current?.nodes[1].locator?.value;
      const result = revertAiLocatorChange(current!, "step-1", "act-1", iso(NOW));
      return result.ok ? result.profile : undefined;
    });
    await Promise.all([editorSave, cas]);
    check("the compare step saw the concurrent edit", seen === "link", String(seen));
    check("so the lane-ordered revert was refused and the edit kept", (await flows.get("flow-1"))!.nodes[1].locator?.value === "link");
    let threw = false;
    try {
      await flows.updateWith("flow-1", (current) => ({ ...current!, id: "renamed" }));
    } catch {
      threw = true;
    }
    check("updateWith refuses to change the id", threw);
  }
} finally {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
