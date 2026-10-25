/**
 * verify:visual-baseline-integrity — Phase N, N6.3 (awkit-vra.15.3): key handling and integrity failure
 * modes of VisualBaselineStore (plan A6, VA-14, C1).
 *
 * Every case runs on a real temporary runtime root and flows folder with the production lifecycle hooks.
 * The key protector is the verifier-only AES-GCM stand-in for `safeStorage` (tamper-evident like DPAPI).
 * The suite runs against the real store and then against variants that each remove one protection; every
 * variant must fail the suite at the named case.
 *
 * Run: npm run verify:visual-baseline-integrity
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { VisualBaselineStore, type VisualBaselineLookup } from "@src/runner/visualAssertion/VisualBaselineStore";
import { VisualBaselineLayout } from "@src/runner/visualAssertion/visualBaselineLayout";
import { SecretStore } from "@src/secrets/SecretStore";
import { approvalFor, conditions, flow, makeEnv, stepDigest, tempRoot, testProtector, type Env } from "./lib/visualBaselineKit.mts";

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
  Store?: typeof VisualBaselineStore;
  Layout?: typeof VisualBaselineLayout;
}

async function integritySuite(variant: Variant): Promise<Outcome[]> {
  const out: Outcome[] = [];
  const add = (label: string, ok: unknown, detail?: string): void => {
    out.push({ label, ok: !!ok, detail });
  };
  const fresh = async (options: { root?: string; flowsFolder?: string; mode?: "dev" | "packaged"; protector?: ReturnType<typeof testProtector> } = {}): Promise<Env> => {
    const env = makeEnv({ ...variant, ...options });
    if (!(await env.flows.get("F"))) await env.flows.create(flow("F"));
    return env;
  };
  const approve = async (env: Env, stepId = "s1", locale = "en-US") => env.store.approveUnchecked(await approvalFor(env, "F", stepId, { conditions: conditions({ locale }) }));
  const look = async (env: Env, stepId = "s1", locale = "en-US"): Promise<VisualBaselineLookup> =>
    env.store.lookup({ flowId: "F", stepId, stepContentDigest: await stepDigest(env, "F", stepId), conditions: conditions({ locale }) });
  const keysDir = (env: Env, mode = "dev"): string => join(env.root, "runtime", "visual-baselines", mode, "keys");
  const signed = (env: Env, suffix: string, stepId = "s1"): string[] => walk(join(env.root, "runtime", "visual-baselines")).filter((p) => p.endsWith(suffix) && p.includes(env.layout.stepKey(stepId)));
  const describe = (v: unknown): string => JSON.stringify(v);
  const unreadable = (v: VisualBaselineLookup, reason: string): boolean => v.status === "unreadable" && v.reason === reason;

  // 1. First use.
  {
    const env = await fresh();
    add("[first use] the key state is first-use and nothing is found", (await env.store.keyState()).state === "first-use" && (await look(env)).status === "absent");
    const r = await approve(env);
    const marker = JSON.parse(readFileSync(join(keysDir(env), "key-state.json"), "utf8")) as { generation: number };
    add("[first use] the first approval creates the key and a generation-1 marker", r.ok && existsSync(join(keysDir(env), "master-key.json")) && marker.generation === 1, describe(r));
    add("[first use] the key file never holds the raw master key", !readFileSync(join(keysDir(env), "master-key.json"), "utf8").includes("master"));
  }
  // 2. Encryption unavailable.
  {
    const env = await fresh({ protector: testProtector({ available: false }) });
    const r = await env.store.approveUnchecked(await approvalFor(env, "F", "s1", { boundKeyGeneration: 0 }));
    add("[keystore] unavailable encryption refuses approval and writes no key", !r.ok && r.refusal === "integrity-unavailable" && !existsSync(join(keysDir(env), "master-key.json")), describe(r));
    add("[keystore] unavailable encryption makes lookups integrity-unavailable", (await look(env)).status === "integrity-unavailable");
  }
  {
    const env = await fresh();
    await approve(env);
    env.protector.state.available = false;
    const commitment = await env.store.commitmentFor({ flowId: "F", stepId: "s1", stepContentDigest: await stepDigest(env, "F", "s1"), conditions: conditions(), epoch: "0".repeat(32), width: 1, height: 1, contentDigest: `sha256:${"0".repeat(64)}` });
    add("[keystore] the keystore going down after approval makes lookups integrity-unavailable and computes no commitment", (await look(env)).status === "integrity-unavailable" && !commitment.ok);
  }
  // 3-5. Key lost, unreadable, tampered.
  {
    const env = await fresh();
    await approve(env);
    rmSync(join(keysDir(env), "master-key.json"));
    const state = await env.store.keyState();
    const r = await env.store.approveUnchecked(await approvalFor(env, "F", "s1", { boundKeyGeneration: 1 }));
    add("[key lost] a deleted key with its marker present is key-lost", state.state === "unavailable" && state.reason === "key-lost", describe(state));
    add("[key lost] the key is never regenerated silently", !r.ok && r.refusal === "integrity-unavailable" && !existsSync(join(keysDir(env), "master-key.json")), describe(r));
    add("[key lost] lookups are integrity-unavailable", (await look(env)).status === "integrity-unavailable");
  }
  {
    const env = await fresh();
    await approve(env);
    const path = join(keysDir(env), "master-key.json");
    const key = JSON.parse(readFileSync(path, "utf8")) as { protectedKey: string; check: string };
    const bytes = Buffer.from(key.protectedKey, "base64");
    bytes[bytes.length - 1] ^= 0x01;
    writeFileSync(path, JSON.stringify({ ...key, protectedKey: bytes.toString("base64") }));
    const state = await env.store.keyState();
    add("[key tampered] a modified protected key is key-unreadable", state.state === "unavailable" && state.reason === "key-unreadable", describe(state));
  }
  {
    const env = await fresh();
    await approve(env);
    const path = join(keysDir(env), "master-key.json");
    const key = JSON.parse(readFileSync(path, "utf8")) as { check: string };
    writeFileSync(path, JSON.stringify({ ...key, check: "0".repeat(64) }));
    const state = await env.store.keyState();
    add("[key tampered] a modified key check is key-mismatch", state.state === "unavailable" && state.reason === "key-mismatch", describe(state));
  }
  // 6-8. Marker.
  {
    const env = await fresh();
    await approve(env);
    rmSync(join(keysDir(env), "key-state.json"));
    const state = await env.store.keyState();
    const kept = await look(env);
    const r = await approve(env, "s2");
    const marker = JSON.parse(readFileSync(join(keysDir(env), "key-state.json"), "utf8")) as { generation: number };
    add("[marker] a deleted marker with a valid key keeps the key and its approvals", state.state === "available" && state.generation === 1 && kept.status === "present", describe({ state, kept }));
    add("[marker] the next approval rewrites the marker at the same generation", r.ok && marker.generation === 1);
  }
  {
    const env = await fresh();
    await approve(env);
    writeFileSync(join(keysDir(env), "key-state.json"), JSON.stringify({ version: 1, mode: "dev", generation: 5 }));
    const mismatch = await env.store.keyState();
    writeFileSync(join(keysDir(env), "key-state.json"), "{");
    const corrupt = await env.store.keyState();
    add("[marker] a marker with another generation is key-mismatch", mismatch.state === "unavailable" && mismatch.reason === "key-mismatch", describe(mismatch));
    add("[marker] a corrupt marker is marker-unreadable, never first use", corrupt.state === "unavailable" && corrupt.reason === "marker-unreadable", describe(corrupt));
  }
  {
    const env = await fresh();
    await approve(env);
    rmSync(keysDir(env), { recursive: true, force: true });
    add("[key and marker deleted] old signed files are unreadable, never found", (await env.store.keyState()).state === "first-use" && unreadable(await look(env), "no-key"));
  }
  // 9-12. Index and record integrity.
  {
    const env = await fresh();
    await approve(env);
    writeFileSync(signed(env, ".index.json")[0], "{");
    add("[index] a corrupt index is baseline-unreadable", unreadable(await look(env), "index-corrupt"), describe(await look(env)));
  }
  {
    const env = await fresh();
    await approve(env);
    const path = signed(env, ".index.json")[0];
    const index = JSON.parse(readFileSync(path, "utf8")) as { entries: Array<{ generation: number }> };
    index.entries[0].generation += 1;
    writeFileSync(path, JSON.stringify(index));
    add("[index] a tampered index fails its MAC", unreadable(await look(env), "index-integrity-failed"), describe(await look(env)));
  }
  {
    const env = await fresh();
    await approve(env);
    rmSync(signed(env, ".record.json")[0]);
    add("[record] an index entry whose record is missing is baseline-unreadable, not no-baseline", unreadable(await look(env), "record-missing"), describe(await look(env)));
  }
  {
    const env = await fresh();
    await approve(env);
    const path = signed(env, ".record.json")[0];
    const record = JSON.parse(readFileSync(path, "utf8")) as { geometry: { x: number } };
    record.geometry.x += 1;
    writeFileSync(path, JSON.stringify(record));
    add("[record] a tampered record fails its MAC", unreadable(await look(env), "record-integrity-failed"), describe(await look(env)));
  }
  // 13-15. Replay across flows, steps and conditions.
  {
    const env = await fresh();
    await env.flows.create(flow("G"));
    await approve(env);
    const gReq = await approvalFor(env, "G", "s1");
    await env.store.approveUnchecked(gReq);
    const fDir = await env.layout.flowDirectory("dev", "F");
    const gDir = await env.layout.flowDirectory("dev", "G");
    for (const file of readdirSync(gDir)) rmSync(join(gDir, file));
    for (const file of readdirSync(fDir)) copyFileSync(join(fDir, file), join(gDir, file));
    const replayed = await env.store.lookup({ flowId: "G", stepId: "s1", stepContentDigest: await stepDigest(env, "G", "s1"), conditions: conditions() });
    add("[replay] an index and record copied onto another flow are refused", replayed.status === "unreadable", describe(replayed));
  }
  {
    const env = await fresh();
    await approve(env);
    await approve(env, "s2");
    const directory = await env.layout.flowDirectory("dev", "F");
    const s1 = env.layout.stepKey("s1");
    const s2 = env.layout.stepKey("s2");
    for (const file of readdirSync(directory).filter((f) => f.startsWith(s2))) rmSync(join(directory, file));
    for (const file of readdirSync(directory).filter((f) => f.startsWith(s1))) copyFileSync(join(directory, file), join(directory, file.replace(s1, s2)));
    const replayed = await look(env, "s2");
    add("[replay] an index and record copied onto another step are refused", replayed.status === "unreadable", describe(replayed));
  }
  {
    const env = await fresh();
    const english = await approve(env);
    const german = await approve(env, "s1", "de-DE");
    const directory = await env.layout.flowDirectory("dev", "F");
    const s1 = env.layout.stepKey("s1");
    if (english.ok && german.ok) copyFileSync(join(directory, `${s1}.${german.approvalId}.record.json`), join(directory, `${s1}.${english.approvalId}.record.json`));
    add("[replay] a record of other conditions substituted for this one is refused", unreadable(await look(env), "record-replayed"), describe(await look(env)));
  }
  // 16. Restore of older records and indexes.
  {
    const env = await fresh();
    const first = await approve(env);
    const directory = await env.layout.flowDirectory("dev", "F");
    const s1 = env.layout.stepKey("s1");
    const oldIndex = readFileSync(join(directory, `${s1}.index.json`), "utf8");
    const oldRecordName = first.ok ? `${s1}.${first.approvalId}.record.json` : "";
    const oldRecord = readFileSync(join(directory, oldRecordName), "utf8");
    const second = await approve(env);
    writeFileSync(join(directory, oldRecordName), oldRecord);
    const afterRecordRestore = await look(env);
    add("[restore] an older record restored beside a newer index is ignored", second.ok && afterRecordRestore.status === "present" && second.generation === 2, describe(afterRecordRestore));
    writeFileSync(join(directory, `${s1}.index.json`), oldIndex);
    rmSync(join(directory, oldRecordName));
    add("[restore] an older index restored without its record is unreadable", unreadable(await look(env), "record-missing"), describe(await look(env)));
    writeFileSync(join(directory, oldRecordName), oldRecord);
    add("[restore] RESIDUAL: an index and record restored together are not detectable locally (VA-14)", (await look(env)).status === "present");
  }
  // 17. Cross-mode substitution.
  {
    const root = tempRoot("modes");
    const dev = await fresh({ root });
    await approve(dev);
    const packaged = makeEnv({ ...variant, root, mode: "packaged" });
    mkdirSync(keysDir(packaged, "packaged"), { recursive: true });
    copyFileSync(join(keysDir(dev), "master-key.json"), join(keysDir(packaged, "packaged"), "master-key.json"));
    const substituted = await packaged.store.keyState();
    add("[modes] a dev key copied into the packaged key file is refused", substituted.state === "unavailable" && substituted.reason === "key-mismatch", describe(substituted));
    rmSync(join(keysDir(packaged, "packaged"), "master-key.json"));
    await packaged.store.approveUnchecked(await approvalFor(packaged, "F", "s2"));
    const devDir = await dev.layout.flowDirectory("dev", "F");
    const packagedDir = await packaged.layout.flowDirectory("packaged", "F");
    for (const file of readdirSync(devDir)) copyFileSync(join(devDir, file), join(packagedDir, file));
    const copied = await packaged.store.lookup({ flowId: "F", stepId: "s1", stepContentDigest: await stepDigest(dev, "F", "s1"), conditions: conditions() });
    add("[modes] dev signed files copied into the packaged tree are refused", copied.status === "unreadable", describe(copied));
  }
  // 18. Leftovers of another epoch, sweep and idempotence.
  {
    const env = await fresh();
    await approve(env);
    const tokenPath = join(env.flowsFolder, ".awkit-visual", "epochs", `${env.layout.flowKey("F")}.token`);
    writeFileSync(tokenPath, JSON.stringify({ version: 1, flowId: "F", token: "f".repeat(32) }));
    add("[epoch] files of an older epoch are ignored, never revived", (await look(env)).status === "absent", describe(await look(env)));
    const first = await env.store.sweep();
    const again = await env.store.sweep();
    add("[sweep] the sweep deletes the older epoch's files", first.deleted >= 2 && signed(env, ".json").length === 0, `${first.deleted}, left ${signed(env, ".json").length}`);
    add("[sweep] a second sweep deletes nothing (idempotent)", again.deleted === 0, String(again.deleted));
  }
  // 19. Reset and generations.
  {
    const env = await fresh();
    await approve(env);
    const stale = await approvalFor(env, "F", "s1");
    const reset = await env.store.resetUnchecked();
    const afterReset = await look(env);
    const staleApproval = await env.store.approveUnchecked(stale);
    const freshApproval = await approve(env);
    const second = await env.store.resetUnchecked();
    add("[reset] a reset moves to the next generation and removes every approval", reset.generation === 2 && afterReset.status === "absent", describe({ reset, afterReset }));
    add("[reset] a candidate bound before a reset is refused", !staleApproval.ok && staleApproval.refusal === "stale-key-generation", describe(staleApproval));
    add("[reset] a fresh candidate after the reset is approved under the new generation", freshApproval.ok && freshApproval.keyGeneration === 2 && second.generation === 3, describe(freshApproval));
  }
  // 20. Two flows folders of one mode create one key.
  {
    const root = tempRoot("onekey");
    const a = makeEnv({ ...variant, root, flowsFolder: join(root, "flows-a") });
    const b = makeEnv({ ...variant, root, flowsFolder: join(root, "flows-b") });
    await a.flows.create(flow("F"));
    await b.flows.create(flow("F"));
    // Both candidates are bound during first use (generation 0) BEFORE either approval starts, so the race is the
    // real one: whichever approval creates the first key, the other must still be accepted.
    const [qa, qb] = [await approvalFor(a, "F", "s1"), await approvalFor(b, "F", "s1")];
    const [ra, rb] = await Promise.all([a.store.approveUnchecked(qa), b.store.approveUnchecked(qb)]);
    add(
      "[keys] two concurrent first approvals in two flows folders share one key",
      qa.boundKeyGeneration === 0 && qb.boundKeyGeneration === 0 && ra.ok && rb.ok && (await look(a)).status === "present" && (await look(b)).status === "present",
      describe({ ra, rb })
    );
    // A first-use candidate is stale once a reset (generation 2 or later) happened after its capture.
    await a.flows.create(flow("G"));
    const firstUse = { ...(await approvalFor(a, "G", "s1")), boundKeyGeneration: 0 };
    await a.store.resetUnchecked();
    const afterReset = await a.store.approveUnchecked({ ...firstUse, epoch: await a.store.ensureToken("G"), boundEpoch: await a.store.ensureToken("G") });
    add("[keys] a candidate bound before the first key is refused after a reset", !afterReset.ok && afterReset.refusal === "stale-key-generation", describe(afterReset));
  }
  return out;
}

// ── Variants that each remove one protection ────────────────────────────────────────────────────────────

class RegenerateLostKeyStore extends VisualBaselineStore {
  protected override async loadKeys() {
    const loaded = await super.loadKeys();
    return loaded.state === "unavailable" && loaded.reason === "key-lost" ? ({ state: "first-use" } as const) : loaded;
  }
}
class MissingRecordAsAbsentStore extends VisualBaselineStore {
  override async lookup(request: Parameters<VisualBaselineStore["lookup"]>[0]): Promise<VisualBaselineLookup> {
    const result = await super.lookup(request);
    return result.status === "unreadable" && result.reason === "record-missing" ? { status: "absent" } : result;
  }
}
class UnsignedEntriesStore extends VisualBaselineStore {
  protected override indexMacFields(index: never) {
    return (super.indexMacFields(index) as (string | number)[]).slice(0, -1);
  }
}
class ReplayAcceptedStore extends VisualBaselineStore {
  override async lookup(request: Parameters<VisualBaselineStore["lookup"]>[0]): Promise<VisualBaselineLookup> {
    const result = await super.lookup(request);
    return result.status === "unreadable" && result.reason === "record-replayed" ? { status: "present", conditions: request.conditions, geometry: { x: 0, y: 0, width: 1, height: 1, clipped: false, hover: false, focus: false }, commitment: "0".repeat(64) } : result;
  }
}
class StaleTokenLayout extends VisualBaselineLayout {
  private readonly seen = new Map<string, string | null>();
  override async readToken(flowId: string): Promise<string | null> {
    if (!this.seen.has(flowId) || this.seen.get(flowId) === null) this.seen.set(flowId, await super.readToken(flowId));
    return this.seen.get(flowId) ?? null;
  }
}
class NoSweepStore extends VisualBaselineStore {
  override sweep(): Promise<{ deleted: number }> {
    return Promise.resolve({ deleted: 0 });
  }
}

console.log("verify:visual-baseline-integrity — N6.3 keys and integrity failure modes\n");

// The general secrets subsystem cannot reach the N6 key (C1).
{
  const env = makeEnv();
  await env.flows.create(flow("F"));
  await env.store.approveUnchecked(await approvalFor(env, "F", "s1"));
  const secrets = new SecretStore(join(env.root, "runtime", "secrets.json"), { isAvailable: () => true, encrypt: (s) => Buffer.from(s), decrypt: (b) => b.toString() });
  const names = ["master-key", "master-key.json", "awkit-n6-master", "visual-baselines", "key-state"];
  check("[secrets] the N6 key is not in the general secret store: none listed, no N6 name resolves", secrets.list().length === 0 && names.every((n) => secrets.get(n) === undefined));
  check("[secrets] no secrets.json was written by N6", !existsSync(join(env.root, "runtime", "secrets.json")));
  const sources = ["src/runner/visualAssertion/VisualBaselineStore.ts", "src/runner/visualAssertion/visualBaselineLayout.ts", "src/runner/visualAssertion/flowBaselineLifecycle.ts", "app/main/visualAssertion/visualBaselineKeyProtector.ts"].map((p) => readFileSync(join(process.cwd(), p), "utf8"));
  check("[secrets] no N6 module imports the general secret store", sources.every((s) => !/secretStore|SecretStore\b/.test(s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""))));
  const adapter = sources[3];
  const adapterCode = adapter.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  check(
    "[secrets] the production protector is safeStorage behind the availability capability, with no override or fallback branch",
    /safeStorage\.encryptString/.test(adapterCode) && /safeStorage\.decryptString/.test(adapterCode) && /getSecretStorageCapability\(\)\.isEncryptionAvailable\(\)/.test(adapterCode) && !/process\.env|\bif\s*\(|\?\?|\|\|/.test(adapterCode)
  );
  check("[secrets] no IPC channel exposes the store, its reset or its approval in N6.3", !readFileSync(join(process.cwd(), "app", "main", "preload.ts"), "utf8").includes("visualBaseline"));
}

for (const outcome of await integritySuite({})) check(outcome.label, outcome.ok, outcome.ok ? undefined : outcome.detail);

console.log("\n  mutants (each must FAIL the suite)");
const mutants: Array<[string, Variant, string]> = [
  ["a lost key is regenerated", { Store: RegenerateLostKeyStore }, "[key lost] the key is never regenerated silently"],
  ["a missing record reads as no baseline", { Store: MissingRecordAsAbsentStore }, "[record] an index entry whose record is missing"],
  ["the index MAC does not cover its entries", { Store: UnsignedEntriesStore }, "[index] a tampered index fails its MAC"],
  ["a replayed record is accepted", { Store: ReplayAcceptedStore }, "[replay] a record of other conditions"],
  ["files of another epoch are accepted", { Layout: StaleTokenLayout }, "[epoch] files of an older epoch are ignored"],
  ["the sweep is skipped", { Store: NoSweepStore }, "[sweep] the sweep deletes the older epoch's files"]
];
for (const [name, variant, mustFail] of mutants) {
  const failing = (await integritySuite(variant)).filter((o) => !o.ok).map((o) => o.label);
  check(`MUTATION: ${name} fails the suite (${failing.length} checks, including "${mustFail}")`, failing.some((label) => label.startsWith(mustFail)), failing.join("; ") || "nothing failed");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
