/**
 * L6 — reusable fragments and action templates: the blocking audit matrix, the two deterministic
 * operations, and the persistence round trip.
 * Run with: npx tsx scripts/verify-flow-fragments.mts
 *
 * Three things this suite is deliberately built to fail on, because each is a way a fragment suite
 * can look green while the product is broken:
 *
 *  1. **An unreachable rule.** Every `FragmentAuditCode` is asserted by CARDINALITY — the set of
 *     codes the suite actually observed must equal the declared set. A rule that can never fire, or
 *     a code deleted from the union without its case, fails here rather than passing silently as
 *     "no findings".
 *  2. **A rule that fires on everything.** Every blocking rule has a negative control: the same
 *     fragment without the defect must audit clean. A matrix that refused every fragment would pass
 *     the positive half of this suite completely.
 *  3. **A binding the walk cannot see.** An Oracle node's value source lives at
 *     `config.oracle.binds[0].valueSource`. Any implementation that enumerates known field names
 *     instead of walking by shape passes every other case here and fails that one.
 *
 * Persistence is exercised against the REAL `JsonProfileStore` on a real temp folder, not a fake,
 * because unknown-field preservation and "create never overwrites" are properties of that store.
 *
 * Pure: no browser, no Electron. It needs no AI model, provider or runtime — which is itself one of
 * the assertions below.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { JsonProfileStore } from "@src/storage/ProfileStore";
import {
  PROTECTED_LOGIN_STEP_TYPES,
  type FlowEdge,
  type FlowProfile,
  type FlowStep,
  type StepType
} from "@src/profiles/FlowProfile";
import {
  auditFragment,
  blockingFindings,
  collectValueSources,
  deriveFragmentInputs,
  isFragmentBlocked,
  requiredInputKeys,
  type FlowFragment,
  type FragmentAuditCode,
  type FragmentAuditFinding,
  type FragmentAuditSeverity
} from "@src/fragments/FlowFragment";
import { applyFragment, captureFragment } from "@src/fragments/fragmentOperations";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

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

/**
 * Every code this run actually produced, for the cardinality gate at the end. It records findings
 * from BOTH producers — `auditFragment` and `captureFragment` — because `boundaryEdgeDropped` is
 * only ever raised by capture, and a gate that watched the audit alone would report it unreachable.
 */
const observedCodes = new Set<FragmentAuditCode>();
/**
 * Every severity each code was ever seen carrying.
 *
 * Asserting only that a code APPEARS is not enough, and a surviving mutation proved it: moving
 * `resolvedSecretValue` out of the blocking set left every "is the code reported?" check green
 * while a fragment carrying a plaintext secret became applyable. Severity is the part that makes
 * the matrix fail closed, so it is asserted per code rather than per case.
 */
const observedSeverities = new Map<FragmentAuditCode, Set<FragmentAuditSeverity>>();
function record<T extends readonly FragmentAuditFinding[]>(findings: T): T {
  for (const entry of findings) {
    observedCodes.add(entry.code);
    const seen = observedSeverities.get(entry.code) ?? new Set<FragmentAuditSeverity>();
    seen.add(entry.severity);
    observedSeverities.set(entry.code, seen);
  }
  return findings;
}
function audit(candidate: unknown, context?: Parameters<typeof auditFragment>[1]): FragmentAuditFinding[] {
  return record(auditFragment(candidate, context));
}

const has = (findings: readonly FragmentAuditFinding[], code: FragmentAuditCode): boolean =>
  findings.some((entry) => entry.code === code);

/**
 * The declared matrix: every code and the severity it must carry. Restated here rather than
 * imported so that flipping a code's severity in the source is a DISAGREEMENT with this table,
 * not a silent redefinition of what the suite is checking.
 */
const EXPECTED_SEVERITY: Record<FragmentAuditCode, FragmentAuditSeverity> = {
  fragmentShapeInvalid: "blocking",
  fragmentEmpty: "blocking",
  duplicateNodeId: "blocking",
  duplicateEdgeId: "blocking",
  edgeEndpointMissing: "blocking",
  terminalStepIncluded: "blocking",
  protectedLoginStep: "blocking",
  resolvedSecretValue: "blocking",
  undeclaredInput: "blocking",
  duplicateInputKey: "blocking",
  recursiveFlowReference: "blocking",
  unresolvedFlowReference: "blocking",
  boundaryEdgeDropped: "advisory",
  unusedDeclaredInput: "advisory",
  environmentSpecificBinding: "advisory",
  dangerousMutationStep: "advisory"
};
const ALL_AUDIT_CODES = Object.keys(EXPECTED_SEVERITY) as FragmentAuditCode[];

