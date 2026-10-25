/**
 * verify:visual-assertion-candidates — Phase N, N6.5 (awkit-vra.15.5): the pending-candidate approval surface.
 *
 * Drives the exact Electron-free service behind the `visualAssertion:*` channels
 * (`src/runner/visualAssertion/visualAssertionApproval.ts`) against a real flow store with the production lifecycle
 * hooks, a real VisualBaselineStore and the verifier-only key protector. Covers listing (no digest, token or pixels),
 * preview (valid PNG, not consuming, size cap), atomic single-use approval and rejection, replay, expiry, stale epoch,
 * content, key generation and existence, the unavailable keystore, reset and key rotation, and the audit trail.
 *
 * A static part pins the integration boundary: every channel's permission and re-authentication, no grant issuance or
 * sweep reachable from IPC, the preload surface, and no secret field in the Designer section.
 *
 * The suite then runs against variants that each remove one protection; every variant must fail it.
 *
 * Run: npm run verify:visual-assertion-candidates
 */

import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { decodePng } from "@src/visual/png";
import {
  approveVisualCandidate,
  listVisualCandidates,
  previewVisualCandidate,
  rejectVisualCandidate,
  resetVisualBaselines,
  type VisualApprovalAuditEntry,
  type VisualApprovalDeps
} from "@src/runner/visualAssertion/visualAssertionApproval";
import { VisualAssertionCandidates, type VisualCandidateInput } from "@src/runner/visualAssertion/visualAssertionCandidates";
import { PIXELS, conditions, flow, geometry, makeEnv, step, stepDigest, within, type Env } from "./lib/visualBaselineKit.mts";

type Outcome = { label: string; ok: boolean; detail?: string };

const ROOT = process.cwd();
const GUARD_MS = 15000;
const AUTHOR = { userId: "author-1", username: "Author One" };
const RUNNER = { userId: "runner-1", username: "Runner One" };

interface Variant {
  name: string;
  Candidates?: typeof VisualAssertionCandidates;
  /** Rewrites a service response before the suite sees it. */
  leak?: (response: unknown) => unknown;
}

function rgba(width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (i / 4) % 251;
    data[i + 1] = 17;
    data[i + 2] = 99;
    data[i + 3] = 255;
  }
  return data;
}

async function capture(env: Env, flowId: string, stepId: string, extra: Partial<VisualCandidateInput> = {}): Promise<VisualCandidateInput> {
  const epoch = await env.store.ensureToken(flowId);
  const keyGeneration = (await env.store.keyGeneration()) ?? -1;
  return {
    executionId: "run-1",
    instanceId: "instance-1",
    flowId,
    stepId,
    mode: "observe",
    reason: "no-baseline",
    epoch,
    stepContentDigest: await stepDigest(env, flowId, stepId),
    conditions: conditions(),
    geometry: geometry(),
    keyGeneration,
    initiator: RUNNER,
    contentDigest: PIXELS.baseline,
    width: 48,
    height: 40,
    preview: { width: 48, height: 40, rgba: rgba(48, 40) },
    ...extra
  };
}

const SECRET_KEYS = ["contentDigest", "stepContentDigest", "epoch", "preview", "rgba", "commitment", "key", "initiator", "geometry", "conditions"];

function secretsIn(value: unknown, secrets: string[]): string[] {
  const text = JSON.stringify(value) ?? "";
  const found = secrets.filter((s) => s.length > 0 && text.includes(s));
  const walk = (v: unknown): void => {
    if (!v || typeof v !== "object") return;
    for (const [k, inner] of Object.entries(v as Record<string, unknown>)) {
      if (SECRET_KEYS.includes(k)) found.push(`key:${k}`);
      walk(inner);
    }
  };
  walk(value);
  return found;
}

