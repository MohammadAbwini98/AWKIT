/**
 * verify:flow-import-authorization — Phase N, N6.9 (awkit-vra.15.9): importing over an existing flow needs
 * WORKFLOW_EDIT, decided race-safely inside the flow store's critical section (plan "Import authorization",
 * VA-11, cases I1-I9).
 *
 * Real JsonProfileStore configured like `createFlowProfileStore` (production lifecycle hooks, cross-process
 * lock, `importOverwrite: "authorize"`), the real `importFlowAuthorized` the `flows:import` handler calls, and
 * real VisualBaselineStore approvals so "unchanged" covers the flow file, its epoch token and its signed
 * files. Permissions are a mutable fake of the sender's grants; each refused WORKFLOW_EDIT check counts as
 * one audit entry, as `assertSenderPermission(..., { audit })` records one. Races are ordered by gates inside
 * the critical section. The suite then runs against variants that each reintroduce one defect.
 *
 * Run: npm run verify:flow-import-authorization
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";

import { importFlowAuthorized, type FlowImportPermissions } from "../app/main/ipc/flowImport";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import { FlowBaselineLifecycle } from "@src/runner/visualAssertion/flowBaselineLifecycle";
import { VisualBaselineStore } from "@src/runner/visualAssertion/VisualBaselineStore";
import { VisualBaselineLayout } from "@src/runner/visualAssertion/visualBaselineLayout";
import { JsonProfileStore, ProfileImportOverwriteError, type ProfileWriteContext } from "@src/storage/ProfileStore";
import { approvalFor, flow, tempRoot, testProtector, within, type Env } from "./lib/visualBaselineKit.mts";

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

/** A fingerprint of everything an unauthorized import must leave alone: flow files, tokens, signed files. */
function snapshot(root: string): string {
  const hash = createHash("sha256");
  for (const file of walk(root).filter((f) => !f.includes(`${join(".awkit-visual", "locks")}`)).sort()) {
    hash.update(file);
    hash.update(readFileSync(file));
  }
  return hash.digest("hex");
}

type StoreClass = typeof JsonProfileStore;
type ImportFn = typeof importFlowAuthorized;

interface Variant {
  Store?: (layout: VisualBaselineLayout) => StoreClass;
  importFn?: ImportFn;
}

interface World extends Env {
  grants: { create: boolean; edit: boolean };
  audits: number;
  permissions: FlowImportPermissions;
  importFn: ImportFn;
}

const GUARD = 15000;
const permissionsFor = (world: { grants: { create: boolean; edit: boolean }; audits: number }): FlowImportPermissions => ({
  assertCreate: async () => {
    if (!world.grants.create) throw new Error("NOT_AUTHORIZED: WORKFLOW_CREATE");
  },
  assertEdit: async () => {
    if (!world.grants.edit) {
      world.audits += 1;
      throw new Error("NOT_AUTHORIZED: WORKFLOW_EDIT");
    }
  }
});

function makeWorld(variant: Variant, lifecycleClass: typeof FlowBaselineLifecycle = FlowBaselineLifecycle, timeoutMs = 4000): World {
  const root = tempRoot("import");
  const flowsFolder = join(root, "flows");
  const layout = new VisualBaselineLayout({ flowsFolder, runtimeRoot: join(root, "runtime"), lockTimeoutMs: 8000 });
  const lifecycle = new lifecycleClass(layout);
  const StoreClass = variant.Store ? variant.Store(layout) : JsonProfileStore;
  const flows = new StoreClass<FlowProfile>({
    folder: flowsFolder,
    createClone: (profile, nextId) => ({ ...profile, id: nextId, name: `${profile.name} Copy` }),
    hooks: lifecycle.hooks(),
    importOverwrite: "authorize",
    importAuthorizationTimeoutMs: timeoutMs
  });
  const protector = testProtector();
  const store = new VisualBaselineStore({ layout, appMode: "dev", protector, readFlow: (id) => flows.get(id) });
  const world = { root, flowsFolder, layout, lifecycle, flows, store, protector, grants: { create: true, edit: true }, audits: 0 } as unknown as World;
  world.permissions = permissionsFor(world);
  world.importFn = variant.importFn ?? importFlowAuthorized;
  return world;
}

