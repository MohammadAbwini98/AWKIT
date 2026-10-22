/**
 * verify:visual-baseline-cross-process — Phase N, N6.3 (awkit-vra.15.3): the mandatory cross-process gate.
 *
 * Two (or three) REAL Node processes (`scripts/lib/visualBaselineChild.mts`) run the production flow-store
 * hooks, VisualBaselineStore and cross-process lock against one temporary flows folder. Ordering is
 * enforced by explicit barriers over the IPC channel (a child reports "holding" or "paused" from inside
 * the critical section and continues only on the parent's signal); no step depends on timing except the
 * lock's own acquisition deadline, which a refusal case exceeds on purpose. Holders are killed for real.
 *
 * Scenarios (plan, "Cross-process safety"):
 *   X1 a holder blocks another process's write (refused at its deadline, or served after the release)
 *   X2 approval versus update, both orders
 *   X3 import versus create of the same id (creation never overwrites; import authorization is N6.9)
 *   X4 concurrent creation of a missing epoch token
 *   X5 a holder killed while holding, and while invalidating; a holder wrongly judged dead is fenced
 *   X6 a live holder is never taken over, however long it holds
 *   X7 different flows folders are independent; one folder under different spellings is one lock and one identity
 *   X8 packaged and development builds coordinate on shared tokens and keep separate signed files and keys
 *
 * Mutation controls rerun scenarios with a child that lacks one protection; each must make its scenario fail.
 *
 * Run: npm run verify:visual-baseline-cross-process
 */

