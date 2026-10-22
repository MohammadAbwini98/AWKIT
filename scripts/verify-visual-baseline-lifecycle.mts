/**
 * verify:visual-baseline-lifecycle — Phase N, N6.3 (awkit-vra.15.3): no visual-baseline approval
 * survives a flow mutation that should invalidate it, and none is lost by one that should not (plan A3).
 *
 * Real JsonProfileStore with the production hooks (`FlowBaselineLifecycle`, the same class
 * `createFlowProfileStore` installs), real filesystem, real VisualBaselineStore approvals. Production
 * writers map onto the store operations exercised here: Recorder save = create; clone = create;
 * flows:import = import; flows:update, validation repair and `undoMigration` restore = update; AI revert,
 * locator upgrade and fragment instantiation = updateWith; flows:delete = delete.
 *
 * Races are ordered by a gate inside the write's critical section, never by timing. Crashes are planted
 * by subclassing the real lifecycle and layout. The suite then runs against variants that each remove one
 * protection; every variant must fail the suite at the named case.
 *
 * Run: npm run verify:visual-baseline-lifecycle
 */

import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { FlowProfile } from "@src/profiles/FlowProfile";
import { FlowBaselineLifecycle } from "@src/runner/visualAssertion/flowBaselineLifecycle";
import { VisualBaselineStore } from "@src/runner/visualAssertion/VisualBaselineStore";
import { VisualBaselineLayout } from "@src/runner/visualAssertion/visualBaselineLayout";
import { JsonProfileStore, type ProfileWriteContext } from "@src/storage/ProfileStore";
import { approvalFor, conditions, flow, makeEnv, step, stepDigest, tempRoot, within, type Env } from "./lib/visualBaselineKit.mts";

type Outcome = { label: string; ok: boolean; detail?: string };