/** A world holding flow F with an approved step s1 (token, index and record on disk). */
async function approvedWorld(variant: Variant, lifecycleClass?: typeof FlowBaselineLifecycle, timeoutMs?: number): Promise<World> {
  const world = makeWorld(variant, lifecycleClass, timeoutMs);
  await world.flows.create(flow("F"));
  const r = await world.store.approveUnchecked(await approvalFor(world, "F", "s1"));
  if (!r.ok) throw new Error(`setup approval failed: ${r.refusal}`);
  return world;
}

const refusedAs = (error: unknown, refusal?: string): boolean =>
  error instanceof ProfileImportOverwriteError && error.code === "FLOW_IMPORT_OVERWRITE_FORBIDDEN" && (refusal === undefined || error.refusal === refusal);

async function attempt(world: World, profile: FlowProfile): Promise<{ ok: true } | { ok: false; error: unknown }> {
  try {
    await within(GUARD, world.importFn(world.flows, profile, world.permissions), "import");
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

async function importSuite(variant: Variant): Promise<Outcome[]> {
  const out: Outcome[] = [];
  const add = (label: string, ok: unknown, detail?: string): void => {
    out.push({ label, ok: !!ok, detail });
  };
  const renamed = (id: string, name: string): FlowProfile => ({ ...flow(id), name });

  // I1 create only, new id.
  {
    const w = makeWorld(variant);
    w.grants.edit = false;
    const r = await attempt(w, renamed("N", "new import"));
    const lookup = await w.store.lookup({ flowId: "N", stepId: "s1", stepContentDigest: "0".repeat(64), conditions: (await approvalFor(w, "N", "s1")).conditions });
    add("[I1] WORKFLOW_CREATE alone imports a new id as a create, with no approval inherited", r.ok && (await w.flows.get("N"))?.name === "new import" && lookup.status === "absent" && w.audits === 0, JSON.stringify(r));
  }
  // I2 create only, existing id.
  {
    const w = await approvedWorld(variant);
    w.grants.edit = false;
    const before = snapshot(w.root);
    const r = await attempt(w, renamed("F", "overwritten"));
    add("[I2] WORKFLOW_CREATE alone cannot import over an existing flow (typed refusal)", !r.ok && refusedAs(r.error, "denied"), r.ok ? "imported" : String(r.error));
    add("[I2] ...the flow, its epoch token, index and records are byte-identical", snapshot(w.root) === before);
    add("[I2] ...and exactly one denial is audited", w.audits === 1, String(w.audits));
  }
  // I3 create + edit, existing id.
  {
    const w = await approvedWorld(variant);
    const tokenBefore = await w.layout.readToken("F");
    const r = await attempt(w, renamed("F", "overwritten"));
    const files = walk(join(w.root, "runtime", "visual-baselines")).filter((p) => p.includes(w.layout.flowKey("F"))).length;
    add("[I3] WORKFLOW_CREATE and WORKFLOW_EDIT import over an existing flow and invalidate it", r.ok && (await w.flows.get("F"))?.name === "overwritten" && files === 0 && (await w.layout.readToken("F")) !== tokenBefore, JSON.stringify(r));
  }
  // I4 edit without create.
  {
    const w = await approvedWorld(variant);
    w.grants.create = false;
    const before = snapshot(w.root);
    const r = await attempt(w, renamed("F", "overwritten"));
    add("[I4] WORKFLOW_EDIT without WORKFLOW_CREATE is refused at the entry gate and changes nothing", !r.ok && /WORKFLOW_CREATE/.test(String(r.error)) && snapshot(w.root) === before);
  }
  // I5 race with a create of the same id, both orders.
  {
    let release: () => void = () => undefined;
    let entered: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const inside = new Promise<void>((resolve) => (entered = resolve));
    class GateCreate extends FlowBaselineLifecycle {
      protected override async onWrite(context: ProfileWriteContext<FlowProfile>): Promise<void> {
        if (context.operation === "create" && context.id === "R") {
          entered();
          await gate;
        }
        return super.onWrite(context);
      }
    }
    const w = makeWorld(variant, GateCreate);
    w.grants.edit = false;
    const create = w.flows.create(renamed("R", "created first"));
    await within(GUARD, inside, "create in its critical section");
    const imported = attempt(w, renamed("R", "imported second"));
    release();
    await create;
    const r = await imported;
    add("[I5] an import queued behind a create of the same id is refused, never an overwrite", !r.ok && refusedAs(r.error) && (await w.flows.get("R"))?.name === "created first", r.ok ? "imported" : String(r.error));
  }
  {
    let release: () => void = () => undefined;
    let entered: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const inside = new Promise<void>((resolve) => (entered = resolve));
    class GateImport extends FlowBaselineLifecycle {
      protected override async onWrite(context: ProfileWriteContext<FlowProfile>): Promise<void> {
        if (context.operation === "import" && context.id === "Q") {
          entered();
          await gate;
        }
        return super.onWrite(context);
      }
    }
    const w = makeWorld(variant, GateImport);
    w.grants.edit = false;
    const imported = attempt(w, renamed("Q", "imported first"));
    await within(GUARD, inside, "import in its critical section");
    const create = w.flows.create(renamed("Q", "created second")).then(() => "created", (e: unknown) => String(e));
    release();
    await imported;
    const c = await create;
    add("[I5] a create queued behind an import of the same id is refused, never an overwrite", /already exists/.test(c) && (await w.flows.get("Q"))?.name === "imported first", c);
  }
  // I6 an unparseable file at the target path.
  {
    const w = makeWorld(variant);
    w.grants.edit = false;
    const path = join(w.flowsFolder, "U.json");
    mkdirSync(w.flowsFolder, { recursive: true });
    writeFileSync(path, "{ not json");
    const r = await attempt(w, renamed("U", "overwritten"));
    const quarantined = readdirSync(w.flowsFolder).some((f) => f.includes(".corrupt-"));
    add("[I6] an unparseable file at the target counts as existing: refused, its bytes kept, nothing quarantined", !r.ok && refusedAs(r.error) && readFileSync(path, "utf8") === "{ not json" && !quarantined, r.ok ? "imported" : String(r.error));
  }
  // I7 WORKFLOW_EDIT revoked while the import waits.
  {
    let release: () => void = () => undefined;
    let entered: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const inside = new Promise<void>((resolve) => (entered = resolve));
    class GateUpdate extends FlowBaselineLifecycle {
      protected override async onWrite(context: ProfileWriteContext<FlowProfile>): Promise<void> {
        if (context.operation === "update") {
          entered();
          await gate;
        }
        return super.onWrite(context);
      }
    }
    const w = await approvedWorld(variant, GateUpdate);
    const update = w.flows.update("F", renamed("F", "updated"));
    await within(GUARD, inside, "update in its critical section");
    // Revoke only AFTER the import has passed its entry gate (with WORKFLOW_EDIT still granted then).
    let passedEntry: () => void = () => undefined;
    const entry = new Promise<void>((resolve) => (passedEntry = resolve));
    const real = w.permissions;
    w.permissions = {
      assertCreate: async () => {
        await real.assertCreate();
        passedEntry();
      },
      assertEdit: () => real.assertEdit()
    };
    const imported = attempt(w, renamed("F", "imported"));
    await within(GUARD, entry, "import past its entry gate");
    w.grants.edit = false;
    release();
    await update;
    const r = await imported;
    add("[I7] WORKFLOW_EDIT revoked while the import waited is honored: refused", !r.ok && refusedAs(r.error, "denied") && (await w.flows.get("F"))?.name === "updated", r.ok ? "imported" : String(r.error));
  }
  // I8 the authorizer times out.
  {
    const w = await approvedWorld(variant, FlowBaselineLifecycle, 250);
    const before = snapshot(w.root);
    const hanging: FlowImportPermissions = { assertCreate: async () => undefined, assertEdit: () => new Promise(() => undefined) };
    let r: { ok: true } | { ok: false; error: unknown };
    try {
      await within(GUARD, w.importFn(w.flows, renamed("F", "overwritten"), hanging), "import");
      r = { ok: true };
    } catch (error) {
      r = { ok: false, error };
    }
    add("[I8] an authorizer that never answers is a denial at the deadline, and nothing changes", !r.ok && refusedAs(r.error, "timeout") && snapshot(w.root) === before, r.ok ? "imported" : String(r.error));
  }
  // I9 the store's import without an authorizer.
  {
    const w = await approvedWorld(variant);
    const before = snapshot(w.root);
    const existing = await w.flows.import(renamed("F", "overwritten")).then(() => "imported", (e: unknown) => e);
    const fresh = await w.flows.import(renamed("Z", "new")).then(() => "imported", (e: unknown) => String(e));
    add("[I9] the flow store's import without an authorizer refuses an existing id", refusedAs(existing, "no-authorizer") && snapshot(w.root) !== "" && (await w.flows.get("F"))?.name === "Flow F", String(existing));
    add("[I9] ...and still imports a new id", fresh === "imported");
    void before;
  }
  return out;
}

// ── Variants that each reintroduce one defect ───────────────────────────────────────────────────────────

/** The existence check moves OUTSIDE the critical section; the write then trusts it. */
const CheckOutsideLane = (): StoreClass =>
  class extends JsonProfileStore<FlowProfile> {
    override async import(profile: FlowProfile, request: { authorizeOverwrite?: () => Promise<boolean> } = {}): Promise<FlowProfile> {
      const folder = (this as unknown as { options: { folder: string } }).options.folder;
      let exists = true;
      try {
        await stat(join(folder, `${profile.id}.json`));
      } catch {
        exists = false;
      }
      if (exists && !(await request.authorizeOverwrite?.())) throw new ProfileImportOverwriteError("denied");
      return super.import(profile, { authorizeOverwrite: async () => true });
    }
  } as unknown as StoreClass;

/** Existence is read with get(), which quarantines an unparseable file and reports it missing. */
const ReadWithGet = (): StoreClass =>
  class extends JsonProfileStore<FlowProfile> {
    protected override async authorizeImportUnlocked(id: string, authorizer: (() => Promise<boolean>) | undefined): Promise<void> {
      if (!(await this.get(id))) return;
      if (!authorizer || !(await authorizer())) throw new ProfileImportOverwriteError("denied");
    }
  } as unknown as StoreClass;

/** Invalidation runs before the authorization. */
const InvalidateFirst = (layout: VisualBaselineLayout): StoreClass =>
  class extends JsonProfileStore<FlowProfile> {
    protected override async authorizeImportUnlocked(id: string, authorizer: (() => Promise<boolean>) | undefined): Promise<void> {
      await layout.invalidateFlowUnlocked(id);
      return super.authorizeImportUnlocked(id, authorizer);
    }
  } as unknown as StoreClass;

/** An unparseable target skips the authorizer. */
const SkipWhenUnparseable = (): StoreClass =>
  class extends JsonProfileStore<FlowProfile> {
    protected override async authorizeImportUnlocked(id: string, authorizer: (() => Promise<boolean>) | undefined): Promise<void> {
      const folder = (this as unknown as { options: { folder: string } }).options.folder;
      try {
        JSON.parse(readFileSync(join(folder, `${id}.json`), "utf8"));
      } catch {
        return;
      }
      return super.authorizeImportUnlocked(id, authorizer);
    }
  } as unknown as StoreClass;

/** A timeout is treated as allow. */
const TimeoutAllows = (): StoreClass =>
  class extends JsonProfileStore<FlowProfile> {
    protected override async authorizeImportUnlocked(id: string, authorizer: (() => Promise<boolean>) | undefined): Promise<void> {
      const folder = (this as unknown as { options: { folder: string } }).options.folder;
      if (!existsSync(join(folder, `${id}.json`))) return;
      if (!authorizer) throw new ProfileImportOverwriteError("no-authorizer");
      const outcome = await Promise.race([authorizer(), new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 250))]);
      if (!outcome) throw new ProfileImportOverwriteError("denied");
    }
  } as unknown as StoreClass;