import { fork, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";

import type { FlowProfile } from "@src/profiles/FlowProfile";
import { flow, step, tempRoot } from "./lib/visualBaselineKit.mts";

type Outcome = { label: string; ok: boolean; detail?: string };
type Mutant = "none" | "no-lock" | "swallow-lock-errors" | "no-fence" | "textual-identity";

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

const CHILD = join(process.cwd(), "scripts", "lib", "visualBaselineChild.mts");
const GUARD_MS = 30000;

interface Reply {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

class Child {
  private readonly process: ChildProcess;
  private nextId = 1;
  private readonly replies = new Map<number, (reply: Reply) => void>();
  private readonly events: string[] = [];
  private readonly eventWaiters: Array<{ name: string; resolve: () => void }> = [];
  readonly exited: Promise<void>;
  pid = 0;

  constructor() {
    this.process = fork(CHILD, [], { execArgv: ["--import", "tsx"], stdio: ["ignore", "inherit", "inherit", "ipc"] });
    this.exited = new Promise((resolve) => this.process.once("exit", () => resolve()));
    this.process.on("message", (message: { id?: number; event?: string } & Reply) => {
      if (message.event) {
        const index = this.eventWaiters.findIndex((w) => w.name === message.event);
        if (index >= 0) this.eventWaiters.splice(index, 1)[0].resolve();
        else this.events.push(message.event);
        return;
      }
      if (message.id !== undefined) {
        this.replies.get(message.id)?.(message);
        this.replies.delete(message.id);
      }
    });
  }

  event(name: string): Promise<void> {
    const index = this.events.indexOf(name);
    if (index >= 0) {
      this.events.splice(index, 1);
      return Promise.resolve();
    }
    return guard(new Promise((resolve) => this.eventWaiters.push({ name, resolve })), `event ${name}`);
  }

  request(cmd: string, args: Record<string, unknown> = {}): Promise<Reply> {
    const id = this.nextId++;
    const reply = new Promise<Reply>((resolve) => this.replies.set(id, resolve));
    this.process.send({ id, cmd, args });
    return guard(reply, `${cmd} reply`);
  }

  signal(name: string): void {
    this.process.send({ signal: name });
  }

  async init(args: { flowsFolder: string; runtimeRoot: string; mode?: "dev" | "packaged"; lockTimeoutMs?: number; deadProbe?: boolean; mutant?: Mutant }): Promise<this> {
    await this.event("ready");
    const reply = await this.request("init", { mode: "dev", lockTimeoutMs: 8000, ...args });
    this.pid = (reply.result as { pid: number }).pid;
    return this;
  }

  kill(): Promise<void> {
    this.process.kill("SIGKILL");
    return this.exited;
  }

  async close(): Promise<void> {
    if (this.process.exitCode === null && !this.process.killed) this.process.send({ cmd: "exit" });
    await this.exited;
  }
}

function guard<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} did not arrive within ${GUARD_MS} ms`)), GUARD_MS);
    })
  ]);
}

const errorCode = (reply: Reply): string => (reply.ok ? "ok" : reply.error?.code ?? "error");
const readFlowFile = (folder: string, id: string): FlowProfile | null => {
  const path = join(folder, `${id}.json`);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as FlowProfile) : null;
};
const withLocator = (profile: FlowProfile, stepId: string, value: string): FlowProfile => ({
  ...profile,
  nodes: profile.nodes.map((n) => (n.id === stepId ? ({ ...n, locator: { strategy: "css", value } } as typeof n) : n))
});

function world(label: string): { root: string; flows: string; runtime: string } {
  const root = tempRoot(`xp-${label}`);
  return { root, flows: join(root, "flows"), runtime: join(root, "runtime") };
}

// ── Scenarios. Each returns outcomes; `b` (and sometimes `a`) can be given a mutant. ──────────────────────

async function x1(bMutant: Mutant = "none"): Promise<Outcome[]> {
  const w = world("x1");
  const a = await new Child().init({ flowsFolder: w.flows, runtimeRoot: w.runtime });
  const b = await new Child().init({ flowsFolder: w.flows, runtimeRoot: w.runtime, lockTimeoutMs: 800, mutant: bMutant });
  const c = await new Child().init({ flowsFolder: w.flows, runtimeRoot: w.runtime, lockTimeoutMs: 20000 });
  try {
    await a.request("create-flow", { profile: flow("F") });
    const hold = a.request("hold");
    await a.event("holding");
    const refused = await b.request("write-flow", { id: "F", profile: { ...flow("F"), name: "from B" } });
    const untouched = readFlowFile(w.flows, "F")?.name === "Flow F";
    let served = false;
    const waiting = c.request("write-flow", { id: "F", profile: { ...flow("F"), name: "from C" } }).then((r) => {
      served = true;
      return r;
    });
    await c.request("ping");
    const notWhileHeld = !served && readFlowFile(w.flows, "F")?.name === "Flow F";
    a.signal("release");
    await hold;
    const after = await waiting;
    return [
      { label: "[X1] while A holds the lock, B's write is refused at its deadline with the typed lock-timeout", ok: errorCode(refused) === "lock-timeout" && untouched, detail: errorCode(refused) },
      { label: "[X1] ...and C's write waits: it does not land while A holds", ok: notWhileHeld },
      { label: "[X1] ...and is served once A releases", ok: after.ok && readFlowFile(w.flows, "F")?.name === "from C", detail: errorCode(after) }
    ];
  } finally {
    await Promise.all([a.close(), b.close(), c.close()]);
  }
}

async function x2(): Promise<Outcome[]> {
  const w = world("x2");
  const a = await new Child().init({ flowsFolder: w.flows, runtimeRoot: w.runtime });
  const b = await new Child().init({ flowsFolder: w.flows, runtimeRoot: w.runtime });
  try {
    await a.request("create-flow", { profile: flow("F") });
    // (a) Update first: A pauses inside its update's critical section; B's approval is queued behind it.
    const oldDigest = (await b.request("step-digest", { flowId: "F", stepId: "s1" })).result as string;
    const request = (await b.request("prepare-approval", { flowId: "F", stepId: "s1" })).result;
    await a.request("pause", { operation: "update" });
    const update = a.request("write-flow", { id: "F", profile: withLocator(flow("F"), "s1", "#raced") });
    await a.event("paused");
    let approvalDone = false;
    const approval = b.request("approve", { request }).then((r) => {
      approvalDone = true;
      return r;
    });
    await b.request("ping");
    const queued = !approvalDone;
    a.signal("continue");
    await update;
    const refused = (await approval).result as { ok: boolean; refusal?: string };
    const staleGone = ((await a.request("lookup", { flowId: "F", stepId: "s1", digest: oldDigest })).result as { status: string }).status !== "present";
    // (b) Approval first, then an update in the other process purges it.
    const fresh = (await b.request("prepare-approval", { flowId: "F", stepId: "s1" })).result;
    const approved = (await b.request("approve", { request: fresh })).result as { ok: boolean };
    const digest = (await b.request("step-digest", { flowId: "F", stepId: "s1" })).result as string;
    await a.request("write-flow", { id: "F", profile: withLocator(flow("F"), "s1", "#after") });
    const purged = ((await b.request("lookup", { flowId: "F", stepId: "s1", digest })).result as { status: string }).status;
    return [
      { label: "[X2] an approval in B waits for A's update in progress", ok: queued },
      { label: "[X2] ...and is then refused as stale, leaving no approval of the old content", ok: !refused.ok && refused.refusal === "stale-content" && staleGone, detail: JSON.stringify(refused) },
      { label: "[X2] an approval made in B first is purged by A's later update", ok: approved.ok && purged !== "present", detail: purged }
    ];
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
}

async function x3(): Promise<Outcome[]> {
  const w = world("x3");
  const a = await new Child().init({ flowsFolder: w.flows, runtimeRoot: w.runtime });
  const b = await new Child().init({ flowsFolder: w.flows, runtimeRoot: w.runtime });
  try {
    await a.request("pause", { operation: "import" });
    const imported = a.request("import-flow", { profile: { ...flow("G"), name: "imported by A" } });
    await a.event("paused");
    const create = b.request("create-flow", { profile: { ...flow("G"), name: "created by B" } });
    await b.request("ping");
    a.signal("continue");
    await imported;
    const created = await create;
    return [
      { label: "[X3] a create racing an import of the same id never overwrites it", ok: !created.ok && /already exists/.test(created.error?.message ?? "") && readFlowFile(w.flows, "G")?.name === "imported by A", detail: errorCode(created) }
    ];
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
}

async function x4(): Promise<Outcome[]> {
  const w = world("x4");
  const a = await new Child().init({ flowsFolder: w.flows, runtimeRoot: w.runtime });
  const b = await new Child().init({ flowsFolder: w.flows, runtimeRoot: w.runtime });
  try {
    let agreed = 0;
    const rounds = 12;
    for (let i = 0; i < rounds; i += 1) {
      await a.request("create-flow", { profile: flow(`T${i}`) });
      const [ta, tb] = await Promise.all([a.request("ensure-token", { flowId: `T${i}` }), b.request("ensure-token", { flowId: `T${i}` })]);
      const onDisk = (await a.request("read-token", { flowId: `T${i}` })).result;
      if (ta.ok && tb.ok && ta.result === tb.result && ta.result === onDisk) agreed += 1;
    }
    return [{ label: `[X4] two processes creating a missing epoch token at once agree on one token (${rounds} rounds)`, ok: agreed === rounds, detail: `${agreed}/${rounds}` }];
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
}

async function x5(): Promise<Outcome[]> {
  const out: Outcome[] = [];
  {
    const w = world("x5a");
    const a = await new Child().init({ flowsFolder: w.flows, runtimeRoot: w.runtime });
    const b = await new Child().init({ flowsFolder: w.flows, runtimeRoot: w.runtime });
    try {
      await a.request("create-flow", { profile: flow("F") });
      void a.request("hold").catch(() => undefined);
      await a.event("holding");
      await a.kill();
      const lockDir = join(w.flows, ".awkit-visual", "locks");
      const fenceBefore = Number(readFileSync(join(lockDir, "flows.fence"), "utf8"));
      const written = await b.request("write-flow", { id: "F", profile: { ...flow("F"), name: "after kill" } });
      const fenceAfter = Number(readFileSync(join(lockDir, "flows.fence"), "utf8"));
      const leftovers = readdirSync(lockDir).filter((f) => f.includes(".claim.") || f.endsWith(".lock"));
      out.push({ label: "[X5] a holder killed while holding is recovered by the next writer", ok: written.ok && readFlowFile(w.flows, "F")?.name === "after kill", detail: errorCode(written) });
      out.push({ label: "[X5] ...with a higher fence and no lock or claim left behind", ok: fenceAfter > fenceBefore && leftovers.length === 0, detail: `${fenceBefore}->${fenceAfter} ${leftovers.join(",")}` });
    } finally {
      await b.close();
    }
  }
  {
    const w = world("x5b");
    const a = await new Child().init({ flowsFolder: w.flows, runtimeRoot: w.runtime });
    const b = await new Child().init({ flowsFolder: w.flows, runtimeRoot: w.runtime });
    try {
      await b.request("create-flow", { profile: flow("F") });
      const digests: string[] = [];
      for (const stepId of ["s1", "s2"]) {
        const request = (await b.request("prepare-approval", { flowId: "F", stepId })).result;
        await b.request("approve", { request });
        digests.push((await b.request("step-digest", { flowId: "F", stepId })).result as string);
      }
      await a.request("pause", { deletion: true });
      void a.request("import-flow", { profile: flow("F") }).catch(() => undefined);
      await a.event("paused");
      await a.kill();
      const revived = await Promise.all(digests.map(async (digest, i) => ((await b.request("lookup", { flowId: "F", stepId: `s${i + 1}`, digest })).result as { status: string }).status));
      const swept = (await b.request("sweep")).result as { deleted: number };
      out.push({ label: "[X5] a holder killed after writing the new token but before deleting never revives an approval", ok: revived.every((s) => s !== "present"), detail: revived.join(",") });
      out.push({ label: "[X5] ...and the other process's sweep removes the leftovers", ok: swept.deleted > 0, detail: String(swept.deleted) });
    } finally {
      await b.close();
    }
  }
  out.push(...(await x5Fence()));
  return out;
}

/** A holder wrongly judged dead by another process (simulated by a probe that reports every pid dead) is fenced. */
async function x5Fence(aMutant: Mutant = "none"): Promise<Outcome[]> {
  const w = world("x5c");
  mkdirSync(w.flows, { recursive: true });
  const marker = join(w.root, "marker.txt");
  const a = await new Child().init({ flowsFolder: w.flows, runtimeRoot: w.runtime, mutant: aMutant });
  const b = await new Child().init({ flowsFolder: w.flows, runtimeRoot: w.runtime, deadProbe: true });
  try {
    const held = a.request("hold-then-guarded-write", { marker });
    await a.event("holding");
    const bWrite = await b.request("guarded-write", { marker, value: "B" });
    a.signal("resume");
    const aResult = (await held).result as { written: boolean; code?: string; outer?: string };
    const final = existsSync(marker) ? readFileSync(marker, "utf8") : "";
    return [
      { label: "[X5] a holder that lost its lock is fenced: its later protected write is refused (lock-lost)", ok: bWrite.ok && !aResult.written && aResult.code === "lock-lost" && final === "B", detail: JSON.stringify({ aResult, final }) }
    ];
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
}

async function x6(bOptions: { deadProbe?: boolean } = {}): Promise<Outcome[]> {
  const w = world("x6");
  mkdirSync(w.flows, { recursive: true });
  const marker = join(w.root, "marker.txt");
  const a = await new Child().init({ flowsFolder: w.flows, runtimeRoot: w.runtime });
  const b = await new Child().init({ flowsFolder: w.flows, runtimeRoot: w.runtime, lockTimeoutMs: 1500, ...bOptions });
  try {
    const hold = a.request("hold");
    await a.event("holding");
    const attempt = await b.request("guarded-write", { marker, value: "B" });
    const lockPath = join(w.flows, ".awkit-visual", "locks", "flows.lock");
    const lock = (existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, "utf8")) : { pid: 0 }) as { pid: number };
    a.signal("release");
    await hold;
    return [
      { label: "[X6] a live holder is never taken over: the waiter times out and the lock is still the holder's", ok: errorCode(attempt) === "lock-timeout" && lock.pid === a.pid && !existsSync(marker), detail: `${errorCode(attempt)} pid ${lock.pid}/${a.pid}` }
    ];
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
}

async function x7(bMutant: Mutant = "none"): Promise<Outcome[]> {
  const out: Outcome[] = [];
  const w = world("x7");
  const other = join(w.root, "flows-other");
  const junction = join(w.root, "flows-junction");
  mkdirSync(w.flows, { recursive: true });
  symlinkSync(w.flows, junction, "junction");
  const spelling = `${w.flows.toUpperCase()}\\`;
  const a = await new Child().init({ flowsFolder: w.flows, runtimeRoot: w.runtime });
  const b = await new Child().init({ flowsFolder: junction, runtimeRoot: w.runtime, lockTimeoutMs: 800, mutant: bMutant });
  const c = await new Child().init({ flowsFolder: spelling, runtimeRoot: w.runtime, lockTimeoutMs: 800, mutant: bMutant });
  const d = await new Child().init({ flowsFolder: other, runtimeRoot: w.runtime, lockTimeoutMs: 800 });
  try {
    await a.request("create-flow", { profile: flow("F") });
    const request = (await a.request("prepare-approval", { flowId: "F", stepId: "s1" })).result;
    await a.request("approve", { request });
    const digest = (await a.request("step-digest", { flowId: "F", stepId: "s1" })).result as string;
    const viaJunction = ((await b.request("lookup", { flowId: "F", stepId: "s1", digest })).result as { status: string }).status;
    out.push({ label: "[X7] one folder reached through a junction is one identity: the approval is found", ok: viaJunction === "present", detail: viaJunction });
    const hold = a.request("hold");
    await a.event("holding");
    const [junctionWrite, spellingWrite, otherWrite] = await Promise.all([
      b.request("write-flow", { id: "F", profile: { ...flow("F"), name: "via junction" } }),
      c.request("write-flow", { id: "F", profile: { ...flow("F"), name: "via spelling" } }),
      d.request("create-flow", { profile: flow("F") })
    ]);
    a.signal("release");
    await hold;
    out.push({ label: "[X7] the same folder through a junction or another spelling is the same lock (refused while held)", ok: errorCode(junctionWrite) === "lock-timeout" && errorCode(spellingWrite) === "lock-timeout", detail: `${errorCode(junctionWrite)}/${errorCode(spellingWrite)}` });
    out.push({ label: "[X7] a different flows folder is independent (not blocked)", ok: otherWrite.ok, detail: errorCode(otherWrite) });
    // A Settings flows-path change in one process: same flow id, other folder, nothing inherited.
    await a.request("switch-folder", { flowsFolder: other });
    const inherited = ((await a.request("lookup", { flowId: "F", stepId: "s1", digest })).result as { status: string }).status;
    out.push({ label: "[X7] after a flows-path change, the same flow id in the other folder inherits no approval", ok: inherited !== "present", detail: inherited });
    return out;
  } finally {
    await Promise.all([a.close(), b.close(), c.close(), d.close()]);
  }
}

async function x8(): Promise<Outcome[]> {
  const w = world("x8");
  const a = await new Child().init({ flowsFolder: w.flows, runtimeRoot: w.runtime, mode: "packaged" });
  const b = await new Child().init({ flowsFolder: w.flows, runtimeRoot: w.runtime, mode: "dev", lockTimeoutMs: 800 });
  try {
    await a.request("create-flow", { profile: flow("F") });
    const packagedApproval = (await a.request("approve", { request: (await a.request("prepare-approval", { flowId: "F", stepId: "s1" })).result })).result as { ok: boolean };
    const devApproval = (await b.request("approve", { request: (await b.request("prepare-approval", { flowId: "F", stepId: "s1" })).result })).result as { ok: boolean };
    const digest = (await a.request("step-digest", { flowId: "F", stepId: "s1" })).result as string;
    const keys = ["packaged", "dev"].map((mode) => join(w.runtime, "visual-baselines", mode, "keys", "master-key.json"));
    const separate = keys.every(existsSync) && readFileSync(keys[0], "utf8") !== readFileSync(keys[1], "utf8");
    const hold = a.request("hold");
    await a.event("holding");
    const blocked = await b.request("write-flow", { id: "F", profile: withLocator(flow("F"), "s1", "#dev") });
    a.signal("release");
    await hold;
    await b.request("write-flow", { id: "F", profile: withLocator(flow("F"), "s1", "#dev") });
    const packagedAfter = ((await a.request("lookup", { flowId: "F", stepId: "s1", digest })).result as { status: string }).status;
    return [
      { label: "[X8] packaged and dev builds approve under separate keys and signed trees", ok: packagedApproval.ok && devApproval.ok && separate },
      { label: "[X8] a dev write waits for a packaged holder (one lock for both builds)", ok: errorCode(blocked) === "lock-timeout", detail: errorCode(blocked) },
      { label: "[X8] a dev update purges the packaged approval of the changed step (shared lifecycle)", ok: packagedAfter !== "present", detail: packagedAfter }
    ];
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
}

console.log("verify:visual-baseline-cross-process — N6.3 two-process gate (real processes, explicit barriers)\n");

for (const scenario of [x1, x2, x3, x4, x5, x6, x7, x8]) {
  for (const outcome of await scenario()) check(outcome.label, outcome.ok, outcome.ok ? undefined : outcome.detail);
}
console.log("  · X3 import-overwrite authorization is N6.9 (awkit-vra.15.9) and is not part of this gate: import still overwrites as before");

console.log("\n  mutants (each must FAIL its scenario)");
const mutants: Array<[string, () => Promise<Outcome[]>, string]> = [
  ["flow writes skip the cross-process lock", () => x1("no-lock"), "[X1] while A holds the lock"],
  ["a lock acquisition failure is ignored", () => x1("swallow-lock-errors"), "[X1] while A holds the lock"],
  ["a live holder is taken over (TTL-style staleness)", () => x6({ deadProbe: true }), "[X6] a live holder is never taken over"],
  ["the fencing check is skipped", () => x5Fence("no-fence"), "[X5] a holder that lost its lock is fenced"],
  ["the folder identity follows the configured spelling", () => x7("textual-identity"), "[X7] one folder reached through a junction"]
];
for (const [name, run, mustFail] of mutants) {
  const failing = (await run()).filter((o) => !o.ok).map((o) => o.label);
  check(`MUTATION: ${name} fails (${failing.length} checks, including "${mustFail}")`, failing.some((label) => label.startsWith(mustFail)), failing.join("; ") || "nothing failed");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