let passed = 0;
let failed = 0;
function check(label: string, ok: unknown, detail?: string): void {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function walk(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

interface Variant {
  Lifecycle?: typeof FlowBaselineLifecycle;
  Layout?: typeof VisualBaselineLayout;
  Store?: typeof VisualBaselineStore;
}

/** Shared with variants that must know whether the keystore is down (the "invalidation needs the key" defect). */
const keystore = { available: true };
const GUARD_MS = 15000;

async function lifecycleSuite(variant: Variant): Promise<Outcome[]> {
  const out: Outcome[] = [];
  const add = (label: string, ok: unknown, detail?: string): void => {
    out.push({ label, ok: !!ok, detail });
  };
  const BaseLifecycle = variant.Lifecycle ?? FlowBaselineLifecycle;
  const BaseLayout = variant.Layout ?? VisualBaselineLayout;

  /** A flow F with steps s1 and s2, both approved. */
  const setup = async (extra: { Lifecycle?: typeof FlowBaselineLifecycle; Layout?: typeof VisualBaselineLayout } = {}): Promise<Env> => {
    keystore.available = true;
    const env = makeEnv({ Store: variant.Store, Lifecycle: extra.Lifecycle ?? BaseLifecycle, Layout: extra.Layout ?? BaseLayout, protector: undefined });
    await env.flows.create(flow("F"));
    for (const stepId of ["s1", "s2"]) {
      const r = await env.store.approveUnchecked(await approvalFor(env, "F", stepId));
      if (!r.ok) throw new Error(`setup approval failed: ${r.refusal}`);
    }
    return env;
  };
  const files = (env: Env, flowId: string, stepId?: string): number =>
    walk(join(env.root, "runtime", "visual-baselines")).filter((p) => p.includes(env.layout.flowKey(flowId)) && (!stepId || p.includes(env.layout.stepKey(stepId)))).length;
  const present = async (env: Env, flowId: string, stepId: string, digest: string): Promise<boolean> =>
    (await env.store.lookup({ flowId, stepId, stepContentDigest: digest, conditions: conditions() })).status === "present";
  const guarded = <T,>(label: string, promise: Promise<T>): Promise<T> => within(GUARD_MS, promise, label);
  const changed = (profile: FlowProfile, stepId: string, value: string): FlowProfile => ({
    ...profile,
    nodes: profile.nodes.map((n) => (n.id === stepId ? ({ ...n, locator: { strategy: "css", value } } as typeof n) : n))
  });

  // L1 create after an external delete: the recreated flow inherits nothing.
  {
    const env = await setup();
    const d1 = await stepDigest(env, "F", "s1");
    const before = await env.layout.readToken("F");
    rmSync(join(env.flowsFolder, "F.json"));
    await guarded("create", env.flows.create(flow("F")));
    add("[create] a flow recreated with the same id and content inherits no approval", files(env, "F") === 0 && !(await present(env, "F", "s1", d1)) && (await env.layout.readToken("F")) !== before);
  }
  // L2 a refused duplicate create changes nothing.
  {
    const env = await setup();
    const d1 = await stepDigest(env, "F", "s1");
    const before = await env.layout.readToken("F");
    const refused = await guarded("duplicate create", env.flows.create(flow("F")).then(() => false, () => true));
    add("[create] a refused duplicate-id create leaves approvals and the token intact", refused && (await present(env, "F", "s1", d1)) && (await env.layout.readToken("F")) === before);
  }
  // L3 clone.
  {
    const env = await setup();
    const d1 = await stepDigest(env, "F", "s1");
    await guarded("clone", env.flows.clone("F", "F2"));
    add("[clone] the clone (same step ids) has no approval and the source keeps its own", files(env, "F2") === 0 && !(await present(env, "F2", "s1", d1)) && (await present(env, "F", "s1", d1)));
  }
  // L4 identical re-import.
  {
    const env = await setup();
    const d1 = await stepDigest(env, "F", "s1");
    const before = await env.layout.readToken("F");
    await guarded("import", env.flows.import(flow("F")));
    add("[import] an identical re-import removes every approval and changes the token", files(env, "F") === 0 && !(await present(env, "F", "s1", d1)) && (await env.layout.readToken("F")) !== before);
  }
  // L5 promotion and cosmetic edits keep approvals.
  {
    const env = await setup();
    const d1 = await stepDigest(env, "F", "s1");
    const current = (await env.flows.get("F"))!;
    const cosmetic: FlowProfile = {
      ...current,
      name: "Renamed",
      nodes: current.nodes.map((n) => (n.id === "s1" ? ({ ...n, name: "Renamed step", description: "d", position: { x: 9, y: 9 }, mode: "enforce" } as typeof n) : n))
    };
    await guarded("update", env.flows.update("F", cosmetic));
    add("[update] promoting observe to enforce, renaming or moving a step keeps its approval", (await present(env, "F", "s1", d1)) && files(env, "F", "s2") > 0);
  }
  // L6 a locator change purges only that step.
  {
    const env = await setup();
    const d1 = await stepDigest(env, "F", "s1");
    const d2 = await stepDigest(env, "F", "s2");
    await guarded("update", env.flows.update("F", changed((await env.flows.get("F"))!, "s1", "#moved")));
    add("[update] a locator change removes that step's approval and keeps the others", files(env, "F", "s1") === 0 && !(await present(env, "F", "s1", d1)) && (await present(env, "F", "s2", d2)));
  }
  // L7 step removal.
  {
    const env = await setup();
    const d1 = await stepDigest(env, "F", "s1");
    const current = (await env.flows.get("F"))!;
    await guarded("update", env.flows.update("F", { ...current, nodes: current.nodes.filter((n) => n.id !== "s2") }));
    add("[update] a removed step's approval is removed", files(env, "F", "s2") === 0 && (await present(env, "F", "s1", d1)));
  }
  // L8 step-id reuse.
  {
    const env = await setup();
    const d1 = await stepDigest(env, "F", "s1");
    const current = (await env.flows.get("F"))!;
    await guarded("update", env.flows.update("F", { ...current, nodes: [step("s1", { type: "fill", value: "x" } as never), current.nodes[1]] }));
    add("[update] a different step reusing the id loses the approval", files(env, "F", "s1") === 0 && !(await present(env, "F", "s1", d1)));
  }
  // L9 updateWith (AI revert, locator upgrade, fragment instantiation).
  {
    const env = await setup();
    const d1 = await stepDigest(env, "F", "s1");
    await guarded("updateWith noop", env.flows.updateWith("F", () => undefined));
    const keptOnNoop = await present(env, "F", "s1", d1);
    await guarded("updateWith", env.flows.updateWith("F", (current) => changed(current!, "s1", "#upgraded")));
    add("[updateWith] a change purges like update; a declined change touches nothing", keptOnNoop && files(env, "F", "s1") === 0 && files(env, "F", "s2") > 0);
  }
  // L10 update over a missing file.
  {
    const env = await setup();
    const before = await env.layout.readToken("F");
    const profile = (await env.flows.get("F"))!;
    rmSync(join(env.flowsFolder, "F.json"));
    await guarded("update", env.flows.update("F", profile));
    add("[update] an update over a missing file invalidates the whole flow", files(env, "F") === 0 && (await env.layout.readToken("F")) !== before);
  }
  // L11 delete.
  {
    const env = await setup();
    const before = await env.layout.readToken("F");
    await guarded("delete", env.flows.delete("F"));
    add("[delete] delete removes every approval and changes the token", files(env, "F") === 0 && (await env.layout.readToken("F")) !== before);
  }
  // L12 rename.
  {
    const env = await setup();
    const current = (await env.flows.get("F"))!;
    await guarded("rename", env.flows.update("F", { ...current, id: "F9" }));
    add("[rename] an id rename invalidates the old id and gives the new id nothing", files(env, "F") === 0 && files(env, "F9") === 0);
  }
  // L13 quarantine from a read outside the lane.
  {
    const env = await setup();
    const before = await env.layout.readToken("F");
    writeFileSync(join(env.flowsFolder, "F.json"), "{");
    const read = await guarded("get", env.flows.get("F"));
    add("[quarantine] a corrupt file found by a read is quarantined and the flow invalidated", read === null && files(env, "F") === 0 && (await env.layout.readToken("F")) !== before);
  }
  // L14 quarantine met inside the lane (no deadlock).
  {
    const env = await setup();
    const profile = (await env.flows.get("F"))!;
    writeFileSync(join(env.flowsFolder, "F.json"), "{");
    await guarded("update over corrupt", env.flows.update("F", profile));
    add("[quarantine] a corrupt file met inside a write is invalidated without a deadlock", files(env, "F") === 0 && readdirSync(env.flowsFolder).some((f) => f.includes(".corrupt-")));
  }
  // L15 approval racing an update, both orders, ordered by a gate inside the update's critical section.
  {
    let release: () => void = () => undefined;
    let entered: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const inside = new Promise<void>((resolve) => (entered = resolve));
    class GatedLifecycle extends BaseLifecycle {
      protected override async onWrite(context: ProfileWriteContext<FlowProfile>): Promise<void> {
        if (context.operation === "update") {
          entered();
          await gate;
        }
        return super.onWrite(context);
      }
    }
    const env = await setup({ Lifecycle: GatedLifecycle });
    const d1 = await stepDigest(env, "F", "s1");
    const request = await approvalFor(env, "F", "s1", { approver: "late-approver" });
    const update = env.flows.update("F", changed((await env.flows.get("F"))!, "s1", "#raced"));
    await guarded("update enters its critical section", inside);
    const approval = env.store.approveUnchecked(request);
    release();
    await guarded("update", update);
    const result = await guarded("approval", approval);
    add("[race] an approval queued behind an update that changed its step is refused as stale", !result.ok && result.refusal === "stale-content", JSON.stringify(result));
    add("[race] ...and no approval of the old content exists afterwards", files(env, "F", "s1") === 0 && !(await present(env, "F", "s1", d1)));
  }
  {
    const env = await setup();
    const d1 = await stepDigest(env, "F", "s1");
    await guarded("update", env.flows.update("F", changed((await env.flows.get("F"))!, "s1", "#after")));
    add("[race] an approval that landed before an update is purged by it", files(env, "F", "s1") === 0 && !(await present(env, "F", "s1", d1)));
  }
  // L16 crash after invalidation, before the flow write.
  {
    const armed = { on: false };
    class CrashAfterInvalidation extends BaseLifecycle {
      protected override async onWrite(context: ProfileWriteContext<FlowProfile>): Promise<void> {
        await super.onWrite(context);
        if (armed.on) throw new Error("planted crash after invalidation");
      }
    }
    const env = await setup({ Lifecycle: CrashAfterInvalidation });
    armed.on = true;
    const d1 = await stepDigest(env, "F", "s1");
    const before = readFileSync(join(env.flowsFolder, "F.json"), "utf8");
    const crashed = await guarded("import", env.flows.import(flow("F")).then(() => false, () => true));
    add("[crash] a crash between invalidation and write loses approvals, never keeps a stale one", crashed && readFileSync(join(env.flowsFolder, "F.json"), "utf8") === before && files(env, "F") === 0 && !(await present(env, "F", "s1", d1)));
  }
  // L17 crash part-way through deleting the signed files.
  {
    const armed = { on: false };
    class CrashMidDeletion extends BaseLayout {
      protected override async deleteSignedFiles(flowId: string): Promise<void> {
        if (!armed.on) return super.deleteSignedFiles(flowId);
        armed.on = false;
        const directory = await this.flowDirectory("dev", flowId);
        for (const file of readdirSync(directory).filter((f) => f.startsWith(this.stepKey("s1")))) rmSync(join(directory, file));
        throw new Error("planted crash part-way through deletion");
      }
    }
    const env = await setup({ Layout: CrashMidDeletion });
    armed.on = true;
    const d2 = await stepDigest(env, "F", "s2");
    await guarded("import", env.flows.import(flow("F")).catch(() => undefined));
    const leftovers = files(env, "F", "s2");
    const revived = await present(env, "F", "s2", d2);
    const swept = await guarded("sweep", env.store.sweep());
    add("[crash] files left by a crash mid-deletion are never revived", leftovers > 0 && !revived, `leftovers ${leftovers}, revived ${revived}`);
    add("[crash] ...and the sweep removes them", swept.deleted > 0 && files(env, "F", "s2") === 0);
  }
  // L18 keystore down: invalidation never needs the key.
  {
    const env = await setup();
    keystore.available = false;
    env.protector.state.available = false;
    const tokenBefore = await env.layout.readToken("F");
    await guarded("update", env.flows.update("F", changed((await env.flows.get("F"))!, "s1", "#down")));
    const s1Gone = files(env, "F", "s1") === 0;
    await guarded("import", env.flows.import((await env.flows.get("F"))!));
    add("[keystore] with the keystore down, update purges and import invalidates", s1Gone && files(env, "F") === 0 && (await env.layout.readToken("F")) !== tokenBefore);
    keystore.available = true;
  }
  // L20 a folder that cannot be coordinated (no hard links) still invalidates and never approves.
  {
    const env = await setup();
    const d1 = await stepDigest(env, "F", "s1");
    const fallback = makeEnv({ root: env.root, Lifecycle: BaseLifecycle, Layout: BaseLayout, Store: variant.Store, layoutOptions: { probeHardLinks: async () => false } });
    await guarded("fallback import", fallback.flows.import(flow("F")));
    const refused = await fallback.store.approveUnchecked(await approvalFor(env, "F", "s1"));
    add("[fallback] a write without cross-process coordination still invalidates approvals", files(env, "F") === 0 && !(await present(env, "F", "s1", d1)));
    add("[fallback] ...and such a folder never approves (coordination-unavailable)", !refused.ok && refused.refusal === "coordination-unavailable", JSON.stringify(refused));
  }
  // L19 other stores and non-visual flows.
  {
    const root = tempRoot("plain");
    const plain = new JsonProfileStore<FlowProfile>({ folder: join(root, "workflows") });
    await plain.create(flow("W"));
    await plain.update("W", { ...flow("W"), name: "W2" });
    await plain.import(flow("W3"));
    await plain.delete("W3");
    add("[compat] a store without hooks writes only its JSON files, as before", readdirSync(join(root, "workflows")).every((f) => f.endsWith(".json")));
    const hooked = makeEnv();
    const sample = flow("N", [step("a"), step("b")]);
    await hooked.flows.create(sample);
    await plain.create(sample);
    add(
      "[compat] a flow without visual assertions is saved byte-identically with and without the hooks",
      readFileSync(join(hooked.flowsFolder, "N.json"), "utf8") === readFileSync(join(root, "workflows", "N.json"), "utf8")
    );
    add("[compat] saving such a flow creates no epoch token", !existsSync(join(hooked.flowsFolder, ".awkit-visual", "epochs")));
  }
  return out;
}

// ── Variants that each remove one protection ────────────────────────────────────────────────────────────

class NoCreateInvalidation extends FlowBaselineLifecycle {
  protected override async onWrite(context: ProfileWriteContext<FlowProfile>): Promise<void> {
    if (context.operation === "create") return;
    return super.onWrite(context);
  }
}
class NoImportInvalidation extends FlowBaselineLifecycle {
  protected override async onWrite(context: ProfileWriteContext<FlowProfile>): Promise<void> {
    if (context.operation === "import") return;
    return super.onWrite(context);
  }
}
class RemovedStepsOnly extends FlowBaselineLifecycle {
  protected override async onWrite(context: ProfileWriteContext<FlowProfile>): Promise<void> {
    if ((context.operation === "update" || context.operation === "updateWith") && context.previous) {
      const kept = new Set(context.next.nodes.map((n) => n.id));
      await this.layout.purgeStepsUnlocked(context.id, context.previous.nodes.map((n) => n.id).filter((id) => !kept.has(id)));
      return;
    }
    return super.onWrite(context);
  }
}
class ModeInDigest extends FlowBaselineLifecycle {
  protected override async onWrite(context: ProfileWriteContext<FlowProfile>): Promise<void> {
    if ((context.operation === "update" || context.operation === "updateWith") && context.previous) {
      const after = new Map(context.next.nodes.map((n) => [n.id, JSON.stringify({ mode: (n as unknown as { mode?: string }).mode, locator: n.locator, type: n.type })]));
      const purge = context.previous.nodes
        .filter((n) => after.get(n.id) !== JSON.stringify({ mode: (n as unknown as { mode?: string }).mode, locator: n.locator, type: n.type }))
        .map((n) => n.id);
      await this.layout.purgeStepsUnlocked(context.id, purge);
      return;
    }
    return super.onWrite(context);
  }
}
class NoDeleteInvalidation extends FlowBaselineLifecycle {
  protected override async onDelete(): Promise<void> {}
}
class NoQuarantineInvalidation extends FlowBaselineLifecycle {
  protected override async onQuarantine(): Promise<void> {}
}
class InvalidationNeedsKey extends FlowBaselineLifecycle {
  protected override async onWrite(context: ProfileWriteContext<FlowProfile>): Promise<void> {
    if (!keystore.available) return;
    return super.onWrite(context);
  }
}
class FallbackSkipsInvalidation extends FlowBaselineLifecycle {
  protected override async onWrite(context: ProfileWriteContext<FlowProfile>): Promise<void> {
    if (this.layout.isUncoordinatedFallback()) return;
    return super.onWrite(context);
  }
}
class TrustsCandidateContent extends VisualBaselineStore {
  protected override async currentStepDigest(_flowId: string, _stepId: string, bound: string): Promise<string> {
    return bound;
  }
}
class DeleteBeforeToken extends VisualBaselineLayout {
  override async invalidateFlowUnlocked(flowId: string): Promise<void> {
    await this.assertHeld();
    const hadToken = await this.tokenFileExists(flowId);
    await this.deleteSignedFiles(flowId);
    if (hadToken) await this.writeToken(flowId);
  }
}

console.log("verify:visual-baseline-lifecycle — N6.3 invalidate-first lifecycle on the real flow store\n");

for (const outcome of await lifecycleSuite({})) check(outcome.label, outcome.ok, outcome.ok ? undefined : outcome.detail);

console.log("\n  mutants (each must FAIL the suite)");
const mutants: Array<[string, Variant, string]> = [
  ["create does not invalidate", { Lifecycle: NoCreateInvalidation }, "[create] a flow recreated"],
  ["import does not invalidate", { Lifecycle: NoImportInvalidation }, "[import] an identical re-import"],
  ["update purges only removed steps", { Lifecycle: RemovedStepsOnly }, "[update] a locator change"],
  ["the step digest includes the mode", { Lifecycle: ModeInDigest }, "[update] promoting observe to enforce"],
  ["delete does not invalidate", { Lifecycle: NoDeleteInvalidation }, "[delete] delete removes"],
  ["quarantine does not invalidate", { Lifecycle: NoQuarantineInvalidation }, "[quarantine] a corrupt file found by a read"],
  ["invalidation needs the key", { Lifecycle: InvalidationNeedsKey }, "[keystore] with the keystore down"],
  ["the uncoordinated fallback skips invalidation", { Lifecycle: FallbackSkipsInvalidation }, "[fallback] a write without cross-process coordination"],
  ["approval trusts the candidate's content instead of re-reading the flow", { Store: TrustsCandidateContent }, "[race] an approval queued behind an update"],
  ["signed files are deleted before the new token is written", { Layout: DeleteBeforeToken }, "[crash] files left by a crash mid-deletion are never revived"]
];
for (const [name, variant, mustFail] of mutants) {
  const failing = (await lifecycleSuite(variant)).filter((o) => !o.ok).map((o) => o.label);
  check(`MUTATION: ${name} fails the suite (${failing.length} checks, including "${mustFail}")`, failing.some((label) => label.startsWith(mustFail)), failing.join("; ") || "nothing failed");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
