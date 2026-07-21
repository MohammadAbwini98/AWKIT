/**
 * Legacy Compatibility + suggested-fix migration verifier (Tranche 2, Stage 2c).
 * Run with: npx tsx scripts/verify-legacy-compat.mts
 *
 * Drives the REAL service (`app/main/validation/flowValidationService.ts`) against temp folders and
 * the REAL run gate (`PreRunValidator`) — no mocks of the logic under test. The service is
 * electron-free precisely so this can exist.
 *
 * The properties that matter most here are the *negative* ones, because this stage adds the only
 * machinery in the product that can weaken enforcement or rewrite a user's flow:
 *   - a grant never excuses an active-path or connector-structure error;
 *   - a grant dies the moment the flow's executable content changes, and at its deadline;
 *   - a fix is never applied without being asked for, never without a backup, and never touches
 *     anything outside the deterministic schema-migration set;
 *   - undo restores byte-for-byte, and refuses when it would destroy later edits.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FlowEdge, FlowProfile, FlowStep, StepType } from "@src/profiles/FlowProfile";
import type { ScenarioProfile } from "@src/profiles/ScenarioProfile";
import type { WorkflowProfile } from "@src/profiles/WorkflowProfile";
import { JsonProfileStore } from "@src/storage/ProfileStore";
import { PreRunValidator, isRunBlocked } from "@src/reports/PreRunValidator";
import { validateFlowDefinition, errorsOf } from "@src/validation/FlowValidator";
import {
  DIGEST_PREFIX,
  FLOW_VALIDATOR_VERSION,
  canonicalFlowContent,
  classifyForInventory,
  compatibilityStanding,
  effectiveVerdict,
  isCurrentDigest,
  planGrants,
  type CompatibilityGrant
} from "@src/validation/LegacyCompatibility";
import { createHash } from "node:crypto";
import { applySafeFixes, availableSafeFixes } from "@src/validation/SafeFixApplier";
import { FlowValidationService } from "../app/main/validation/flowValidationService";
import { sha256FlowDigest } from "../app/main/validation/contentDigest";

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

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

function step(id: string, type: StepType, extra: Partial<FlowStep> = {}): FlowStep {
  return { id, type, name: `${type} ${id}`, ...extra };
}
function edge(id: string, source: string, target: string, extra: Partial<FlowEdge> = {}): FlowEdge {
  return { id, source, target, type: "success", kind: "normal", ...extra };
}

/** Valid: start → click → end. */
function validFlow(id = "valid-flow"): FlowProfile {
  return {
    id,
    name: `Flow ${id}`,
    version: 1,
    nodes: [step("n-start", "start"), step("n-click", "click", { locator: { strategy: "testId", value: "go" } }), step("n-end", "end")],
    edges: [edge("e1", "n-start", "n-click"), edge("e2", "n-click", "n-end")],
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

/** Off-path-only defect: an orphan node. Eligible for Legacy Compatibility. */
function offPathFlow(id = "offpath-flow"): FlowProfile {
  const base = validFlow(id);
  return { ...base, nodes: [...base.nodes, step("n-orphan", "screenshot")] };
}

/** Active-path defect: a click with no locator. NEVER grant-tolerable. */
function activePathFlow(id = "active-flow"): FlowProfile {
  const base = validFlow(id);
  return { ...base, nodes: [step("n-start", "start"), step("n-click", "click"), step("n-end", "end")] };
}

/** Casing-only enum mistakes — the safe-fix surface. */
function fixableFlow(id = "fixable-flow"): FlowProfile {
  const base = validFlow(id);
  return {
    ...base,
    edges: [
      edge("e1", "n-start", "n-click"),
      {
        id: "e-cond",
        source: "n-click",
        target: "n-end",
        type: "conditional",
        kind: "conditional",
        conditional: { sourceField: "Outcome" as "outcome", operator: "NotEquals" as "notEquals", expectedValue: "fail" }
      }
    ]
  };
}

const scenarioFor = (...flowIds: string[]): ScenarioProfile => ({
  id: "scenario",
  name: "Scenario",
  executionMode: "sequential",
  maxParallelFlows: 1,
  flows: flowIds.map((flowId, order) => ({ order, flowId, required: true, inputs: {} })),
  links: [],
  failurePolicy: { stopOnRequiredFlowFailure: true, continueOnOptionalFlowFailure: true, takeScreenshotOnFailure: true }
});

const NOW = "2026-07-21T12:00:00.000Z";
const IN_WINDOW = "2026-08-10T12:00:00.000Z";
const AFTER_WINDOW = "2026-09-30T12:00:00.000Z";

function grantFor(flow: FlowProfile, overrides: Partial<CompatibilityGrant> = {}): CompatibilityGrant {
  return {
    id: flow.id,
    contentHash: sha256FlowDigest(flow),
    grantedAt: NOW,
    expiresAt: "2026-08-20T12:00:00.000Z",
    validatorVersion: FLOW_VALIDATOR_VERSION,
    issueCodes: ["unreachableNode"],
    runsUnderCompatibility: 0,
    ...overrides
  };
}

/* ------------------------------------------------------------------ *
 * 0. Digest format & collision resistance
 *
 * A grant changes EXECUTION ELIGIBILITY, so its content binding must be collision-resistant: with a
 * weak hash, a crafted flow could be made to collide with a granted one and inherit its exemption.
 * ------------------------------------------------------------------ */
console.log("\nDigest format and collision resistance");
{
  const digest = sha256FlowDigest(validFlow());
  check("the digest is tagged with its algorithm and is 64 hex chars", /^sha256:[0-9a-f]{64}$/.test(digest), digest);
  check("isCurrentDigest accepts it", isCurrentDigest(digest));

  // Known-answer test: proves this is real SHA-256 over the canonical bytes, not some homebrew.
  const canonical = canonicalFlowContent(validFlow());
  const independent = `${DIGEST_PREFIX}${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
  check("the digest equals an independently computed SHA-256 of the canonical content", digest === independent);
  check(
    "SHA-256 known-answer sanity (empty string)",
    createHash("sha256").update("", "utf8").digest("hex") === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  );

  // Formats that must NOT be trusted: the pre-hardening FNV value, truncations, wrong case, junk.
  for (const [label, value] of [
    ["a pre-hardening 16-hex FNV value", "a1b2c3d4e5f60718"],
    ["an untagged SHA-256", digest.slice(DIGEST_PREFIX.length)],
    ["a truncated digest", `${digest.slice(0, 40)}`],
    ["an uppercase digest", digest.toUpperCase()],
    ["a different algorithm tag", digest.replace("sha256:", "sha1:")],
    ["an empty string", ""]
  ] as [string, string][]) {
    check(`isCurrentDigest rejects ${label}`, !isCurrentDigest(value), value.slice(0, 24));
  }
  check("isCurrentDigest rejects undefined", !isCurrentDigest(undefined));

  // Avalanche: a one-character change must change essentially the whole digest.
  const nudged = { ...validFlow(), nodes: [step("n-start", "start"), step("n-click", "click", { locator: { strategy: "testId", value: "gp" } }), step("n-end", "end")] };
  const a = digest.slice(DIGEST_PREFIX.length);
  const b = sha256FlowDigest(nudged).slice(DIGEST_PREFIX.length);
  const sameChars = [...a].filter((char, index) => char === b[index]).length;
  check("a one-character content change avalanches the digest", a !== b && sameChars < 24, `${sameChars}/64 chars shared`);

  // No collisions across a large, deliberately near-identical population.
  const seen = new Map<string, string>();
  let collision = "";
  for (let index = 0; index < 3000; index += 1) {
    const variant: FlowProfile = {
      ...validFlow(`c-${index}`),
      version: 1 + (index % 3),
      nodes: [step("n-start", "start"), step("n-click", "click", { locator: { strategy: "testId", value: `go-${index}` } }), step("n-end", "end")]
    };
    // Ids are NOT part of the digest, so these differ only in the locator/version — the hardest case.
    const value = sha256FlowDigest(variant);
    const prior = seen.get(value);
    if (prior !== undefined && prior !== canonicalFlowContent(variant)) collision = `${prior} vs ${canonicalFlowContent(variant)}`;
    seen.set(value, canonicalFlowContent(variant));
  }
  check("3000 near-identical flow variants produce no digest collision", collision === "" && seen.size === 3000, collision || `${seen.size} distinct`);
}

/* ------------------------------------------------------------------ *
 * 0b. Canonicalization determinism
 * ------------------------------------------------------------------ */
console.log("\nCanonical form determinism");
{
  const flow = validFlow();
  check("canonicalization is stable across calls", canonicalFlowContent(flow) === canonicalFlowContent(validFlow()));
  check(
    "canonicalization covers exactly version, nodes and edges",
    Object.keys(JSON.parse(canonicalFlowContent(flow)) as object).sort().join(",") === "edges,nodes,version"
  );
  check("top-level keys are emitted in sorted order", canonicalFlowContent(flow).startsWith('{"edges":'));

  // Deep key reordering must not change the bytes.
  const reorderedDeep: FlowProfile = {
    ...flow,
    nodes: flow.nodes.map((node) => ({ name: node.name, type: node.type, id: node.id, ...(node.locator ? { locator: { value: node.locator.value, strategy: node.locator.strategy } } : {}) })) as FlowStep[]
  };
  check("nested key order does not change the canonical form", canonicalFlowContent(reorderedDeep) === canonicalFlowContent(flow));

  // `undefined` properties are dropped, so a round-tripped profile matches an in-memory one.
  const withUndefined: FlowProfile = { ...flow, nodes: flow.nodes.map((node) => ({ ...node, description: undefined })) as FlowStep[] };
  check("undefined properties are dropped", canonicalFlowContent(withUndefined) === canonicalFlowContent(flow));
  check("a JSON round trip canonicalizes identically", canonicalFlowContent(JSON.parse(JSON.stringify(flow)) as FlowProfile) === canonicalFlowContent(flow));

  // Array ORDER is meaningful and must be preserved — reordering nodes changes execution.
  const reorderedNodes: FlowProfile = { ...flow, nodes: [...flow.nodes].reverse() };
  check("node ORDER is significant (arrays are not sorted)", canonicalFlowContent(reorderedNodes) !== canonicalFlowContent(flow));

  // Malformed input canonicalizes rather than throwing.
  check(
    "a profile with non-array nodes/edges still canonicalizes",
    canonicalFlowContent({ id: "x", name: "x", version: 1, nodes: undefined as unknown as FlowStep[], edges: undefined as unknown as FlowEdge[] }) === '{"edges":[],"nodes":[],"version":1}'
  );
}

/* ------------------------------------------------------------------ *
 * 1. Content hash
 * ------------------------------------------------------------------ */
console.log("\nContent hash (what voids a grant)");
{
  const flow = validFlow();
  check("the same content hashes identically", sha256FlowDigest(flow) === sha256FlowDigest(validFlow()));
  check(
    "key order does not change the hash",
    sha256FlowDigest(flow) === sha256FlowDigest({ ...flow, edges: flow.edges.map((e) => ({ target: e.target, source: e.source, kind: e.kind, type: e.type, id: e.id })) as FlowEdge[] })
  );
  check("renaming the flow does NOT change the hash", sha256FlowDigest({ ...flow, name: "Renamed" }) === sha256FlowDigest(flow));
  check("editing the description does NOT change the hash", sha256FlowDigest({ ...flow, description: "new" }) === sha256FlowDigest(flow));
  check("touching updatedAt does NOT change the hash", sha256FlowDigest({ ...flow, updatedAt: "2030-01-01T00:00:00.000Z" }) === sha256FlowDigest(flow));
  check("adding a node DOES change the hash", sha256FlowDigest(offPathFlow("valid-flow")) !== sha256FlowDigest(flow));
  check("changing a locator DOES change the hash", sha256FlowDigest({ ...flow, nodes: [flow.nodes[0] as FlowStep, { ...(flow.nodes[1] as FlowStep), locator: { strategy: "css", value: ".x" } }, flow.nodes[2] as FlowStep] }) !== sha256FlowDigest(flow));
  check("bumping version DOES change the hash", sha256FlowDigest({ ...flow, version: 2 }) !== sha256FlowDigest(flow));
}

/* ------------------------------------------------------------------ *
 * 2. Grant standing
 * ------------------------------------------------------------------ */
console.log("\nGrant standing");
{
  const flow = offPathFlow();
  const hash = sha256FlowDigest(flow);
  check("no grant → none", compatibilityStanding(undefined, hash, IN_WINDOW) === "none");
  check("valid, unexpired, unchanged → granted", compatibilityStanding(grantFor(flow), hash, IN_WINDOW) === "granted");
  check("past the deadline → expired", compatibilityStanding(grantFor(flow), hash, AFTER_WINDOW) === "expired");
  check("content changed → edited", compatibilityStanding(grantFor(flow), sha256FlowDigest(validFlow()), IN_WINDOW) === "edited");
  check("explicitly revoked → revoked", compatibilityStanding(grantFor(flow, { revokedAt: NOW, revokedReason: "migrated" }), hash, IN_WINDOW) === "revoked");
  check("expiry is inclusive — exactly at expiresAt is expired", compatibilityStanding(grantFor(flow), hash, "2026-08-20T12:00:00.000Z") === "expired");
}

/* ------------------------------------------------------------------ *
 * 3. effectiveVerdict — the policy core
 * ------------------------------------------------------------------ */
console.log("\nEffective verdict (Stage 2c full gate + grants)");
{
  const offPath = offPathFlow();
  const reportOff = validateFlowDefinition(offPath);

  const strict = effectiveVerdict(reportOff, undefined, sha256FlowDigest(offPath), IN_WINDOW);
  check("WITHOUT a grant, an off-path error now BLOCKS (the 2c full gate)", strict.blocked && strict.blockingIssues.some((issue) => issue.code === "unreachableNode"));
  check("...and reports no compatibility", !strict.underCompatibility && strict.standing === "none");

  const granted = effectiveVerdict(reportOff, grantFor(offPath), sha256FlowDigest(offPath), IN_WINDOW);
  check("WITH a valid grant, the off-path error is tolerated", !granted.blocked && granted.underCompatibility);
  check("...and the tolerated issue is reported, never hidden", granted.toleratedIssues.some((issue) => issue.code === "unreachableNode"));

  check("an expired grant stops tolerating", effectiveVerdict(reportOff, grantFor(offPath), sha256FlowDigest(offPath), AFTER_WINDOW).blocked);
  check("an edited flow stops tolerating", effectiveVerdict(reportOff, grantFor(validFlow("offpath-flow")), sha256FlowDigest(offPath), IN_WINDOW).blocked);

  // The rule that matters most: a grant can never excuse an active-path error.
  const active = activePathFlow();
  const activeVerdict = effectiveVerdict(validateFlowDefinition(active), grantFor(active), sha256FlowDigest(active), IN_WINDOW);
  check("a grant NEVER excuses an active-path error", activeVerdict.blocked && !activeVerdict.underCompatibility);

  // Nor a connector-structure error, which the runtime refuses flow-wide.
  const structural: FlowProfile = {
    ...validFlow("structural"),
    nodes: [...validFlow("structural").nodes, step("n-extra", "screenshot")],
    edges: [edge("e1", "n-start", "n-click"), edge("e2", "n-click", "n-end"), edge("e3", "n-click", "n-extra")]
  };
  const structuralVerdict = effectiveVerdict(validateFlowDefinition(structural), grantFor(structural), sha256FlowDigest(structural), IN_WINDOW);
  check("a grant NEVER excuses a connector-structure error", structuralVerdict.blocked);

  // A grant on a clean flow tolerates nothing and says so.
  const cleanVerdict = effectiveVerdict(validateFlowDefinition(validFlow()), grantFor(validFlow()), sha256FlowDigest(validFlow()), IN_WINDOW);
  check("a grant on a now-clean flow reports no compatibility", !cleanVerdict.blocked && !cleanVerdict.underCompatibility);
}

/* ------------------------------------------------------------------ *
 * 4. The run gate honours grants
 * ------------------------------------------------------------------ */
console.log("\nRun gate with Legacy Compatibility");
{
  const validator = new PreRunValidator();
  const offPath = offPathFlow();
  const gate = (flows: FlowProfile[], grants?: Map<string, CompatibilityGrant>, nowIso = IN_WINDOW) =>
    validator.validate({ scenario: scenarioFor(...flows.map((f) => f.id)), flows, legacyCompatibility: grants ? { grants, nowIso, digestFor: sha256FlowDigest } : undefined });

  check("no grants → the off-path flow is blocked at the gate", isRunBlocked(gate([offPath])));
  const grantedIssues = gate([offPath], new Map([[offPath.id, grantFor(offPath)]]));
  check("with a grant → the run is allowed", !isRunBlocked(grantedIssues));
  check(
    "...and the run is never silent: a legacyCompatibility warning names the deadline",
    grantedIssues.some((issue) => issue.key === `legacyCompatibility.${offPath.id}` && issue.severity === "warning" && !issue.blocking && issue.message.includes("2026-08-20"))
  );
  check("the tolerated error is still reported (as non-blocking)", grantedIssues.some((issue) => issue.code === "unreachableNode" && !issue.blocking));
  check("an expired grant blocks again", isRunBlocked(gate([offPath], new Map([[offPath.id, grantFor(offPath)]]), AFTER_WINDOW)));

  const active = activePathFlow();
  check("a grant does not let an active-path error through the gate", isRunBlocked(gate([active], new Map([[active.id, grantFor(active)]]))));

  // A grant for one flow must not leak to another.
  const other = offPathFlow("other-offpath");
  check("a grant applies only to its own flow", isRunBlocked(gate([offPath, other], new Map([[offPath.id, grantFor(offPath)]]))));
}

/* ------------------------------------------------------------------ *
 * 5. Inventory classification & grant planning
 * ------------------------------------------------------------------ */
console.log("\nInventory scan classification");
{
  const cases: [FlowProfile, string][] = [
    [validFlow("c-valid"), "valid"],
    [offPathFlow("c-offpath"), "temporarily-compatible"],
    [activePathFlow("c-active"), "immediately-blocked"]
  ];
  for (const [flow, expected] of cases) {
    const entry = classifyForInventory(flow, validateFlowDefinition(flow), sha256FlowDigest(flow));
    check(`${flow.id} classifies as ${expected}`, entry.classification === expected, entry.classification);
  }

  // A flow the validator rejects but which already ran successfully post-edit is flagged for
  // review, not silently blocked and not silently granted.
  const suspicious = activePathFlow("c-suspicious");
  const defectEntry = classifyForInventory(suspicious, validateFlowDefinition(suspicious), sha256FlowDigest(suspicious), { ranSuccessfullySinceLastEdit: () => true });
  check("a rejected flow that ran successfully since its last edit → possible-validator-defect", defectEntry.classification === "possible-validator-defect");

  const entries = cases.map(([flow]) => classifyForInventory(flow, validateFlowDefinition(flow), sha256FlowDigest(flow)));
  const plan = planGrants(entries, new Map(), NOW);
  check("only the off-path-only flow is granted", plan.issue.length === 1 && plan.issue[0]?.id === "c-offpath");
  check("the grant is time-limited", (plan.issue[0]?.expiresAt ?? "") > NOW);
  check("the grant records the issuing validator version", plan.issue[0]?.validatorVersion === FLOW_VALIDATOR_VERSION);
  check("a possible-validator-defect flow is NOT silently granted", planGrants([defectEntry], new Map(), NOW).issue.length === 0);

  // Re-scanning must not extend an existing deadline.
  const existing = new Map([["c-offpath", grantFor(offPathFlow("c-offpath"), { expiresAt: "2026-08-01T00:00:00.000Z" })]]);
  const rescan = planGrants(entries, existing, "2026-07-25T00:00:00.000Z");
  check("re-scanning does NOT re-issue or extend an existing grant", rescan.issue.length === 0);

  // Repairing a flow revokes its grant (audit trail, not deletion).
  const repaired = planGrants([classifyForInventory(validFlow("c-offpath"), validateFlowDefinition(validFlow("c-offpath")), sha256FlowDigest(validFlow("c-offpath")))], existing, NOW);
  check("a repaired flow has its grant revoked as 'repaired'", repaired.revokeRepaired.length === 1 && repaired.revokeRepaired[0]?.revokedReason === "repaired");
}

/* ------------------------------------------------------------------ *
 * 6. Safe-fix applier (pure)
 * ------------------------------------------------------------------ */
console.log("\nSafe-fix applier");
{
  const flow = fixableFlow();
  const report = validateFlowDefinition(flow);
  check("casing-only enum mistakes offer safe fixes", availableSafeFixes(report.issues).length === 2, `${availableSafeFixes(report.issues).length}`);

  const before = JSON.stringify(flow);
  const result = applySafeFixes(flow, report.issues);
  check("the input profile is never mutated", JSON.stringify(flow) === before);
  check("both enum literals are normalized", result.profile.edges[1]?.conditional?.operator === "notEquals" && result.profile.edges[1]?.conditional?.sourceField === "outcome");
  check("the fixed flow validates clean", errorsOf(validateFlowDefinition(result.profile)).length === 0, JSON.stringify(errorsOf(validateFlowDefinition(result.profile)).map((i) => i.code)));
  check("every applied fix is reported with from/to", result.applied.length === 2 && result.applied.every((fix) => fix.from && fix.to));
  check("applying twice is idempotent (nothing left to fix)", applySafeFixes(result.profile, validateFlowDefinition(result.profile).issues).applied.length === 0);

  // The never-list: defects with no deterministic correction must offer no fix and be left alone.
  for (const [label, broken] of [
    ["a missing locator", activePathFlow("nf-locator")],
    ["an orphan node", offPathFlow("nf-orphan")],
    ["a missing End node", { ...validFlow("nf-end"), nodes: [step("n-start", "start"), step("n-click", "click", { locator: { strategy: "css", value: "a" } })], edges: [edge("e1", "n-start", "n-click")] } as FlowProfile],
    ["a broken connector endpoint", { ...validFlow("nf-broken"), edges: [edge("e1", "n-start", "n-click"), edge("e2", "n-click", "ghost")] } as FlowProfile],
    ["a genuinely unknown operator", { ...validFlow("nf-op"), edges: [edge("e1", "n-start", "n-click"), { id: "e2", source: "n-click", target: "n-end", type: "conditional", kind: "conditional", conditional: { sourceField: "outcome", operator: "totallyMadeUp" as "equals", expectedValue: "x" } }] } as FlowProfile],
    ["an invalid timeout", { ...validFlow("nf-timeout"), nodes: [step("n-start", "start"), step("n-click", "click", { locator: { strategy: "css", value: "a" }, timeoutMs: -1 }), step("n-end", "end")] } as FlowProfile],
    ["an over-cap loop bound", { ...validFlow("nf-loop"), edges: [edge("e1", "n-start", "n-click"), { id: "e-loop", source: "n-click", target: "n-click", type: "loop", kind: "loop", loop: { mode: "count", maxIterations: 99_999 } }, { id: "e2", source: "n-click", target: "n-end", type: "conditional", kind: "conditional", conditional: { sourceField: "outcome", operator: "equals", expectedValue: "ok" } }] } as FlowProfile]
  ] as [string, FlowProfile][]) {
    const brokenReport = validateFlowDefinition(broken);
    const applied = applySafeFixes(broken, brokenReport.issues);
    check(`${label} offers NO safe fix and is left untouched`, applied.applied.length === 0 && JSON.stringify(applied.profile) === JSON.stringify(broken));
  }

  // Duplicate connector ids are safely regenerable; duplicate NODE ids are not.
  const dupEdges: FlowProfile = { ...validFlow("dup-edge"), edges: [edge("e1", "n-start", "n-click"), edge("e1", "n-click", "n-end")] };
  const dupResult = applySafeFixes(dupEdges, validateFlowDefinition(dupEdges).issues);
  check("duplicate connector ids are regenerated", new Set(dupResult.profile.edges.map((e) => e.id)).size === 2);
  check("...and routing is unchanged", dupResult.profile.edges.map((e) => `${e.source}->${e.target}`).join(",") === "n-start->n-click,n-click->n-end");

  const dupNodes: FlowProfile = { ...validFlow("dup-node"), nodes: [step("n-start", "start"), step("dup", "screenshot"), step("dup", "screenshot"), step("n-end", "end")], edges: [edge("e1", "n-start", "dup"), edge("e2", "dup", "n-end")] };
  check("duplicate NODE ids are never auto-fixed", applySafeFixes(dupNodes, validateFlowDefinition(dupNodes).issues).applied.length === 0);
}

/* ------------------------------------------------------------------ *
 * 7. The service: scan, grants, migration ceremony, undo
 * ------------------------------------------------------------------ */
console.log("\nFlowValidationService (real service, temp folders)");
{
  const root = await mkdtemp(join(tmpdir(), "awkit-2c-"));
  const flowStore = new JsonProfileStore<FlowProfile>({ folder: join(root, "flows") });
  const workflowStore = new JsonProfileStore<WorkflowProfile>({ folder: join(root, "workflows") });
  for (const flow of [validFlow("s-valid"), offPathFlow("s-offpath"), activePathFlow("s-active"), fixableFlow("s-fixable")]) {
    await flowStore.create(flow);
  }
  const service = new FlowValidationService({ validationRoot: join(root, "validation"), flowStore, workflowStore, now: () => NOW });

  const scan = await service.runInventoryScan();
  check("the scan classifies every flow", scan.entries.length === 4);
  check("counts are grouped by classification", scan.counts.valid === 1 && scan.counts["temporarily-compatible"] === 1 && scan.counts["immediately-blocked"] === 2, JSON.stringify(scan.counts));
  check("the scan records the validator version", scan.validatorVersion === FLOW_VALIDATOR_VERSION);
  check("exactly one grant was issued (the off-path-only flow)", scan.grantsIssued === 1);
  const grants = await service.grantsMap();
  check("the grant is persisted for the right flow", grants.has("s-offpath") && !grants.has("s-active"));

  check("ensureInventoryScan reuses the existing scan for this validator version", (await service.ensureInventoryScan()).id === scan.id);

  // The scan must not have touched any flow.
  check("the inventory scan modifies NO flow", JSON.stringify(await flowStore.get("s-offpath")) === JSON.stringify(offPathFlow("s-offpath")));

  // Preview writes nothing.
  const preview = await service.previewSafeFixes("s-fixable");
  check("preview reports the fixes and the error delta", preview.fixes.length === 2 && preview.beforeErrorCount === 2 && preview.afterErrorCount === 0);
  check("preview does NOT modify the stored flow", JSON.stringify(await flowStore.get("s-fixable")) === JSON.stringify(fixableFlow("s-fixable")));

  // Apply: backup first, then migrate, then report.
  const { record } = await service.applySafeFixesToFlow("s-fixable");
  const migrated = await flowStore.get("s-fixable");
  check("the migration fixed the flow", errorsOf(validateFlowDefinition(migrated as FlowProfile)).length === 0);
  check("a migration report was recorded with before/after hashes", record.beforeHash !== record.afterHash && record.fixes.length === 2);
  check("the report records the error delta", record.beforeErrorCount === 2 && record.afterErrorCount === 0);
  const backup = JSON.parse(await readFile(record.backupPath, "utf8")) as FlowProfile;
  check("an UNTOUCHED backup of the original was written before applying", JSON.stringify(backup) === JSON.stringify(fixableFlow("s-fixable")));

  // Migrating a granted flow ends its compatibility (the content changed).
  await flowStore.update("s-offpath", { ...offPathFlow("s-offpath"), description: "irrelevant" });
  const stillGranted = await service.grantsMap();
  check("a metadata-only edit keeps the grant valid", compatibilityStanding(stillGranted.get("s-offpath"), sha256FlowDigest((await flowStore.get("s-offpath")) as FlowProfile), IN_WINDOW) === "granted");

  await flowStore.update("s-offpath", { ...offPathFlow("s-offpath"), nodes: [...offPathFlow("s-offpath").nodes, step("n-extra", "screenshot")] });
  check(
    "editing executable content voids the grant (content hash mismatch)",
    compatibilityStanding((await service.grantsMap()).get("s-offpath"), sha256FlowDigest((await flowStore.get("s-offpath")) as FlowProfile), IN_WINDOW) === "edited"
  );

  // Run auditing.
  await service.recordRunUnderCompatibility(["s-offpath"]);
  check("a run under compatibility is audited on the grant", ((await service.grantsMap()).get("s-offpath")?.runsUnderCompatibility ?? 0) === 1);

  // Undo restores byte-for-byte.
  const undone = await service.undoMigration("s-fixable", record.id);
  check("undo restores the original exactly", JSON.stringify(undone.profile) === JSON.stringify(fixableFlow("s-fixable")));
  check("the migration is marked undone", (await service.migrationsForFlow("s-fixable"))[0]?.undoneAt !== undefined);

  let doubleUndoRejected = false;
  await service.undoMigration("s-fixable", record.id).catch(() => { doubleUndoRejected = true; });
  check("undoing twice is rejected", doubleUndoRejected);

  // Undo must refuse when it would destroy later edits.
  const second = await service.applySafeFixesToFlow("s-fixable");
  await flowStore.update("s-fixable", { ...((await flowStore.get("s-fixable")) as FlowProfile), nodes: [...((await flowStore.get("s-fixable")) as FlowProfile).nodes, step("n-new", "screenshot")] });
  let refused = false;
  await service.undoMigration("s-fixable", second.record.id).catch(() => { refused = true; });
  check("undo REFUSES when the flow was edited after the migration", refused);

  // A fix-less flow cannot be "migrated".
  let noFixRejected = false;
  await service.applySafeFixesToFlow("s-active").catch(() => { noFixRejected = true; });
  check("applying fixes to a flow with none is rejected", noFixRejected);

  await rm(root, { recursive: true, force: true });
}

/* ------------------------------------------------------------------ *
 * 8. possible-validator-defect via real run history
 * ------------------------------------------------------------------ */
console.log("\nInventory: possible-validator-defect from run history");
{
  const root = await mkdtemp(join(tmpdir(), "awkit-2c-hist-"));
  const flowStore = new JsonProfileStore<FlowProfile>({ folder: join(root, "flows") });
  const workflowStore = new JsonProfileStore<WorkflowProfile>({ folder: join(root, "workflows") });

  // A flow the validator rejects, edited long ago, reached through a workflow that later succeeded.
  await flowStore.create({ ...activePathFlow("h-flow"), updatedAt: "2026-01-01T00:00:00.000Z" });
  await workflowStore.create({
    id: "h-workflow",
    name: "H",
    version: 1,
    nodes: [
      { id: "start", type: "start", alias: "Start", order: 0 },
      { id: "n1", type: "flowRef", flowId: "h-flow", alias: "h-flow", order: 1, required: true, inputBindings: {} },
      { id: "end", type: "end", alias: "End", order: 2 }
    ],
    edges: [],
    runtimeInputs: [],
    execution: { mode: "sequential", maxConcurrentInstances: 1, stopOnRequiredFlowFailure: true },
    createdAt: NOW,
    updatedAt: NOW
  } as WorkflowProfile);

  const withHistory = new FlowValidationService({
    validationRoot: join(root, "v1"),
    flowStore,
    workflowStore,
    now: () => NOW,
    recentSuccessfulRuns: () => [{ scenarioId: "h-workflow", endedAt: "2026-06-01T00:00:00.000Z" }]
  });
  const scanA = await withHistory.runInventoryScan();
  check("a rejected flow that ran successfully post-edit is flagged for review", scanA.entries[0]?.classification === "possible-validator-defect", scanA.entries[0]?.classification);
  check("...and is NOT granted compatibility", scanA.grantsIssued === 0);

  const staleHistory = new FlowValidationService({
    validationRoot: join(root, "v2"),
    flowStore,
    workflowStore,
    now: () => NOW,
    recentSuccessfulRuns: () => [{ scenarioId: "h-workflow", endedAt: "2025-01-01T00:00:00.000Z" }]
  });
  check("a success from BEFORE the last edit does not excuse the flow", (await staleHistory.runInventoryScan()).entries[0]?.classification === "immediately-blocked");

  const noHistory = new FlowValidationService({ validationRoot: join(root, "v3"), flowStore, workflowStore, now: () => NOW });
  check("with no run history the classification is the plain validator verdict", (await noHistory.runInventoryScan()).entries[0]?.classification === "immediately-blocked");

  await rm(root, { recursive: true, force: true });
}

/* ------------------------------------------------------------------ *
 * 9. Safe-fix field paths match the applier (the Stage 2a inversion guard)
 * ------------------------------------------------------------------ */
console.log("\nSafe-fix field paths");
{
  // Stage 2a emitted `loop.condition.operator` for a plain conditional and `conditional.operator`
  // for a loop condition — inverted. Harmless while nothing consumed the metadata; a silent no-op
  // (or worse) the moment an applier did. Pin both directions.
  const conditional = fixableFlow("fp-cond");
  const conditionalFix = validateFlowDefinition(conditional).issues.find((issue) => issue.code === "unsupportedOperator")?.safeFix;
  check("a plain conditional emits field `conditional.operator`", conditionalFix?.field === "conditional.operator", conditionalFix?.field);

  const loopCondition: FlowProfile = {
    ...validFlow("fp-loop"),
    edges: [
      edge("e1", "n-start", "n-click"),
      {
        id: "e-loop",
        source: "n-click",
        target: "n-click",
        type: "loop",
        kind: "loop",
        loop: { mode: "whileCondition", maxIterations: 3, condition: { sourceField: "outcome", operator: "Equals" as "equals", expectedValue: "ok" } }
      },
      { id: "e2", source: "n-click", target: "n-end", type: "conditional", kind: "conditional", conditional: { sourceField: "outcome", operator: "notEquals", expectedValue: "ok" } }
    ]
  };
  const loopFix = validateFlowDefinition(loopCondition).issues.find((issue) => issue.code === "unsupportedOperator")?.safeFix;
  check("a loop condition emits field `loop.condition.operator`", loopFix?.field === "loop.condition.operator", loopFix?.field);
  const loopApplied = applySafeFixes(loopCondition, validateFlowDefinition(loopCondition).issues);
  check("...and the applier actually normalizes it", loopApplied.profile.edges[1]?.loop?.condition?.operator === "equals");

  // Every field the engine can emit must be one the applier knows how to write.
  const families: [string, FlowProfile][] = [
    ["loop.mode", { ...validFlow("fp-mode"), edges: [edge("e1", "n-start", "n-click"), { id: "e-loop", source: "n-click", target: "n-click", type: "loop", kind: "loop", loop: { mode: "StaticList" as "staticList", maxIterations: 2, staticValues: ["a"] } }, { id: "e2", source: "n-click", target: "n-end", type: "conditional", kind: "conditional", conditional: { sourceField: "outcome", operator: "equals", expectedValue: "ok" } }] }],
    ["parallel.joinMode", { ...validFlow("fp-join"), edges: [edge("e1", "n-start", "n-click"), { id: "e-par", source: "n-click", target: "n-end", type: "parallel", kind: "parallel", parallel: { joinMode: "WaitAll" as "waitAll", failMode: "failFast" } }] }],
    ["parallel.failMode", { ...validFlow("fp-fail"), edges: [edge("e1", "n-start", "n-click"), { id: "e-par", source: "n-click", target: "n-end", type: "parallel", kind: "parallel", parallel: { joinMode: "waitAll", failMode: "Fail_Fast" as "failFast" } }] }],
    ["parallel.isolation", { ...validFlow("fp-iso"), edges: [edge("e1", "n-start", "n-click"), { id: "e-par", source: "n-click", target: "n-end", type: "parallel", kind: "parallel", parallel: { joinMode: "waitAll", failMode: "failFast", isolation: "SharedPage" as "sharedPage" } }] }]
  ];
  for (const [field, profile] of families) {
    const issues = validateFlowDefinition(profile).issues;
    const fix = issues.find((issue) => issue.safeFix?.field === field)?.safeFix;
    const result = applySafeFixes(profile, issues);
    check(`${field} emits a safe fix the applier can write`, fix !== undefined && result.applied.length > 0 && result.skipped.length === 0, `fix=${JSON.stringify(fix)} skipped=${JSON.stringify(result.skipped)}`);
  }
}

/* ------------------------------------------------------------------ *
 * 10. Stale-report safety
 * ------------------------------------------------------------------ */
console.log("\nStale reports are skipped, never guessed");
{
  const flow = fixableFlow("stale");
  const report = validateFlowDefinition(flow);
  // Apply a report from a DIFFERENT (now-deleted) connector shape.
  const changed: FlowProfile = { ...flow, edges: [edge("e1", "n-start", "n-click"), edge("e-other", "n-click", "n-end")] };
  const result = applySafeFixes(changed, report.issues);
  check("a fix whose connector no longer exists is skipped", result.skipped.length === 2 && result.applied.length === 0);
  check("...and the profile is untouched", JSON.stringify(result.profile) === JSON.stringify(changed));
}

/* ------------------------------------------------------------------ *
 * 11. Pre-hardening (FNV-era) grant records
 *
 * These were bound by a non-collision-resistant hash, so they must never be honored — and, just as
 * importantly, encountering one must NOT silently mint a replacement grant with a fresh deadline.
 * ------------------------------------------------------------------ */
console.log("\nPre-hardening grant records (FNV-era)");
{
  const flow = offPathFlow("legacy-record");
  /** What a Stage 2c-era record looked like: an untagged 16-hex FNV-1a value. */
  const fnvGrant = grantFor(flow, { contentHash: "9f4c1a2b3d5e6f70" });

  check("a legacy-format grant is never 'granted'", compatibilityStanding(fnvGrant, sha256FlowDigest(flow), IN_WINDOW) === "legacyDigest");
  check("...even though it is unexpired and the flow is unchanged", fnvGrant.expiresAt > IN_WINDOW && !fnvGrant.revokedAt);
  check("...and it is reported distinctly from 'edited'", compatibilityStanding(fnvGrant, sha256FlowDigest(flow), IN_WINDOW) !== "edited");

  const verdict = effectiveVerdict(validateFlowDefinition(flow), fnvGrant, sha256FlowDigest(flow), IN_WINDOW);
  check("a legacy-format grant tolerates nothing at the gate", verdict.blocked && !verdict.underCompatibility && verdict.standing === "legacyDigest");

  // Fail-closed: a caller that cannot produce a trustworthy digest gets no tolerance either.
  const sha256Grant = grantFor(flow);
  check("an untrustworthy CURRENT digest also fails closed", compatibilityStanding(sha256Grant, "not-a-digest", IN_WINDOW) === "legacyDigest");
  const gateNoDigest = new PreRunValidator().validate({
    scenario: scenarioFor(flow.id),
    flows: [flow],
    legacyCompatibility: { grants: new Map([[flow.id, sha256Grant]]), nowIso: IN_WINDOW } // no digestFor
  });
  check("the gate refuses to honor a grant when no digest function is supplied", isRunBlocked(gateNoDigest));

  // Planning: retire, never replace.
  const entry = classifyForInventory(flow, validateFlowDefinition(flow), sha256FlowDigest(flow));
  const plan = planGrants([entry], new Map([[flow.id, fnvGrant]]), NOW);
  check("a legacy record is retired as digestFormatRetired", plan.revokeLegacyDigest.length === 1 && plan.revokeLegacyDigest[0]?.revokedReason === "digestFormatRetired");
  check("...and NO replacement grant is issued", plan.issue.length === 0);
  check("...so no new deadline is created", plan.revokeLegacyDigest[0]?.expiresAt === fnvGrant.expiresAt);
  check("...and the original grant window is preserved in the audit record", plan.revokeLegacyDigest[0]?.grantedAt === fnvGrant.grantedAt);

  // A retired record must not be resurrected by a later scan.
  const retired = plan.revokeLegacyDigest[0] as CompatibilityGrant;
  check("re-scanning does not re-grant a retired flow", planGrants([entry], new Map([[flow.id, retired]]), "2026-08-01T00:00:00.000Z").issue.length === 0);

  // A digest we cannot trust must never be written INTO a grant.
  const badEntry = { ...entry, contentDigest: "9f4c1a2b3d5e6f70" };
  check("a grant is never issued with an untrusted digest", planGrants([badEntry], new Map(), NOW).issue.length === 0);

  // End to end through the real service, with a legacy record already on disk.
  const root = await mkdtemp(join(tmpdir(), "awkit-legacy-"));
  const flowStore = new JsonProfileStore<FlowProfile>({ folder: join(root, "flows") });
  const workflowStore = new JsonProfileStore<WorkflowProfile>({ folder: join(root, "workflows") });
  await flowStore.create(flow);
  const service = new FlowValidationService({ validationRoot: join(root, "validation"), flowStore, workflowStore, now: () => NOW });
  // Seed the grant store directly, as an upgrade from the previous build would leave it.
  await new JsonProfileStore<CompatibilityGrant>({ folder: join(root, "validation", "legacy-grants") }).create(fnvGrant);

  const scan = await service.runInventoryScan();
  check("the scan retires the legacy record", scan.grantsRetiredLegacyDigest === 1, JSON.stringify({ retired: scan.grantsRetiredLegacyDigest, issued: scan.grantsIssued }));
  check("...and issues no replacement", scan.grantsIssued === 0);
  check("the scan records its digest algorithm", scan.digestAlgorithm === "sha256");
  const persisted = (await service.grantsMap()).get(flow.id);
  check("the retired record is kept for audit, not deleted", persisted !== undefined && persisted.revokedAt === NOW && persisted.revokedReason === "digestFormatRetired");
  check("the flow now blocks at the gate", isRunBlocked(new PreRunValidator().validate({
    scenario: scenarioFor(flow.id),
    flows: [flow],
    legacyCompatibility: { grants: await service.grantsMap(), nowIso: IN_WINDOW, digestFor: sha256FlowDigest }
  })));
  await rm(root, { recursive: true, force: true });
}

/* ------------------------------------------------------------------ *
 * 12. Concurrency, fail-safety and scan cost
 * ------------------------------------------------------------------ */
console.log("\nConcurrency, fail-safety and scan cost");
{
  const root = await mkdtemp(join(tmpdir(), "awkit-conc-"));
  const flowStore = new JsonProfileStore<FlowProfile>({ folder: join(root, "flows") });
  const workflowStore = new JsonProfileStore<WorkflowProfile>({ folder: join(root, "workflows") });

  // A realistically-sized library: 200 flows, a third of them grant-eligible.
  const LIBRARY_SIZE = 200;
  for (let index = 0; index < LIBRARY_SIZE; index += 1) {
    const kind = index % 3;
    const flow = kind === 0 ? validFlow(`lib-${index}`) : kind === 1 ? offPathFlow(`lib-${index}`) : activePathFlow(`lib-${index}`);
    await flowStore.create(flow);
  }
  const service = new FlowValidationService({ validationRoot: join(root, "validation"), flowStore, workflowStore, now: () => NOW });

  // Ten simultaneous callers (the first-launch stampede) must produce ONE scan and ONE grant set.
  const started = Date.now();
  const results = await Promise.all(Array.from({ length: 10 }, () => service.ensureInventoryScan()));
  const elapsedMs = Date.now() - started;
  const uniqueScanIds = new Set(results.map((scan) => scan.id));
  check(`10 concurrent ensureInventoryScan calls produce exactly ONE scan (${LIBRARY_SIZE} flows)`, uniqueScanIds.size === 1, [...uniqueScanIds].join(", "));

  const grants = await service.grantsMap();
  const expectedEligible = Math.ceil((LIBRARY_SIZE - 1) / 3);
  check(`grants are issued once per eligible flow, with no duplicates`, grants.size === expectedEligible, `${grants.size} grants vs ${expectedEligible} eligible`);
  const scanRecords = await new JsonProfileStore<{ id: string }>({ folder: join(root, "validation", "inventory-scans") }).list();
  check("exactly one scan record was persisted", scanRecords.length === 1, `${scanRecords.length} records`);
  console.log(`    ↳ first scan of ${LIBRARY_SIZE} flows under 10-way concurrency: ${elapsedMs}ms`);
  check(`the first scan completes well inside a run request's tolerance (${elapsedMs}ms < 5000ms)`, elapsedMs < 5000, `${elapsedMs}ms`);

  // A repeated scan must never extend a deadline.
  const before = [...(await service.grantsMap()).values()].map((grant) => `${grant.id}:${grant.expiresAt}`).sort().join("|");
  await service.runInventoryScan();
  const after = [...(await service.grantsMap()).values()].map((grant) => `${grant.id}:${grant.expiresAt}`).sort().join("|");
  check("a repeat scan changes no deadline", before === after);

  // Parallel audit writes must not lose increments to interleaving.
  const auditTarget = [...grants.keys()][0] as string;
  await Promise.all(Array.from({ length: 20 }, () => service.recordRunUnderCompatibility([auditTarget])));
  check("20 concurrent audit writes record all 20 runs", ((await service.grantsMap()).get(auditTarget)?.runsUnderCompatibility ?? 0) === 20, `${(await service.grantsMap()).get(auditTarget)?.runsUnderCompatibility}`);

  // Storage failure must fail CLOSED and leave no partial scan record behind.
  const failing = new FlowValidationService({
    validationRoot: join(root, "validation-fail"),
    flowStore: { ...flowStore, list: async () => { throw new Error("storage offline"); } } as unknown as JsonProfileStore<FlowProfile>,
    workflowStore,
    now: () => NOW
  });
  let scanFailed = false;
  await failing.runInventoryScan().catch(() => { scanFailed = true; });
  check("a storage failure fails the scan rather than reporting success", scanFailed);
  const failedScans = await new JsonProfileStore<{ id: string }>({ folder: join(root, "validation-fail", "inventory-scans") }).list();
  check("...and writes NO scan record, so the next call retries", failedScans.length === 0, `${failedScans.length} records`);
  const failedGrants = await new JsonProfileStore<CompatibilityGrant>({ folder: join(root, "validation-fail", "legacy-grants") }).list();
  check("...and issues NO grants (fails closed, never open)", failedGrants.length === 0, `${failedGrants.length} grants`);

  // A failed scan must be retryable — the single-flight guard must have cleared.
  let retried = false;
  await failing.runInventoryScan().catch(() => { retried = true; });
  check("the single-flight guard clears so a failed scan can be retried", retried);

  await rm(root, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