async function suite(variant: Variant): Promise<Outcome[]> {
  const out: Outcome[] = [];
  const add = (label: string, ok: unknown, detail?: string): void => {
    out.push({ label, ok: !!ok, detail });
  };
  const leak = variant.leak ?? ((r: unknown) => r);
  const CandidatesClass = variant.Candidates ?? VisualAssertionCandidates;

  const setup = (options: { now?: () => number } = {}) => {
    const env = makeEnv();
    const candidates = new CandidatesClass({ now: options.now });
    const audit: VisualApprovalAuditEntry[] = [];
    const deps: VisualApprovalDeps = {
      store: env.store,
      candidates,
      appVersion: "0.1.53",
      audit: async (entry) => {
        audit.push(entry);
      }
    };
    return { env, candidates, audit, deps };
  };
  const present = async (env: Env, flowId: string, stepId: string): Promise<boolean> =>
    (await env.store.lookup({ flowId, stepId, stepContentDigest: await stepDigest(env, flowId, stepId), conditions: conditions() })).status === "present";
  const g = <T,>(label: string, p: Promise<T>): Promise<T> => within(GUARD_MS, p, label);

  // C1 listing: summaries only, filtered.
  {
    const { env, candidates, deps } = setup();
    await env.flows.create(flow("F"));
    await env.flows.create(flow("G"));
    const input = await capture(env, "F", "s1");
    candidates.add(input);
    candidates.add(await capture(env, "F", "s2"));
    candidates.add(await capture(env, "G", "s1"));
    const all = leak(listVisualCandidates(deps)) as ReturnType<typeof listVisualCandidates>;
    const one = listVisualCandidates(deps, { flowId: "F", stepId: "s1" });
    add("[list] every candidate is listed and the flow/step filter narrows it", all.length === 3 && one.length === 1 && one[0].flowId === "F" && one[0].stepId === "s1");
    const leaked = secretsIn(all, [input.contentDigest, input.stepContentDigest, input.epoch]);
    add("[list] summaries carry no digest, epoch token, pixels, geometry, conditions or user id", leaked.length === 0, leaked.join(", "));
    add("[list] a summary names the run's user for display", all.every((c) => c.runUsername === RUNNER.username));
  }

  // C2 preview: a valid PNG of the crop, not consuming, audited without secrets.
  {
    const { env, candidates, deps, audit } = setup();
    await env.flows.create(flow("F"));
    const input = await capture(env, "F", "s1");
    const id = candidates.add(input);
    const r = leak(await previewVisualCandidate(deps, AUTHOR, id)) as Awaited<ReturnType<typeof previewVisualCandidate>>;
    let decoded = false;
    if (r.ok) {
      const image = decodePng(Buffer.from(r.pngBase64, "base64"));
      decoded = image.width === 48 && image.height === 40 && Buffer.from(image.data).equals(Buffer.from(input.preview.rgba));
    }
    add("[preview] returns a PNG that decodes to exactly the candidate's crop", r.ok && r.code === "previewed" && decoded);
    add("[preview] does not consume the candidate", candidates.peek(id) !== undefined);
    const leaked = secretsIn({ ...r, pngBase64: undefined }, [input.contentDigest, input.stepContentDigest, input.epoch]);
    add("[preview] the answer carries no digest or token", leaked.length === 0, leaked.join(", "));
    const entry = audit.find((a) => a.eventType === "VISUAL_CANDIDATE_PREVIEWED");
    add("[preview] is audited with the actor, flow and step", entry?.actor.userId === AUTHOR.userId && entry.detail.flowId === "F" && entry.detail.stepId === "s1");
    add("[audit] audit details carry no digest or epoch token", secretsIn(audit.map((a) => a.detail), [input.contentDigest, input.stepContentDigest, input.epoch]).filter((s) => !s.startsWith("key:")).length === 0);
    const big = candidates.add(await capture(env, "F", "s2", { preview: { width: 4096, height: 1025, rgba: new Uint8Array(0) } }));
    add("[preview] a preview above the pixel cap is refused, not scaled", (await previewVisualCandidate(deps, AUTHOR, big)).code === "preview-too-large");
    const bad = candidates.add(await capture(env, "F", "s2", { preview: { width: 10, height: 10, rgba: new Uint8Array(7) } }));
    add("[preview] inconsistent preview pixels answer a code, never a throw", (await previewVisualCandidate(deps, AUTHOR, bad)).code === "preview-unavailable");
    add("[preview] an unknown or malformed id is candidate-unavailable", (await previewVisualCandidate(deps, AUTHOR, "0".repeat(32))).code === "candidate-unavailable" && (await previewVisualCandidate(deps, AUTHOR, { id })).code === "candidate-unavailable");
  }

  // C3 first approval creates the key; approver and run user are distinct and audited; replay fails.
  {
    const { env, candidates, deps, audit } = setup();
    await env.flows.create(flow("F"));
    const input = await capture(env, "F", "s1");
    add("[approve] the capture is bound to key generation 0 before any key exists", input.keyGeneration === 0);
    const id = candidates.add(input);
    const r = leak(await g("approve", approveVisualCandidate(deps, AUTHOR, id))) as Awaited<ReturnType<typeof approveVisualCandidate>>;
    add("[approve] the first approval succeeds and creates key generation 1", r.ok && r.code === "approved" && (await env.store.keyGeneration()) === 1);
    add("[approve] the approval is readable as present", await present(env, "F", "s1"));
    add("[approve] the answer carries no digest or token", secretsIn(r, [input.contentDigest, input.stepContentDigest, input.epoch]).length === 0);
    const entry = audit.find((a) => a.eventType === "VISUAL_CANDIDATE_APPROVED");
    add(
      "[audit] the approval records the approver, the authenticated run user, flow, step and conditions key",
      entry?.result === "success" &&
        entry.detail.approverId === AUTHOR.userId &&
        entry.detail.runUserId === RUNNER.userId &&
        entry.detail.flowId === "F" &&
        entry.detail.stepId === "s1" &&
        typeof entry.detail.conditionsKey === "string" &&
        String(entry.detail.conditionsKey).length === 16
    );
    add("[audit] an ordinary approval is audited as not replacing an unreadable baseline", entry?.detail.replacedUnreadable === false);
    add("[replay] approving the same candidate again is candidate-unavailable", (await approveVisualCandidate(deps, AUTHOR, id)).code === "candidate-unavailable");
    add("[replay] a consumed candidate is no longer listed", listVisualCandidates(deps).length === 0);
  }

  // C4 concurrent approvals of one candidate: exactly one wins.
  {
    const { env, candidates, deps } = setup();
    await env.flows.create(flow("F"));
    const id = candidates.add(await capture(env, "F", "s1"));
    const results = await g("concurrent", Promise.all([approveVisualCandidate(deps, AUTHOR, id), approveVisualCandidate(deps, AUTHOR, id), rejectVisualCandidate(deps, AUTHOR, id)]));
    const wins = results.filter((x) => x.ok).length;
    add("[single-use] three concurrent uses of one candidate: exactly one succeeds", wins === 1 && results.filter((x) => x.code === "candidate-unavailable").length === 2);
  }

  // C5 expiry.
  {
    let clock = 1_000_000;
    const { env, candidates, deps } = setup({ now: () => clock });
    await env.flows.create(flow("F"));
    const id = candidates.add(await capture(env, "F", "s1"));
    clock += 30 * 60 * 1000;
    add("[expiry] a candidate at its 30-minute expiry cannot be previewed or approved", (await previewVisualCandidate(deps, AUTHOR, id)).code === "candidate-unavailable" && (await approveVisualCandidate(deps, AUTHOR, id)).code === "candidate-unavailable");
    add("[expiry] nothing was approved", !(await present(env, "F", "s1")));
  }

  // C6 stale epoch: the flow was re-imported after capture.
  {
    const { env, candidates, deps, audit } = setup();
    await env.flows.create(flow("F"));
    const id = candidates.add(await capture(env, "F", "s1"));
    await env.flows.import(flow("F"));
    const r = await approveVisualCandidate(deps, AUTHOR, id);
    add("[stale] an import after capture refuses the approval as stale-epoch", r.code === "stale-epoch" && !(await present(env, "F", "s1")));
    add("[stale] a refused approval still consumes the candidate", candidates.peek(id) === undefined);
    add("[audit] a refused approval is audited as a failure with its reason", audit.some((a) => a.eventType === "VISUAL_CANDIDATE_APPROVAL_REFUSED" && a.result === "failure" && a.reasonCode === "stale-epoch"));
  }

  // C7 stale content: the step's locator changed after capture.
  {
    const { env, candidates, deps } = setup();
    await env.flows.create(flow("F"));
    const id = candidates.add(await capture(env, "F", "s1"));
    await env.flows.update("F", flow("F", [step("s1", { locator: { strategy: "css", value: "#moved" } }), step("s2")]));
    add("[stale] an edit of the step after capture refuses the approval as stale-content", (await approveVisualCandidate(deps, AUTHOR, id)).code === "stale-content");
  }

  // C8 existence: the step and the flow are gone.
  {
    const { env, candidates, deps } = setup();
    await env.flows.create(flow("F"));
    const stepGone = candidates.add(await capture(env, "F", "s2"));
    const flowGone = candidates.add(await capture(env, "F", "s1"));
    await env.flows.update("F", flow("F", [step("s1")]));
    const s = await approveVisualCandidate(deps, AUTHOR, stepGone);
    add("[existence] a step removed after capture refuses the approval as step-missing", s.code === "step-missing", s.code);
    // Removed outside AWKIT, so the epoch token survives and only the existence check can refuse it.
    rmSync(join(env.flowsFolder, "F.json"));
    const r = await approveVisualCandidate(deps, AUTHOR, flowGone);
    add("[existence] a flow removed after capture refuses the approval as flow-missing", r.code === "flow-missing", r.code);
    await env.flows.create(flow("H"));
    const deleted = candidates.add(await capture(env, "H", "s1"));
    await env.flows.delete("H");
    const d = await approveVisualCandidate(deps, AUTHOR, deleted);
    add("[existence] a flow deleted through AWKIT after capture refuses the approval (its token is gone)", d.code === "stale-epoch", d.code);
  }

  // C9 reset rotates the key, removes approvals and drops older candidates; a stale-generation candidate is refused.
  {
    const { env, candidates, deps, audit } = setup();
    await env.flows.create(flow("F"));
    const first = await approveVisualCandidate(deps, AUTHOR, candidates.add(await capture(env, "F", "s1")));
    const pending = candidates.add(await capture(env, "F", "s2"));
    const reset = leak(await resetVisualBaselines(deps, AUTHOR)) as Awaited<ReturnType<typeof resetVisualBaselines>>;
    add("[reset] reset rotates to key generation 2", first.ok && reset.ok && reset.code === "reset" && (await env.store.keyGeneration()) === 2);
    add("[reset] every earlier approval is gone", !(await present(env, "F", "s1")));
    add("[reset] candidates of the earlier generation are dropped", candidates.peek(pending) === undefined);
    add("[audit] reset is audited with the new generation", audit.some((a) => a.eventType === "VISUAL_BASELINES_RESET" && a.result === "success" && a.detail.generation === 2));
    const old = candidates.add(await capture(env, "F", "s2", { keyGeneration: 1 }));
    add("[stale] a candidate bound to an earlier key generation is stale-key-generation", (await approveVisualCandidate(deps, AUTHOR, old)).code === "stale-key-generation");
    const fresh = await approveVisualCandidate(deps, AUTHOR, candidates.add(await capture(env, "F", "s2")));
    add("[reset] a capture after the reset approves under the new key", fresh.ok && (await present(env, "F", "s2")));
  }

  // C9b a reset before any key exists is never the first key: a capture bound to generation 0 is stale after it.
  {
    const { env, candidates, deps } = setup();
    await env.flows.create(flow("F"));
    const before = await capture(env, "F", "s1");
    const reset = await resetVisualBaselines(deps, AUTHOR);
    add("[reset] a reset before any key exists moves to generation 2, never the first-key generation 1", reset.ok && (await env.store.keyGeneration()) === 2, JSON.stringify(reset));
    // Re-added as another process's registry would still hold it (this process's reset dropped its own copy).
    const stale = candidates.add(before);
    add("[stale] a capture taken before that reset is stale-key-generation", (await approveVisualCandidate(deps, AUTHOR, stale)).code === "stale-key-generation");
  }

  // C9d a reset that crashes before its new key is written leaves the store fail-closed, never first-use.
  {
    const { env, candidates, deps } = setup();
    await env.flows.create(flow("F"));
    const before = await capture(env, "F", "s1");
    const store = env.store as unknown as { createKey: (generation: number) => Promise<void> };
    const realCreateKey = store.createKey.bind(env.store);
    store.createKey = async () => {
      throw new Error("simulated crash before the new key");
    };
    const crashed = await resetVisualBaselines(deps, AUTHOR);
    store.createKey = realCreateKey;
    add("[reset] a crash mid-reset reports reset-unavailable and leaves no key (key-lost, not first use)", crashed.code === "reset-unavailable" && (await env.store.keyGeneration()) === null);
    add("[reset] after the crash a pre-reset capture is refused, never accepted under a new first key", (await approveVisualCandidate(deps, AUTHOR, candidates.add(before))).code === "integrity-unavailable");
    const recovered = await resetVisualBaselines(deps, AUTHOR);
    add("[reset] another reset recovers past the crashed generation", recovered.ok && (await env.store.keyGeneration()) === 3, JSON.stringify(recovered));
  }

  // C9c approving over an unreadable baseline is audited as a replacement (VA-13).
  {
    const { env, candidates, deps, audit } = setup();
    await env.flows.create(flow("F"));
    const r = await approveVisualCandidate(deps, AUTHOR, candidates.add(await capture(env, "F", "s1", { reason: "baseline-unreadable" })));
    const entry = audit.find((a) => a.eventType === "VISUAL_CANDIDATE_APPROVED");
    add("[audit] approving a baseline-unreadable candidate is audited as replacing an unreadable baseline", r.ok && entry?.detail.replacedUnreadable === true, JSON.stringify(entry?.detail));
  }

  // C10 the keystore is unavailable: approval and reset refuse, never write.
  {
    const { env, candidates, deps, audit } = setup();
    await env.flows.create(flow("F"));
    await approveVisualCandidate(deps, AUTHOR, candidates.add(await capture(env, "F", "s1")));
    const id = candidates.add(await capture(env, "F", "s2"));
    env.protector.state.available = false;
    add("[keystore] an approval with the keystore locked is integrity-unavailable", (await approveVisualCandidate(deps, AUTHOR, id)).code === "integrity-unavailable");
    const r = await resetVisualBaselines(deps, AUTHOR);
    add("[keystore] reset with the keystore locked is reset-unavailable and audited as a failure", r.code === "reset-unavailable" && audit.some((a) => a.eventType === "VISUAL_BASELINES_RESET" && a.result === "failure"));
    env.protector.state.available = true;
    add("[keystore] nothing was rotated or removed while it was locked", (await env.store.keyGeneration()) === 1 && (await present(env, "F", "s1")));
  }

  // C11 reject consumes; a broken audit sink never changes a decision.
  {
    const { env, candidates, deps } = setup();
    await env.flows.create(flow("F"));
    const id = candidates.add(await capture(env, "F", "s1"));
    const r = await rejectVisualCandidate(deps, AUTHOR, id);
    add("[reject] reject consumes the candidate and approves nothing", r.ok && r.code === "rejected" && candidates.peek(id) === undefined && !(await present(env, "F", "s1")));
    add("[reject] a second reject is candidate-unavailable", (await rejectVisualCandidate(deps, AUTHOR, id)).code === "candidate-unavailable");
    const throwing: VisualApprovalDeps = { ...deps, audit: async () => Promise.reject(new Error("audit store down")) };
    const ok = await approveVisualCandidate(throwing, AUTHOR, candidates.add(await capture(env, "F", "s1")));
    add("[audit] an unwritable audit trail does not turn an approval into an error", ok.ok && ok.code === "approved");
  }

  return out;
}