/* ── fixtures ─────────────────────────────────────────────────────────────────────────────────── */

function step(id: string, type: StepType, extra: Partial<FlowStep> = {}): FlowStep {
  return { id, type, name: `${type} ${id}`, ...extra };
}

function edge(id: string, source: string, target: string): FlowEdge {
  return { id, source, target, type: "always" } as FlowEdge;
}

/** A fragment that must audit completely clean. Every negative control starts from this. */
function cleanFragment(overrides: Partial<FlowFragment> = {}): FlowFragment {
  const nodes = [step("a", "goto", { url: "https://example.test/" }), step("b", "click")];
  return {
    id: "frag-clean",
    name: "Open and click",
    kind: "fragment",
    version: 1,
    nodes,
    edges: [edge("e1", "a", "b")],
    inputs: deriveFragmentInputs(nodes),
    ...overrides
  };
}

/** A source flow with start/end, a captureable middle, and a step carrying an unknown future field. */
function sourceFlow(): FlowProfile {
  const middle = step("fill-1", "fill", {
    value: "widget",
    locator: { strategy: "label", value: "Search", resolution: "resolved", resolvedBy: "recorder" }
  }) as FlowStep & Record<string, unknown>;
  // A field this build does not know about, exactly as a newer app version would have written it.
  middle.futureUnknownField = { keep: "me" };

  return {
    id: "flow-src",
    name: "Source",
    version: 1,
    nodes: [step("start", "start"), middle, step("click-1", "click"), step("end", "end")],
    edges: [edge("e-s", "start", "fill-1"), edge("e-m", "fill-1", "click-1"), edge("e-e", "click-1", "end")]
  };
}

function destinationFlow(): FlowProfile {
  return {
    id: "flow-dest",
    name: "Destination",
    version: 1,
    nodes: [step("start", "start"), step("end", "end")],
    edges: [edge("d-e", "start", "end")]
  };
}

/* ── 1. Shape: an untrusted document fails closed ─────────────────────────────────────────────── */

console.log("\n1. Shape — anything that is not recognisably a fragment is refused, not thrown");
for (const [label, candidate] of [
  ["a non-object", 42],
  ["null", null],
  ["a missing id", { ...cleanFragment(), id: "" }],
  ["a missing name", { ...cleanFragment(), name: "  " }],
  ["an unknown kind", { ...cleanFragment(), kind: "macro" }],
  ["a non-numeric version", { ...cleanFragment(), version: "1" }],
  ["nodes that are not an array", { ...cleanFragment(), nodes: {} }],
  ["a node with no id", { ...cleanFragment(), nodes: [{ type: "click" }] }],
  ["an edge with no target", { ...cleanFragment(), edges: [{ id: "e", source: "a" }] }],
  ["a declared input with no key", { ...cleanFragment(), inputs: [{ label: "x" }] }]
] as const) {
  const findings = audit(candidate);
  check(`${label} is refused as a shape violation`, has(findings, "fragmentShapeInvalid") && isFragmentBlocked(findings));
}
check("a well-formed fragment is NOT refused as a shape violation", !has(audit(cleanFragment()), "fragmentShapeInvalid"));

/* ── 2. Structural integrity ──────────────────────────────────────────────────────────────────── */

console.log("\n2. Structure — graph integrity, terminals, and the clean negative control");
check("a clean fragment produces no blocking finding at all", !isFragmentBlocked(audit(cleanFragment())));
check("a clean fragment produces NO findings at all", audit(cleanFragment()).length === 0);

check("an empty fragment is refused", has(audit(cleanFragment({ nodes: [], edges: [], inputs: [] })), "fragmentEmpty"));

