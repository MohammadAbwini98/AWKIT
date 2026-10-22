/**
 * verify:visual-baseline-store — Phase N, N6.3 (awkit-vra.15.3): what VisualBaselineStore persists and
 * how its equality commitments behave (plan A4, VA-5, VA-6).
 *
 * Real filesystem, real JsonProfileStore with the production lifecycle hooks, real HMACs over real N1
 * content digests of synthetic images, and the N6.2 policy deciding equality from the store's output.
 * The suite runs against the real store and then against subclasses that each break one invariant; every
 * mutant must fail the suite at the named check.
 *
 * Run: npm run verify:visual-baseline-store
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { visualStepContentDigest } from "@src/runner/visualAssertion/stepContentDigest";
import { VISUAL_BASELINE_CONDITION_KEYS, VisualBaselineStore, encodeFields, type VisualBaselineApprovalRequest, type VisualBaselineCommitmentParts } from "@src/runner/visualAssertion/VisualBaselineStore";
import { VISUAL_ASSERTION_CONDITION_KEYS, decideVisualAssertion } from "@src/visual/assertion/decideVisualAssertion";
import { PIXELS, approvalFor, conditions, flow, geometry, makeEnv, step, stepDigest } from "./lib/visualBaselineKit.mts";

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
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

const RECORD_KEYS = "approval,approvalId,commitment,conditions,conditionsKey,epoch,flowId,folderKey,generation,geometry,imageHeight,imageWidth,keyGeneration,kind,mac,mode,stepContentDigest,stepId,version";
const INDEX_KEYS = "entries,epoch,flowId,folderKey,generation,keyGeneration,kind,mac,mode,stepId,version";

async function storeSuite(Store: typeof VisualBaselineStore): Promise<Outcome[]> {
  const out: Outcome[] = [];
  const add = (label: string, ok: unknown, detail?: string): void => {
    out.push({ label, ok: !!ok, detail });
  };
  const env = makeEnv({ Store });
  await env.flows.create(flow("F", [step("s1"), step("s2")]));

  add("first use: the key generation a candidate binds is 0", (await env.store.keyGeneration()) === 0);
  const first = await env.store.approveUnchecked(await approvalFor(env, "F", "s1"));
  add("the first approval succeeds and creates key generation 1", first.ok && first.generation === 1 && first.keyGeneration === 1, JSON.stringify(first));

  const d1 = await stepDigest(env, "F", "s1");
  const token = (await env.layout.readToken("F")) ?? "";
  const lookup = await env.store.lookup({ flowId: "F", stepId: "s1", stepContentDigest: d1, conditions: conditions() });
  add("lookup finds the approval", lookup.status === "present", JSON.stringify(lookup));

  const parts = (contentDigest: string, extra: Partial<VisualBaselineCommitmentParts> = {}): VisualBaselineCommitmentParts => ({
    flowId: "F",
    stepId: "s1",
    stepContentDigest: d1,
    conditions: conditions(),
    epoch: token,
    width: 48,
    height: 40,
    contentDigest,
    ...extra
  });
  const commit = async (p: VisualBaselineCommitmentParts): Promise<string> => {
    const result = await env.store.commitmentFor(p);
    return result.ok ? result.commitment : `unavailable:${result.status}`;
  };
  const decide = async (contentDigest: string) =>
    decideVisualAssertion({
      version: 1,
      capture: { ok: true, observation: { conditions: conditions(), geometry: geometry(), commitment: await commit(parts(contentDigest)) } as never },
      baseline: lookup as never
    });
  const same = await decide(PIXELS.same);
  add("[A4] identical pixels pass through the N6.2 policy", same.verdict === "passed" && same.code === "identical-to-baseline", JSON.stringify(same));
  const onePixel = await decide(PIXELS.onePixel);
  add("[A4] one changed pixel fails through the N6.2 policy", onePixel.verdict === "failed" && onePixel.code === "differs-from-baseline", JSON.stringify(onePixel));

  const otherConditions = await env.store.lookup({ flowId: "F", stepId: "s1", stepContentDigest: d1, conditions: conditions({ locale: "de-DE" }) });
  add("other conditions are other-conditions, never a guessed record", otherConditions.status === "other-conditions", JSON.stringify(otherConditions));
  const changed = await env.store.lookup({ flowId: "F", stepId: "s1", stepContentDigest: "ab".repeat(32), conditions: conditions() });
  add("another step content digest is binding-changed", changed.status === "binding-changed", JSON.stringify(changed));

  // Unlinkability: identical pixels on two steps, across epochs and across conditions.
  const second = await env.store.approveUnchecked(await approvalFor(env, "F", "s2"));
  add("a second step with identical pixels is approved", second.ok);
  const commitments = walk(env.root)
    .filter((path) => path.endsWith(".record.json"))
    .map((path) => (JSON.parse(readFileSync(path, "utf8")) as { stepId: string; commitment: string }));
  const c1 = commitments.find((c) => c.stepId === "s1")?.commitment;
  const c2 = commitments.find((c) => c.stepId === "s2")?.commitment;
  add("[A4] identical images on two steps have unlinkable commitments", !!c1 && !!c2 && c1 !== c2, `${c1} / ${c2}`);
  add("[A4] the same capture under another step id has another commitment", (await commit(parts(PIXELS.same))) !== (await commit(parts(PIXELS.same, { stepId: "s9" }))));
  add("[A4] the same capture in another flow has another commitment", (await commit(parts(PIXELS.same))) !== (await commit(parts(PIXELS.same, { flowId: "G" }))));
  add("[A4] the same capture in another epoch has another commitment", (await commit(parts(PIXELS.same))) !== (await commit(parts(PIXELS.same, { epoch: "0".repeat(32) }))));
  add("[A4] the same capture under other conditions has another commitment", (await commit(parts(PIXELS.same))) !== (await commit(parts(PIXELS.same, { conditions: conditions({ locale: "de-DE" }) }))));
  add(
    "[A4] the ambiguous id pair (ab + c, a + bc) has distinct commitments",
    (await commit(parts(PIXELS.same, { flowId: "ab", stepId: "c" }))) !== (await commit(parts(PIXELS.same, { flowId: "a", stepId: "bc" })))
  );

  // Generations, entries per conditions, superseded records.
  const again = await env.store.approveUnchecked(await approvalFor(env, "F", "s1"));
  add("re-approval writes the next generation", again.ok && again.generation === 2, JSON.stringify(again));
  const s1Key = env.layout.stepKey("s1");
  const s1Records = (): number => walk(env.root).filter((p) => p.endsWith(".record.json") && p.includes(s1Key)).length;
  add("re-approval removes the superseded record", s1Records() === 1, String(s1Records()));
  const german = await env.store.approveUnchecked(await approvalFor(env, "F", "s1", { conditions: conditions({ locale: "de-DE" }) }));
  const both =
    german.ok &&
    (await env.store.lookup({ flowId: "F", stepId: "s1", stepContentDigest: d1, conditions: conditions() })).status === "present" &&
    (await env.store.lookup({ flowId: "F", stepId: "s1", stepContentDigest: d1, conditions: conditions({ locale: "de-DE" }) })).status === "present";
  add("one step keeps one approval per conditions key", both && s1Records() === 2);

  // What is on disk.
  const files = walk(env.root);
  const bodies = files.map((path) => readFileSync(path));
  const hexes = [PIXELS.baseline, PIXELS.onePixel].map((d) => d.slice("sha256:".length));
  add("[A4] no file holds a raw content digest", bodies.every((b) => hexes.every((hex) => !b.includes(hex)) && !b.includes("sha256:")));
  add("[A4] no file holds PNG bytes", bodies.every((b) => !b.includes(Buffer.from([0x89, 0x50, 0x4e, 0x47]))));
  const records = files.filter((p) => p.endsWith(".record.json")).map((p) => JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>);
  add("[A4] every record holds exactly the allowlisted fields (no grid, dHash, image or digest)", records.length > 0 && records.every((r) => Object.keys(r).sort().join(",") === RECORD_KEYS), records.map((r) => Object.keys(r).sort().join(",")).find((k) => k !== RECORD_KEYS));
  const indexes = files.filter((p) => p.endsWith(".index.json")).map((p) => JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>);
  add("every index holds exactly the allowlisted fields", indexes.length > 0 && indexes.every((r) => Object.keys(r).sort().join(",") === INDEX_KEYS));
  add("signed files live under the runtime root's mode folder, tokens and locks in the flows folder", files.some((p) => p.includes(join("runtime", "visual-baselines", "dev"))) && files.some((p) => p.includes(join("flows", ".awkit-visual", "epochs"))));

  // Refusals of malformed approvals.
  const clipped = await env.store.approveUnchecked({ ...(await approvalFor(env, "F", "s1")), geometry: geometry({ clipped: true }) } as VisualBaselineApprovalRequest);
  add("a clipped capture is never approved", !clipped.ok && clipped.refusal === "invalid-request");
  const rawDigest = await env.store.approveUnchecked({ ...(await approvalFor(env, "F", "s1")), contentDigest: "not-a-digest" });
  add("a malformed content digest is refused", !rawDigest.ok && rawDigest.refusal === "invalid-request");
  return out;
}

// ── Mutants: each breaks one invariant of the real store ────────────────────────────────────────────────

class RawDigestStore extends VisualBaselineStore {
  private last = "";
  override approveUnchecked(request: VisualBaselineApprovalRequest) {
    this.last = request.contentDigest;
    return super.approveUnchecked(request);
  }
  protected override persistedRecord(keys: never, unsigned: never) {
    return { ...(super.persistedRecord(keys, unsigned) as object), contentDigest: this.last } as never;
  }
}
class NoStepIdStore extends VisualBaselineStore {
  protected override commitmentFields(parts: VisualBaselineCommitmentParts) {
    return super.commitmentFields(parts).filter((_, index) => index !== 2);
  }
}
class NoLengthPrefixStore extends VisualBaselineStore {
  protected override commitmentFields(parts: VisualBaselineCommitmentParts) {
    return [super.commitmentFields(parts).join("")];
  }
}
class NoEpochStore extends VisualBaselineStore {
  protected override commitmentFields(parts: VisualBaselineCommitmentParts) {
    return super.commitmentFields(parts).filter((_, index) => index !== 5);
  }
}
class NoConditionsStore extends VisualBaselineStore {
  protected override commitmentFields(parts: VisualBaselineCommitmentParts) {
    return super.commitmentFields(parts).filter((_, index) => index !== 4);
  }
}

console.log("verify:visual-baseline-store — N6.3 store contents and equality commitments\n");

check(
  "pin: the store's conditions keys equal the N6.2 policy's, in order",
  VISUAL_BASELINE_CONDITION_KEYS.join() === Object.keys(VISUAL_ASSERTION_CONDITION_KEYS).join(),
  VISUAL_BASELINE_CONDITION_KEYS.join()
);
check("encodeFields is length-prefixed (ab + c differs from a + bc)", !encodeFields(["ab", "c"]).equals(encodeFields(["a", "bc"])));
const s = { id: "s", type: "click", name: "n", description: "d", position: { x: 1, y: 2 }, locator: { strategy: "css", value: "#a" } } as Record<string, unknown> & { id: string };
check(
  "the step digest ignores mode, name, description and position (observe to enforce keeps the approval)",
  visualStepContentDigest(s) === visualStepContentDigest({ ...s, mode: "enforce", name: "renamed", description: "x", position: { x: 9, y: 9 } })
);
check("the step digest covers the locator", visualStepContentDigest(s) !== visualStepContentDigest({ ...s, locator: { strategy: "css", value: "#b" } }));
check("the step digest is key-order independent", visualStepContentDigest({ id: "s", a: 1, b: 2 }) === visualStepContentDigest({ b: 2, id: "s", a: 1 }));

const factory = readFileSync(join(process.cwd(), "app", "main", "profileStores.ts"), "utf8");
const flowFactory = /export function createFlowProfileStore\(\)[\s\S]*?\n}/.exec(factory)?.[0] ?? "";
check("the production flow store factory installs the lifecycle hooks", /hooks:\s*createFlowBaselineHooks\(/.test(flowFactory));
check("no other production store installs hooks", (factory.match(/hooks:/g) ?? []).length === 1);

for (const outcome of await storeSuite(VisualBaselineStore)) check(outcome.label, outcome.ok, outcome.ok ? undefined : outcome.detail);

console.log("\n  mutants (each must FAIL the suite)");
const mutants: Array<[string, typeof VisualBaselineStore, string]> = [
  ["the record keeps the raw content digest", RawDigestStore, "[A4] no file holds a raw content digest"],
  ["the commitment drops the step id", NoStepIdStore, "[A4] the same capture under another step id"],
  ["the commitment concatenates without lengths", NoLengthPrefixStore, "[A4] the ambiguous id pair"],
  ["the commitment drops the epoch", NoEpochStore, "[A4] the same capture in another epoch"],
  ["the commitment drops the conditions", NoConditionsStore, "[A4] the same capture under other conditions"]
];
for (const [name, Store, mustFail] of mutants) {
  const failing = (await storeSuite(Store)).filter((o) => !o.ok).map((o) => o.label);
  check(`MUTATION: ${name} fails the suite (${failing.length} checks, including "${mustFail}")`, failing.some((label) => label.startsWith(mustFail)), failing.join("; ") || "nothing failed");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