/** The IPC, preload and renderer boundary, read from source. */
function staticChecks(): Outcome[] {
  const out: Outcome[] = [];
  const add = (label: string, ok: unknown, detail?: string): void => {
    out.push({ label, ok: !!ok, detail });
  };
  const ipc = readFileSync(join(ROOT, "app/main/ipc/visualAssertion.ipc.ts"), "utf8");
  const handlers = [...ipc.matchAll(/ipcMain\.handle\("(visualAssertion:[A-Za-z]+)"[\s\S]*?\n  \}\);/g)].map((m) => ({ channel: m[1], body: m[0] }));
  const expectSensitive: Record<string, boolean> = {
    "visualAssertion:listCandidates": false,
    "visualAssertion:previewCandidate": true,
    "visualAssertion:approveCandidate": true,
    "visualAssertion:rejectCandidate": true,
    "visualAssertion:resetBaselines": true
  };
  add("[ipc] exactly the six visual assertion channels are registered", handlers.length === 6 && handlers.some((h) => h.channel === "visualAssertion:capabilities"), handlers.map((h) => h.channel).join(", "));
  for (const [channel, sensitive] of Object.entries(expectSensitive)) {
    const h = handlers.find((x) => x.channel === channel);
    add(
      `[ipc] ${channel} authorizes WORKFLOW_EDIT${sensitive ? " with fresh re-authentication" : ""} before any work`,
      !!h && new RegExp(`const auth = await authorize\\(event, "${channel}", ${sensitive}\\);\\s*if \\(!auth\\.ok\\) return`).test(h.body)
    );
  }
  add("[ipc] authorize asks for WORKFLOW_EDIT and audits denials", /assertSenderPermission\(event, Permission\.WORKFLOW_EDIT, \{\s*sensitive,\s*audit:/.test(ipc));
  add("[ipc] capabilities needs a signed-in session and offers enforce only in the dev build", /visualAssertion:capabilities"[\s\S]*?assertSenderPermission\(event, Permission\.PAGE_FLOWS\)[\s\S]*?enforceAvailable: appMode === "dev"/.test(ipc));
  add("[ipc] no grant issuance, sweep, key or commitment method is reachable from IPC", !/issueGrantUnchecked|\.sweep\(|commitmentFor|approveUnchecked|resetUnchecked|loadKeys/.test(ipc));

  const preload = readFileSync(join(ROOT, "app/main/preload.ts"), "utf8");
  const exposed = [...preload.matchAll(/invoke\("(visualAssertion:[A-Za-z]+)"/g)].map((m) => m[1]).sort();
  add("[preload] the renderer can reach exactly the six channels", exposed.join(",") === [...handlers.map((h) => h.channel)].sort().join(","), exposed.join(", "));

  const section = readFileSync(join(ROOT, "app/renderer/components/workflow/VisualAssertionSection.tsx"), "utf8");
  add("[renderer] the Designer section touches no digest, epoch token, commitment or key", !/contentDigest|stepContentDigest|\.epoch\b|commitment|keyGeneration|safeStorage/.test(section));
  add("[renderer] approve, preview, reject and reset go through the re-authentication retry", /useSensitiveSemanticAction\(describe\)/.test(section) && /<ReauthDialog/.test(section) && /<ConfirmDialog/.test(section));
  add("[renderer] enforce is offered only when the build allows it and an imported enforce step shows the unavailable state", /disabled=\{!enforceAvailable\}/.test(section) && /visual-assertion-enforce-unavailable/.test(section));
  return out;
}

async function main(): Promise<void> {
  let passed = 0;
  let failed = 0;
  const report = (outcomes: Outcome[]): void => {
    for (const o of outcomes) {
      if (o.ok) passed += 1;
      else failed += 1;
      console.log(`  ${o.ok ? "✓" : "✗"} ${o.label}${!o.ok && o.detail ? ` — ${o.detail}` : ""}`);
    }
  };

  console.log("Candidate approval service");
  report(await suite({ name: "real" }));
  console.log("Integration boundary (static)");
  report(staticChecks());

  console.log("Mutants (each must fail the suite)");
  class ReusableCandidates extends VisualAssertionCandidates {
    override take(candidateId: string) {
      return this.peek(candidateId);
    }
  }
  class UndroppedCandidates extends VisualAssertionCandidates {
    override dropBelowKeyGeneration(): void {}
  }
  const mutants: Variant[] = [
    { name: "take does not consume (replay)", Candidates: ReusableCandidates },
    { name: "reset keeps stale candidates", Candidates: UndroppedCandidates },
    {
      name: "list leaks the content digest",
      leak: (r) => (Array.isArray(r) ? r.map((c) => ({ ...c, contentDigest: PIXELS.baseline })) : r)
    },
    {
      name: "approve answers the epoch token",
      leak: (r) => (r && typeof r === "object" && (r as { code?: string }).code === "approved" ? { ...(r as object), epoch: "x" } : r)
    }
  ];
  for (const mutant of mutants) {
    const outcomes = await suite(mutant);
    const red = outcomes.filter((o) => !o.ok);
    const ok = red.length > 0;
    if (ok) passed += 1;
    else failed += 1;
    console.log(`  ${ok ? "✓" : "✗"} mutant "${mutant.name}" is caught${ok ? ` (${red[0].label})` : ""}`);
  }

  console.log(`\nverify:visual-assertion-candidates: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