const dupNodes = [step("a", "click"), step("a", "hover")];
check(
  "two steps sharing an id are refused",
  has(audit(cleanFragment({ nodes: dupNodes, edges: [], inputs: [] })), "duplicateNodeId")
);

check(
  "two connectors sharing an id are refused",
  has(audit(cleanFragment({ edges: [edge("e1", "a", "b"), edge("e1", "b", "a")] })), "duplicateEdgeId")
);

const danglingSource = audit(cleanFragment({ edges: [edge("e1", "ghost", "b")] }));
const danglingTarget = audit(cleanFragment({ edges: [edge("e1", "a", "ghost")] }));
check("a connector starting outside the fragment is refused", has(danglingSource, "edgeEndpointMissing"));
check("a connector ending outside the fragment is refused", has(danglingTarget, "edgeEndpointMissing"));
check(
  "the dangling finding names which end is wrong",
  danglingSource.some((f) => f.code === "edgeEndpointMissing" && f.field === "source") &&
    danglingTarget.some((f) => f.code === "edgeEndpointMissing" && f.field === "target")
);

for (const terminal of ["start", "end"] as const) {
  const withTerminal = cleanFragment();
  withTerminal.nodes = [...withTerminal.nodes, step(terminal, terminal)];
  check(`a fragment containing the flow's ${terminal} step is refused`, has(audit(withTerminal), "terminalStepIncluded"));
}

/* ── 3. Protected login — by cardinality over the canonical set ───────────────────────────────── */

console.log("\n3. Protected login — every type in the canonical set, not just one example");
let protectedRefused = 0;
for (const type of PROTECTED_LOGIN_STEP_TYPES) {
  const fragment = cleanFragment({ nodes: [step("p", type)], edges: [], inputs: [] });
  if (has(audit(fragment), "protectedLoginStep")) protectedRefused += 1;
}
check(
  `all ${PROTECTED_LOGIN_STEP_TYPES.size} protected-login step types are refused`,
  protectedRefused === PROTECTED_LOGIN_STEP_TYPES.size,
  `${protectedRefused}/${PROTECTED_LOGIN_STEP_TYPES.size}`
);
check("the canonical protected-login set is not empty", PROTECTED_LOGIN_STEP_TYPES.size === 3);
check(
  "an ordinary step is NOT treated as protected login",
  !has(audit(cleanFragment({ nodes: [step("p", "click")], edges: [], inputs: [] })), "protectedLoginStep")
);

/* ── 4. Secrets — the name travels, a resolved value never does ───────────────────────────────── */

console.log("\n4. Secrets — a named binding is fine; a literal beside it is not");
const namedSecretOnly = cleanFragment({
  nodes: [step("s", "fill", { valueSource: { type: "secret", secretName: "PORTAL_PASSWORD" } })],
  edges: [],
  inputs: []
});
check("a secret binding that carries only a NAME is allowed", !isFragmentBlocked(audit(namedSecretOnly)));

const secretWithSourceValue = cleanFragment({
  nodes: [step("s", "fill", { valueSource: { type: "secret", secretName: "PORTAL_PASSWORD", value: "hunter2" } })],
  edges: [],
  inputs: []
});
check("a secret binding carrying a literal value is refused", has(audit(secretWithSourceValue), "resolvedSecretValue"));
check("a secret literal actually BLOCKS, it is not merely reported", isFragmentBlocked(audit(secretWithSourceValue)));

const secretWithStepValue = cleanFragment({
  nodes: [step("s", "fill", { value: "hunter2", valueSource: { type: "secret", secretName: "PORTAL_PASSWORD" } })],
  edges: [],
  inputs: []
});
check("a step bound to a secret that also carries a literal is refused", has(audit(secretWithStepValue), "resolvedSecretValue"));

check(
  "no finding anywhere quotes a secret value",
  [...audit(secretWithSourceValue), ...audit(secretWithStepValue)].every(
    (f) => !JSON.stringify(f).includes("hunter2") && !JSON.stringify(f).includes("PORTAL_PASSWORD")
  )
);
check(
  "an ordinary non-secret literal is NOT refused",
  !isFragmentBlocked(audit(cleanFragment({ nodes: [step("s", "fill", { value: "widget" })], edges: [], inputs: [] })))
);

/* ── 5. The binding walk finds nested sources ─────────────────────────────────────────────────── */