/** The edit permission is checked once, at handler entry, and the in-lane decision reuses that answer. */
const entryOnly: ImportFn = async (store, profile, permissions) => {
  await permissions.assertCreate();
  let allowed = true;
  try {
    await permissions.assertEdit();
  } catch {
    allowed = false;
  }
  return store.import(profile, { authorizeOverwrite: async () => allowed });
};

console.log("verify:flow-import-authorization — N6.9 import over an existing flow needs WORKFLOW_EDIT\n");

const handler = readFileSync(join(process.cwd(), "app", "main", "ipc", "flow.ipc.ts"), "utf8");
const importHandler = /"flows:import"[\s\S]*?\n  \}\);/.exec(handler)?.[0] ?? "";
check("the flows:import handler goes through importFlowAuthorized", /importFlowAuthorized\(store, profile/.test(importHandler));
check("...with WORKFLOW_CREATE at entry and an audited WORKFLOW_EDIT for the overwrite", /assertCreate: \(\) => assertSenderPermission\(event, Permission\.WORKFLOW_CREATE\)/.test(importHandler) && /Permission\.WORKFLOW_EDIT, \{ audit: \{ eventType: "FLOW_IMPORT_OVERWRITE_DENIED", channel: "flows:import" \} \}/.test(importHandler));
check("...and no direct store.import call remains in the handler", !/store\.import\(/.test(importHandler));
const factory = readFileSync(join(process.cwd(), "app", "main", "profileStores.ts"), "utf8");
check("the production flow store authorizes import overwrites", /createFlowProfileStore\(\)[\s\S]*?importOverwrite: "authorize"/.test(factory) && (factory.match(/importOverwrite:/g) ?? []).length === 1);
{
  const root = tempRoot("plain-import");
  const plain = new JsonProfileStore<FlowProfile>({ folder: join(root, "workflows") });
  await plain.create(flow("W"));
  await plain.import({ ...flow("W"), name: "replaced" });
  check("other stores keep the historical overwrite-always import", (await plain.get("W"))?.name === "replaced");
}

for (const outcome of await importSuite({})) check(outcome.label, outcome.ok, outcome.ok ? undefined : outcome.detail);

console.log("\n  mutants (each must FAIL the suite)");
const mutants: Array<[string, Variant, string]> = [
  ["the existence check is outside the critical section", { Store: CheckOutsideLane }, "[I5] an import queued behind a create"],
  ["existence is read with get(), quarantining an unparseable file", { Store: ReadWithGet }, "[I6] an unparseable file"],
  ["invalidation runs before the authorization", { Store: InvalidateFirst }, "[I2] ...the flow, its epoch token"],
  ["an unparseable target skips the authorizer", { Store: SkipWhenUnparseable }, "[I6] an unparseable file"],
  ["an authorizer timeout is treated as allow", { Store: TimeoutAllows }, "[I8] an authorizer that never answers"],
  ["the edit permission is checked only at handler entry", { importFn: entryOnly }, "[I7] WORKFLOW_EDIT revoked"]
];
for (const [name, variant, mustFail] of mutants) {
  const failing = (await importSuite(variant)).filter((o) => !o.ok).map((o) => o.label);
  check(`MUTATION: ${name} fails the suite (${failing.length} checks, including "${mustFail}")`, failing.some((label) => label.startsWith(mustFail)), failing.join("; ") || "nothing failed");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