console.log("\n5. Binding walk — found by shape, so a nested Oracle bind cannot hide");
const oracleStep = step("o", "oracle", {
  config: {
    oracle: {
      connectionSource: "profile",
      returnType: "string",
      binds: [{ name: "pw", jdbcType: "STRING", valueSource: { type: "secret", secretName: "DB_PW", value: "leak" } }]
    }
  }
} as Partial<FlowStep>);
const oracleFindings = audit(cleanFragment({ nodes: [oracleStep], edges: [], inputs: [] }));
check("a value source nested in an Oracle bind is found", has(oracleFindings, "resolvedSecretValue"));
check(
  "the finding names the nested field path",
  oracleFindings.some((f) => f.code === "resolvedSecretValue" && f.field === "config.oracle.binds[0].valueSource.value"),
  JSON.stringify(oracleFindings.filter((f) => f.code === "resolvedSecretValue").map((f) => f.field))
);
check(
  "the walk does not mistake the step itself for a value source",
  collectValueSources(step("x", "click")).length === 0
);
check(
  "the walk finds a loop's value source",
  collectValueSources(step("l", "loop", { loop: { valueSource: { type: "runtimeInput", key: "rows" } } })).some(
    (entry) => entry.field === "loop.valueSource"
  )
);

/* ── 6. Declared inputs ───────────────────────────────────────────────────────────────────────── */

console.log("\n6. Inputs — the declaration must match what the steps bind");
const boundStep = step("i", "fill", { valueSource: { type: "runtimeInput", key: "username" } });
check("a bound runtime input is derived", requiredInputKeys([boundStep]).join(",") === "username");
check(
  "a step binding an undeclared input is refused",
  has(audit(cleanFragment({ nodes: [boundStep], edges: [], inputs: [] })), "undeclaredInput")
);
check(
  "the same step with the input declared is allowed",
  !isFragmentBlocked(audit(cleanFragment({ nodes: [boundStep], edges: [], inputs: deriveFragmentInputs([boundStep]) })))
);
check(
  "a duplicate declared key is refused",
  has(
    audit(
      cleanFragment({
        nodes: [boundStep],
        edges: [],
        inputs: [
          { key: "username", label: "u", type: "text", required: true },
          { key: "username", label: "u", type: "text", required: true }
        ]
      })
    ),
    "duplicateInputKey"
  )
);
const unusedInput = audit(
  cleanFragment({ inputs: [{ key: "never-used", label: "n", type: "text", required: true }] })
);
check("an unused declared input is reported", has(unusedInput, "unusedDeclaredInput"));
check("an unused declared input does NOT block", !isFragmentBlocked(unusedInput));

/* ── 7. Destination-dependent rules run only with a destination ───────────────────────────────── */

console.log("\n7. Destination rules — recursion and unresolved references");
const runFlowStep = step("r", "runFlow", { flowId: "flow-dest" });
const runFlowFragment = cleanFragment({ nodes: [runFlowStep], edges: [], inputs: [] });

check("with no destination, a runFlow step raises nothing", audit(runFlowFragment).length === 0);
check(
  "applying into the flow it runs is refused as recursive",
  has(audit(runFlowFragment, { destinationFlowId: "flow-dest" }), "recursiveFlowReference")
);
check(
  "applying into a DIFFERENT flow is not recursive",
  !has(audit(runFlowFragment, { destinationFlowId: "flow-other" }), "recursiveFlowReference")
);
check(
  "a runFlow target missing from the library is refused",
  has(audit(runFlowFragment, { referenceableFlowIds: new Set(["flow-other"]) }), "unresolvedFlowReference")
);
check(
  "a runFlow target present in the library is allowed",
  !has(audit(runFlowFragment, { referenceableFlowIds: new Set(["flow-dest"]) }), "unresolvedFlowReference")
);
check(
  "a loop step's targetFlowId is checked too",
  has(
    audit(cleanFragment({ nodes: [step("l", "loop", { config: { targetFlowId: "ghost" } })], edges: [], inputs: [] }), {
      referenceableFlowIds: new Set(["flow-dest"])
    }),
    "unresolvedFlowReference"
  )
);

/* ── 8. Advisory findings inform, they never block ────────────────────────────────────────────── */

console.log("\n8. Advisory — environment bindings and mutating steps inform without refusing");
const envFragment = cleanFragment({
  nodes: [step("e", "fill", { valueSource: { type: "env", envKey: "API_HOST" } })],
  edges: [],
  inputs: []
});
check("an env binding is reported", has(audit(envFragment), "environmentSpecificBinding"));
check("an env binding does NOT block", !isFragmentBlocked(audit(envFragment)));

const dangerFragment = cleanFragment({ nodes: [step("d", "click", { name: "Delete account" })], edges: [], inputs: [] });
check("a mutating step is reported", has(audit(dangerFragment), "dangerousMutationStep"));
check("a mutating step does NOT block", !isFragmentBlocked(audit(dangerFragment)));
check(
  "a specific data-source binding is reported",
  has(
    audit(
      cleanFragment({
        nodes: [step("d", "fill", { valueSource: { type: "dynamic", dataSourceScope: "specific", dataSourceId: "ds-1" } })],
        edges: [],
        inputs: []
      })
    ),
    "environmentSpecificBinding"
  )
);

/* ── 9. Capture ───────────────────────────────────────────────────────────────────────────────── */

console.log("\n9. Capture — whole steps, boundary edges, and an untouched source");
const src = sourceFlow();
const srcBefore = JSON.stringify(src);
const captured = captureFragment({ flow: src, nodeIds: ["fill-1", "click-1"], id: "frag-1", name: "Search", now: () => "T" });
record(captured.findings);

check("capturing a valid subgraph succeeds", captured.ok);
check("the source flow is not mutated by capture", JSON.stringify(src) === srcBefore);

if (captured.ok) {
  const fragment = captured.value;
  check("only the selected steps are captured", fragment.nodes.map((n) => n.id).join(",") === "fill-1,click-1");
  check("only the internal connector is captured", fragment.edges.map((e) => e.id).join(",") === "e-m");
  check("both boundary connectors are reported as dropped", captured.findings.filter((f) => f.code === "boundaryEdgeDropped").length === 2);
  check("dropping a boundary connector does not block", !isFragmentBlocked(captured.findings));
  check(
    "an unknown future field on a step survives capture",
    (fragment.nodes[0] as unknown as Record<string, unknown>).futureUnknownField !== undefined
  );
  check("locator metadata survives capture", fragment.nodes[0]?.locator?.strategy === "label");
  check("the captured fragment audits clean", !isFragmentBlocked(audit(fragment)));
  check("capture deep-copies, so editing the fragment cannot reach the flow", (() => {
    fragment.nodes[0]!.name = "changed";
    return src.nodes.find((n) => n.id === "fill-1")?.name !== "changed";
  })());
}

const capturedTerminal = captureFragment({ flow: src, nodeIds: ["start", "fill-1"], id: "frag-t", name: "Bad" });
check("capturing the flow's start step is refused", !capturedTerminal.ok && has(capturedTerminal.findings, "terminalStepIncluded"));

const capturedGhost = captureFragment({ flow: src, nodeIds: ["not-here"], id: "frag-g", name: "Ghost" });
check("capturing a step that is not in the flow is refused", !capturedGhost.ok);

/* ── 10. Apply ────────────────────────────────────────────────────────────────────────────────── */

console.log("\n10. Apply — fresh identities, an untouched destination, no partial write");
const dest = destinationFlow();
const destBefore = JSON.stringify(dest);
const fragmentToApply = (captureFragment({ flow: sourceFlow(), nodeIds: ["fill-1", "click-1"], id: "frag-2", name: "S" }) as { ok: true; value: FlowFragment }).value;

const applied = applyFragment({ flow: dest, fragment: fragmentToApply, token: () => "t1" });
check("applying a clean fragment succeeds", applied.ok);
check("the destination flow object is not mutated", JSON.stringify(dest) === destBefore);

if (applied.ok) {
  const next = applied.value.flow;
  check("the destination keeps all of its original steps", next.nodes.filter((n) => n.id === "start" || n.id === "end").length === 2);
  check("the inserted steps carry NEW ids", applied.value.insertedNodeIds.every((id) => !dest.nodes.some((n) => n.id === id)));
  check("the inserted ids are derived from the originals", applied.value.insertedNodeIds.join(",") === "fill-1-t1,click-1-t1");
  check("the inserted connector is remapped onto the new ids", next.edges.some((e) => e.source === "fill-1-t1" && e.target === "click-1-t1"));
  check("no original connector was changed", next.edges.some((e) => e.id === "d-e" && e.source === "start" && e.target === "end"));

  // Applying the SAME fragment again must add a second independent copy, never overwrite the first.
  const twice = applyFragment({ flow: next, fragment: fragmentToApply, token: () => "t2" });
  check("applying the same fragment twice succeeds", twice.ok);
  if (twice.ok) {
    const ids = twice.value.flow.nodes.map((n) => n.id);
    check("the second application collides with nothing", new Set(ids).size === ids.length);
    check("both copies are present", ids.includes("fill-1-t1") && ids.includes("fill-1-t2"));
  }
}

const recursive = applyFragment({ flow: dest, fragment: { ...fragmentToApply, nodes: [step("r", "runFlow", { flowId: "flow-dest" })], edges: [], inputs: [] } });
check("applying a fragment that would run the destination is refused", !recursive.ok);
check("a refused apply returns no flow at all", !("value" in recursive));

const nextPointer = {
  ...fragmentToApply,
  nodes: [step("n1", "click", { next: "n2" }), step("n2", "click", { next: "outside-the-fragment" })],
  edges: [],
  inputs: []
};
const pointerApplied = applyFragment({ flow: dest, fragment: nextPointer, token: () => "t3" });
check("an internal next pointer is remapped", pointerApplied.ok && pointerApplied.value.flow.nodes.some((n) => n.id === "n1-t3" && n.next === "n2-t3"));
check(
  "a next pointer leaving the fragment is dropped rather than left dangling",
  pointerApplied.ok && pointerApplied.value.flow.nodes.some((n) => n.id === "n2-t3" && n.next === undefined)
);

/* ── 11. Persistence against the real store ───────────────────────────────────────────────────── */

console.log("\n11. Persistence — create, reload, edit, re-save, and no silent overwrite");
const folder = await mkdtemp(join(tmpdir(), "awkit-fragments-"));
try {
  const store = new JsonProfileStore<FlowFragment>({ folder });
  const toSave = structuredClone(fragmentToApply);
  (toSave.nodes[0] as unknown as Record<string, unknown>).futureUnknownField = { keep: "me" };

  await store.create(toSave);
  const reloaded = await store.get(toSave.id);
  check("a saved fragment reloads", reloaded !== null);
  check("an unknown field survives save and reload", (reloaded?.nodes[0] as Record<string, unknown> | undefined)?.futureUnknownField !== undefined);
  check("the reloaded fragment still audits clean", reloaded !== null && !isFragmentBlocked(audit(reloaded)));

  let overwritten = false;
  try {
    await store.create({ ...toSave, name: "Impostor" });
    overwritten = true;
  } catch {
    overwritten = false;
  }
  check("creating a fragment with an existing id is refused", !overwritten);
  check("the original survived the refused create", (await store.get(toSave.id))?.name === toSave.name);

  const edited = { ...reloaded!, name: "Renamed", updatedAt: "T2" };
  await store.update(edited.id, edited);
  const afterEdit = await store.get(edited.id);
  check("an edit round-trips", afterEdit?.name === "Renamed");
  check("the unknown field survives the edit too", (afterEdit?.nodes[0] as Record<string, unknown> | undefined)?.futureUnknownField !== undefined);
  check("the store lists the fragment", (await store.list()).some((f) => f.id === edited.id));

  // A tampered file on disk must be caught when it is read back, not trusted because it was valid
  // when it was written. The fragment folder is ordinary user-writable JSON.
  const tampered = { ...afterEdit!, nodes: [...afterEdit!.nodes, step("evil", "protectedLoginHandoff")] };
  await store.update(tampered.id, tampered);
  check("a tampered stored fragment is caught on reload", isFragmentBlocked(audit(await store.get(tampered.id))));
} finally {
  await rm(folder, { recursive: true, force: true });
}

/* ── 12. No AI anywhere on this path ──────────────────────────────────────────────────────────── */

console.log("\n12. Model independence and the protected-login drift guard");
const fragmentSources = await Promise.all(
  ["src/fragments/FlowFragment.ts", "src/fragments/fragmentOperations.ts", "app/main/ipc/fragment.ipc.ts"].map(
    async (relative) => ({ relative, text: await readFile(join(REPO_ROOT, relative), "utf8") })
  )
);
for (const { relative, text } of fragmentSources) {
  check(`${relative} imports nothing from the AI layer`, !/from\s+"@src\/ai\//.test(text));
}
check(
  "every fragment IPC channel is permission-gated",
  (() => {
    const ipc = fragmentSources.find((s) => s.relative === "app/main/ipc/fragment.ipc.ts")!.text;
    const channels = [...ipc.matchAll(/ipcMain\.handle\(\s*\n?\s*"(fragments:[a-zA-Z]+)"/g)].map((m) => m[1]!);
    const gates = [...ipc.matchAll(/assertSenderPermission\(/g)].length;
    return channels.length === 6 && gates === channels.length;
  })(),
  "expected 6 channels each calling assertSenderPermission"
);

/**
 * Drift guard for the two copies that predate the canonical set. Collapsing them is lease-gated on
 * `src/security/authz/**`, so until that happens the only thing keeping the three in agreement is
 * this check — and a silent disagreement is exactly how a protected-login step ends up reusable in
 * one layer and excluded in another.
 */
const canonical = [...PROTECTED_LOGIN_STEP_TYPES].sort().join(",");
for (const [relative, symbol] of [
  ["src/security/authz/AiAutonomyPolicy.ts", "PROTECTED_LOGIN_STEP_TYPES"],
  ["src/runner/evidence/FailureEvidenceCollector.ts", "PROTECTED_STEP_TYPES"]
] as const) {
  const text = await readFile(join(REPO_ROOT, relative), "utf8");
  const declaration = new RegExp(`${symbol}[^=]*=\\s*new Set\\(\\[([^\\]]*)\\]`).exec(text);
  const members = (declaration?.[1] ?? "")
    .split(",")
    .map((entry) => entry.trim().replace(/^"|"$/g, ""))
    .filter((entry) => entry.length > 0)
    .sort()
    .join(",");
  check(`${relative} still agrees with the canonical protected-login set`, members === canonical, `${members} vs ${canonical}`);
}

/* ── 13. Cardinality: no rule may be unreachable ──────────────────────────────────────────────── */

console.log("\n13. Cardinality — every declared audit code was actually produced");
const missingCodes = ALL_AUDIT_CODES.filter((code) => !observedCodes.has(code));
const strayCodes = [...observedCodes].filter((code) => !ALL_AUDIT_CODES.includes(code));
check(`all ${ALL_AUDIT_CODES.length} audit codes were produced by a real case`, missingCodes.length === 0, `never produced: ${missingCodes.join(", ")}`);
check("the audit produced no code outside the declared set", strayCodes.length === 0, strayCodes.join(", "));

// Severity is checked per CODE, over everything this run produced, so a single flip anywhere in
// the matrix fails here even if every "was it reported?" assertion still passes.
const severityDrift = ALL_AUDIT_CODES.filter((code) => {
  const seen = [...(observedSeverities.get(code) ?? [])];
  return seen.length !== 1 || seen[0] !== EXPECTED_SEVERITY[code];
});
check(
  "every audit code carried exactly its declared severity",
  severityDrift.length === 0,
  severityDrift.map((code) => `${code}: expected ${EXPECTED_SEVERITY[code]}, saw ${[...(observedSeverities.get(code) ?? [])].join("/") || "nothing"}`).join("; ")
);
check(
  "the matrix has both blocking and advisory rules",
  ALL_AUDIT_CODES.some((c) => EXPECTED_SEVERITY[c] === "blocking") && ALL_AUDIT_CODES.some((c) => EXPECTED_SEVERITY[c] === "advisory")
);
check(
  "blockingFindings agrees with isFragmentBlocked",
  (() => {
    const findings = audit(cleanFragment({ nodes: [], edges: [], inputs: [] }));
    return blockingFindings(findings).length > 0 === isFragmentBlocked(findings);
  })()
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
