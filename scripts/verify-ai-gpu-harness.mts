/**
 * verify:ai-gpu-harness — the GPU harness's own lifecycle rules against deterministic fake hosts, a fake
 * clock, real temp folders and Windows' own module list. No GPU, model or Electron.
 *
 * Regression for the 2026-10-02 GTX 980M run, where the product behaved and three instruments failed:
 *  A. MECHANICS fork observation (scripts/ai-harness/gpuHostLifecycle.ts): a host left running by the
 *     PRODUCT steps is released before the guarded fork is observed; a fresh host is observed normally;
 *     an unguarded launch, a double guard run, a call that starts nothing and a host that survives release
 *     all still FAIL. Nothing is skipped because a host exists.
 *  B. Teardown inside the harness: dispose() returning while Windows still has the process (the EPERM
 *     cause) is waited out by pid, after normal completion, a kill to honour a cancel, an exhaustion run
 *     that throws, and an early return; a host that never exits is a failed step naming it.
 *  C. Cleanup in the launcher: the scratch folders are removed only once no process maps a module from
 *     them; owners are named, a folder that cannot be removed is reported with its code, and nothing throws.
 *     A real control: the module scan finds this verifier's own node.exe.
 *  D. Section C adapter identity (scripts/ai-harness/windowsAdapters.ts): Remote Desktop's adapter is set
 *     aside only by software enumerator AND Microsoft name; a hardware adapter still needs its PCI vendor
 *     ID and an unknown one still fails. Runtime E2 (Chromium's view) is unchanged.
 *  E. Wiring: the three GPU modes and the launcher use these helpers; PRODUCT Automatic's lifecycle in gpuLifecycle
 *     and the live quality modes' Automatic arm (liveExecution.ts) run on the product's own readiness;
 *     verify:ai-gpu-quality judges where a run ran through gpuQualityEvidence.ts, with no blanket console rule.
 *  F. GPU quality evidence (scripts/ai-harness/gpuQualityEvidence.ts): Remote Desktop changes the display topology,
 *     never the compute device. The recorded Run 2 part 1 (RDP, then disconnected) printed no runtime device count, so
 *     it is INCONCLUSIVE off the console; with that count it is NVIDIA compute evidence, never a console topology
 *     qualification. An ambiguous device (a second Vulkan device included) is INCONCLUSIVE; a call off the GPU after
 *     Automatic resolved to it FAILS; the Remote Display Adapter is never a compute GPU; an Automatic that resolved to
 *     CPU & RAM only stays supported and is no GPU evidence.
 *
 * Run: npm run verify:ai-gpu-harness
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { classifyAdapters } from "@src/ai/AiExecutionProfile";
import { AI_MODEL_MANIFEST } from "@src/offline/AiModelManifest";

import {
  describeRelease,
  describeRemoval,
  establishFreshHost,
  expectOneGuardedFork,
  HostTeardown,
  moduleOwners,
  removeWhenReleased,
  TEARDOWN_LABEL,
  withHostTeardown,
  type ModuleOwner
} from "./ai-harness/gpuHostLifecycle";
import { adapterRoles, COMPUTE_LABELS, gpuQualityVerdict, physicalConsole, type GateEvidence, type RunTopology } from "./ai-harness/gpuQualityEvidence";
import { adapterIdentityVerdict, classifyWindowsAdapter } from "./ai-harness/windowsAdapters";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

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
async function rejection(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return String((error as Error)?.message ?? error);
  }
}

// ── Fakes ────────────────────────────────────────────────────────────────────────────────────────

/** Windows' process table: a pid stays alive for `lag` liveness checks after its channel closes. */
class FakeOs {
  private next = 7000;
  private readonly table = new Map<number, number | "running">();
  /** Checks a closed process survives; Infinity never exits. */
  lag = 0;
  spawn(): number {
    const pid = this.next++;
    this.table.set(pid, "running");
    return pid;
  }
  closed(pid: number): void {
    if (this.table.get(pid) === "running") this.table.set(pid, this.lag);
  }
  isAlive = (pid: number): boolean => {
    const state = this.table.get(pid);
    if (state === undefined) return false;
    if (state === "running") return true;
    if (state <= 0) {
      this.table.delete(pid);
      return false;
    }
    this.table.set(pid, state - 1);
    return true;
  };
}

/** AiUtilityHostManager's observable surface: a call forks when no host is live, after the guard. */
class FakeHost {
  live: number | null = null;
  guardRuns = 0;
  guardsPerFork = 1;
  releaseStops = true;
  startsHost = true;
  disposed = false;
  constructor(private readonly os: FakeOs) {}
  status(): { pid: number | null } {
    return { pid: this.live };
  }
  async call(request: string): Promise<string> {
    if (this.disposed) throw new Error("AI_DISPOSED");
    if (this.live === null && this.startsHost) {
      this.guardRuns += this.guardsPerFork;
      this.live = this.os.spawn();
    }
    if (request === "cancel-kill" && this.live !== null) {
      // The manager kills a host that cannot honour a cancel; its exit is heard when the channel closes.
      this.os.closed(this.live);
      this.live = null;
      throw new Error("AI_HOST_KILLED_ON_CANCEL");
    }
    if (request === "load-fails") throw new Error("AI_MODEL_LOAD_FAILED");
    return `${request}@${this.live}`;
  }
  async release(): Promise<void> {
    if (this.releaseStops) this.stop();
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    this.stop();
  }
  private stop(): void {
    if (this.live === null) return;
    this.os.closed(this.live);
    this.live = null;
  }
}

function fakeClock(): { now: () => number; sleep: (ms: number) => Promise<void> } {
  let clock = 0;
  return { now: () => clock, sleep: async (ms) => void (clock += ms) };
}

type StepRecord = { label: string; ok: boolean; error?: string };
function fakeStep(records: StepRecord[]) {
  return async <T,>(label: string, fn: () => Promise<T> | T): Promise<T | undefined> => {
    try {
      const value = await fn();
      records.push({ label, ok: true });
      return value;
    } catch (error) {
      records.push({ label, ok: false, error: String((error as Error)?.message ?? error) });
      return undefined;
    }
  };
}

console.log("verify:ai-gpu-harness — the GPU harness's fork observation, teardown, cleanup and adapter identity\n");

// ── A ────────────────────────────────────────────────────────────────────────────────────────────
console.log("A. MECHANICS observes a guarded fork");
{
  const osA = new FakeOs();
  const host = new FakeHost(osA);
  await host.call("product"); // the PRODUCT steps on an eligible machine leave the GPU host up
  const productPid = host.live;
  const withoutPrecondition = await rejection(expectOneGuardedFork(host, () => host.guardRuns, () => host.call("hello")));
  check("an already-running host (the GTX 980M case): without the precondition the assertion FAILS, never passes vacuously", withoutPrecondition !== null && host.guardRuns === 1, withoutPrecondition);

  const fresh = await establishFreshHost(host);
  check("establishFreshHost releases the running host and reports its pid", fresh.releasedPid === productPid && host.status().pid === null, fresh);
  const before = host.guardRuns;
  const hello = await rejection(expectOneGuardedFork(host, () => host.guardRuns, () => host.call("hello")));
  check("...then exactly one guarded fork is observed on a new host", hello === null && host.guardRuns === before + 1 && host.live !== null && host.live !== productPid, { hello, guardRuns: host.guardRuns, pid: host.live });
}
{
  const host = new FakeHost(new FakeOs());
  const fresh = await establishFreshHost(host);
  const hello = await rejection(expectOneGuardedFork(host, () => host.guardRuns, () => host.call("hello")));
  check("a fresh host: the precondition releases nothing and the guard is observed normally", fresh.releasedPid === null && hello === null && host.guardRuns === 1, { fresh, hello });
}
{
  const host = new FakeHost(new FakeOs());
  await host.call("product");
  host.guardsPerFork = 0; // a launch that skips the pack guard
  await establishFreshHost(host);
  const unguarded = await rejection(expectOneGuardedFork(host, () => host.guardRuns, () => host.call("hello")));
  check("an unguarded launch still FAILS after a fresh start", unguarded === "guard ran 0 times for one fork", unguarded);
}
{
  const host = new FakeHost(new FakeOs());
  host.guardsPerFork = 2;
  const twice = await rejection(expectOneGuardedFork(host, () => host.guardRuns, () => host.call("hello")));
  check("a guard run twice for one fork FAILS", twice === "guard ran 2 times for one fork", twice);
}
{
  const host = new FakeHost(new FakeOs());
  await host.call("product");
  host.releaseStops = false;
  const survived = await rejection(establishFreshHost(host));
  check("a host that survives release FAILS the precondition: MECHANICS is never skipped", survived !== null && /still running after release/.test(survived), survived);
}
{
  const host = new FakeHost(new FakeOs());
  host.startsHost = false;
  const nothing = await rejection(expectOneGuardedFork(host, () => host.guardRuns, () => host.call("hello")));
  check("a call that starts no host FAILS", nothing === "the call started no host", nothing);
}

// ── B ────────────────────────────────────────────────────────────────────────────────────────────
console.log("\nB. Teardown inside the harness waits for Windows, not only the channel");
{
  const osB = new FakeOs();
  const hosts = new HostTeardown();
  const cpu = hosts.track(new FakeHost(osB));
  const gpu = hosts.track(new FakeHost(osB));
  await cpu.call("hello");
  await gpu.call("load");
  const result = await hosts.teardown({ isAlive: osB.isAlive, ...fakeClock() });
  check("normal completion: every host started is recorded, disposed and gone", result.pids.length === 2 && result.aliveAfterDispose.length === 0 && cpu.disposed && gpu.disposed, result);
}
{
  const osB = new FakeOs();
  osB.lag = 5;
  const hosts = new HostTeardown();
  const gpu = hosts.track(new FakeHost(osB));
  await gpu.call("load");
  const pid = gpu.live!;
  await gpu.dispose();
  check("dispose() returns while Windows still has the process (the cause of the EPERM)", gpu.status().pid === null && osB.isAlive(pid));
  const result = await hosts.teardown({ isAlive: osB.isAlive, pollMs: 100, ...fakeClock() });
  check("...and teardown waits by pid until it is gone, recording the gap", result.aliveAfterDispose.includes(pid) && result.exitedWithinMs > 0 && !osB.isAlive(pid), result);
}
{
  const osB = new FakeOs();
  osB.lag = 3;
  const hosts = new HostTeardown();
  const gpu = hosts.track(new FakeHost(osB));
  await gpu.call("load");
  const killedPid = gpu.live!;
  const cancelled = await rejection(gpu.call("cancel-kill"));
  await gpu.call("hello"); // the next call forks a fresh host
  const result = await hosts.teardown({ isAlive: osB.isAlive, ...fakeClock() });
  check("cancellation: the host killed to honour a cancel and its replacement are both waited for", cancelled === "AI_HOST_KILLED_ON_CANCEL" && result.pids.includes(killedPid) && result.pids.length === 2 && !osB.isAlive(killedPid), result);
}
{
  const osB = new FakeOs();
  const hosts = new HostTeardown();
  const host = hosts.track(new FakeHost(osB));
  const failedLoad = await rejection(host.call("load-fails"));
  check("a host whose call failed is still recorded (it is alive)", failedLoad === "AI_MODEL_LOAD_FAILED" && hosts.started().length === 1);
}
{
  const osB = new FakeOs();
  osB.lag = 4;
  const hosts = new HostTeardown();
  const records: StepRecord[] = [];
  const fillers: FakeHost[] = [];
  const thrown = await rejection(
    withHostTeardown(
      fakeStep(records),
      hosts,
      async () => {
        for (let k = 0; k < 3; k += 1) {
          const filler = hosts.track(new FakeHost(osB));
          fillers.push(filler);
          await filler.call("load");
        }
        throw new Error("exhaustion run aborted");
      },
      { isAlive: osB.isAlive, ...fakeClock() }
    )
  );
  const teardown = records.find((r) => r.label === TEARDOWN_LABEL);
  check(
    "exhaustion/error: a run that throws still tears down every filler and waits for each, then rethrows",
    thrown === "exhaustion run aborted" && teardown?.ok === true && fillers.every((f) => f.disposed) && hosts.started().every((pid) => !osB.isAlive(pid)),
    { thrown, records }
  );
}
{
  const osB = new FakeOs();
  const hosts = new HostTeardown();
  const records: StepRecord[] = [];
  let gpu: FakeHost | undefined;
  await withHostTeardown(
    fakeStep(records),
    hosts,
    async () => {
      gpu = hosts.track(new FakeHost(osB));
      await gpu.call("product");
      // the early `if (!hello) return;` that left the PRODUCT host running when Electron exited
    },
    { isAlive: osB.isAlive, ...fakeClock() }
  );
  check("an early return: the host still running is disposed and waited for", gpu?.disposed === true && records.at(-1)?.label === TEARDOWN_LABEL && records.at(-1)?.ok === true, records);
}
{
  const osB = new FakeOs();
  osB.lag = Infinity;
  const hosts = new HostTeardown();
  const records: StepRecord[] = [];
  let stuck = 0;
  await withHostTeardown(
    fakeStep(records),
    hosts,
    async () => {
      const host = hosts.track(new FakeHost(osB));
      await host.call("load");
      stuck = host.live!;
    },
    { isAlive: osB.isAlive, ceilingMs: 2_000, pollMs: 100, ...fakeClock() }
  );
  const last = records.at(-1);
  check("a host that never leaves Windows is a FAILED teardown step naming its pid, never a pass", last?.ok === false && String(last?.error).includes(String(stuck)), last);
}

// ── C ────────────────────────────────────────────────────────────────────────────────────────────
console.log("\nC. The launcher removes its scratch folders only once nothing maps them");
const scratchDirs = (): string[] =>
  ["awkit-gpu-harness-a-", "awkit-gpu-harness-b-"].map((prefix) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    fs.mkdirSync(path.join(dir, "bins"), { recursive: true });
    fs.writeFileSync(path.join(dir, "bins", "ggml-base.dll"), "not a real image");
    return dir;
  });
{
  const dirs = scratchDirs();
  const owner: ModuleOwner = { pid: 4242, name: "electron", file: path.join(dirs[0], "bins", "ggml-base.dll") };
  let scans = 0;
  const removal = await removeWhenReleased(dirs, { owners: () => (++scans <= 2 ? [owner] : []), ...fakeClock() });
  check("owners present for two scans, then released: waited, removed, ok", removal.ok && removal.waitedMs > 0 && scans === 3 && dirs.every((d) => !fs.existsSync(d)), removal);
  check("...and the trace names who held them when the harness had exited", removal.heldAtStart.length === 1 && /electron pid 4242 .*released within/.test(describeRelease(removal)), describeRelease(removal));
}
{
  const dirs = scratchDirs();
  const owner: ModuleOwner = { pid: 4243, name: "electron", file: path.join(dirs[1], "bins", "ggml-base.dll") };
  const removed: string[] = [];
  const removal = await removeWhenReleased(dirs, { owners: () => [owner], remove: (dir) => void removed.push(dir), ceilingMs: 3_000, ...fakeClock() });
  const detail = describeRemoval(removal);
  check("a process that never releases them: NOT ok, and named (pid, process, module)", !removal.ok && detail.includes("pid 4243") && detail.includes("electron") && detail.includes("ggml-base.dll"), detail);
  check("...every folder is still attempted and the call never throws", removed.length === dirs.length, removed);
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
}
{
  const dirs = scratchDirs();
  const removal = await removeWhenReleased(dirs, {
    owners: () => [],
    remove: (dir) => {
      if (dir === dirs[0]) throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
      fs.rmSync(dir, { recursive: true, force: true });
    },
    ...fakeClock()
  });
  check("a folder that cannot be removed is reported with its code (EPERM), not thrown, and the rest are removed", !removal.ok && removal.failures.length === 1 && removal.failures[0].code === "EPERM" && !fs.existsSync(dirs[1]), removal);
  fs.rmSync(dirs[0], { recursive: true, force: true });
}
if (process.platform === "win32") {
  const nodeDir = path.dirname(process.execPath);
  const own = moduleOwners([nodeDir]);
  check("real control: Windows' module list shows this verifier's own node.exe mapped from its folder", own.some((o) => o.pid === process.pid && /node\.exe$/i.test(o.file)), own.slice(0, 5));
  const dirs = scratchDirs();
  const removal = await removeWhenReleased(dirs);
  check(
    "real temp folders (an os.tmpdir() path, 8.3 or long) that nothing maps are removed through the default scan and rmSync convention",
    removal.ok && removal.heldAtStart.length === 0 && /^nothing mapped/.test(describeRelease(removal)) && dirs.every((d) => !fs.existsSync(d)),
    removal
  );
} else {
  console.log("  - NOT RUN: the Windows module-list controls (not Windows)");
}

// ── D ────────────────────────────────────────────────────────────────────────────────────────────
console.log("\nD. Section C adapter identity");
const NVIDIA = { pnpDeviceId: "PCI\\VEN_10DE&DEV_13D7&SUBSYS_11B71558&REV_A1\\4&2C1B6A3&0&0008", name: "NVIDIA GeForce GTX 980M" };
const REMOTE = { pnpDeviceId: "SWD\\REMOTEDISPLAYENUM\\RDPIDD_INDIRECTDISPLAY&SESSIONID_0002", name: "Microsoft Remote Display Adapter" };
{
  const rdp = adapterIdentityVerdict([NVIDIA, REMOTE]);
  check("the GTX 980M over Remote Desktop: the NVIDIA adapter carries its PCI ID, the remote adapter is set aside by name", rdp.ok && rdp.pci === 1 && rdp.microsoftSoftware.length === 1 && rdp.unknown.length === 0, rdp);
  check("the same machine at the physical console passes", adapterIdentityVerdict([NVIDIA]).ok);
  check("Microsoft Basic Render Driver on the ROOT enumerator is a Microsoft software adapter", classifyWindowsAdapter("ROOT\\BASICRENDER\\0000", "Microsoft Basic Render Driver") === "microsoft-software");
  check("Microsoft Basic Display Adapter on PCI is hardware with its PCI ID (a GPU without its driver)", classifyWindowsAdapter("PCI\\VEN_8086&DEV_591B&SUBSYS_00000000&REV_04\\3&11583659&0&10", "Microsoft Basic Display Adapter") === "pci");
  const noVendor = adapterIdentityVerdict([{ pnpDeviceId: "PCI\\CC_030000\\3&11583659&0&08", name: "NVIDIA GeForce GTX 980M" }, REMOTE]);
  check("a hardware adapter still needs its PCI vendor ID: a bus device without one FAILS", !noVendor.ok && noVendor.unknown.length === 1, noVendor);
  const usb = adapterIdentityVerdict([NVIDIA, { pnpDeviceId: "USB\\VID_17E9&PID_4301&MI_00\\7&1B2F3C4D&0&0000", name: "DisplayLink USB Device" }]);
  check("an unknown physical adapter without PCI identity FAILS", !usb.ok && usb.unknown.length === 1, usb);
  const misnamed = adapterIdentityVerdict([NVIDIA, { pnpDeviceId: "USB\\VID_045E&PID_0000\\1", name: "Microsoft Remote Display Adapter" }]);
  check("the Microsoft name on a bus enumerator FAILS: a name alone never exempts", !misnamed.ok, misnamed);
  const unnamed = adapterIdentityVerdict([NVIDIA, { pnpDeviceId: "ROOT\\DISPLAY\\0000", name: "Contoso Virtual Display" }]);
  check("a software enumerator with an unknown name FAILS: the enumerator alone never exempts", !unnamed.ok, unnamed);
  check("a remote adapter alone (no PCI adapter) FAILS", !adapterIdentityVerdict([REMOTE]).ok);
  check("no adapter FAILS", !adapterIdentityVerdict([]).ok);
  const chromium = classifyAdapters([0x10de, 0x10de, 0x1414]);
  check("runtime E2 is unchanged: Chromium's view of that session (0x10de, 0x10de, 0x1414) is eligible, the software adapter ignored", chromium.ok === true, chromium);
}

// ── E ────────────────────────────────────────────────────────────────────────────────────────────
console.log("\nE. Wiring");
const source = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");
{
  const live = source("scripts/ai-harness/gpuLive.ts");
  // By its label: the Automatic steps have their own fresh-host precondition earlier in the file.
  const precondition = live.indexOf('"(precondition) MECHANICS starts with no GPU host running, so its first call must fork", () => establishFreshHost(gpu)');
  const helloStep = live.indexOf('"MECHANICS the GPU host starts only after the pack guard, and reports Vulkan"');
  check("gpuLive: the fresh-host precondition step precedes the MECHANICS hello", precondition > 0 && helloStep > precondition);
  const automatic = live.indexOf("PRODUCT Automatic on this machine");
  check(
    "gpuLive: PRODUCT Automatic runs on the product's own readiness before MECHANICS, and only its labelled not-ready leg substitutes it",
    /executionMode: "auto"/.test(live) &&
      /makeService\(async \(\) => notReady \?\? gpuReadiness\(store\)/.test(live) &&
      live.includes("readiness SUBSTITUTED as not proven") &&
      automatic > 0 &&
      automatic < precondition
  );
  check("gpuLive: the MECHANICS hello asserts one guarded fork against the real guard counter", /expectOneGuardedFork\(gpu, \(\) => verifications, \(\) => gpu\.call<AiHostHello>\(HELLO/.test(live));
  const lifecycle = source("scripts/ai-harness/gpuLifecycle.ts");
  const automaticRunner = lifecycle.slice(lifecycle.indexOf("export async function runGpuAutomaticLifecycle("), lifecycle.indexOf("interface AutomaticContext"));
  const automaticBody = lifecycle.slice(lifecycle.indexOf("async function automaticLifecycle("));
  check(
    "gpuLifecycle: PRODUCT Automatic's lifecycle is its own mode inside withHostTeardown, wired by the launcher's --automatic-lifecycle, on the stored mode auto and the product's own readiness, and only its labelled not-ready leg substitutes it",
    /withHostTeardown\(step, hosts, \(\) =>\s*automaticLifecycle\(/.test(automaticRunner) &&
      /mode === "gpuAutoLifecycle"\) await runGpuAutomaticLifecycle\(/.test(source("scripts/ai-harness/harnessMain.ts")) &&
      /automaticLifecycle \? "gpuAutoLifecycle"/.test(source("scripts/verify-ai-gpu-host.mts")) &&
      !/await automaticLifecycle\(/.test(lifecycle) &&
      /executionMode: "auto"/.test(automaticBody) &&
      /return substituted \?\? gpuReadiness\(store\)/.test(automaticBody) &&
      automaticBody.includes("readiness SUBSTITUTED as VENDOR_UNPROVEN")
  );
  check(
    "gpuLifecycle: Automatic's lifecycle waits on the job's reported stage, a host exit or nvidia-smi, never a fixed sleep, and checks a fresh resolution after the restart, the release and the restore",
    !/\bsleep\(/.test(automaticBody) && /until\(\(\) => reached\(job\.requestId, stage\)/.test(automaticBody) && (automaticBody.match(/freshResolutions !== 1/g) ?? []).length >= 4
  );
  const liveExecution = source("scripts/ai-harness/liveExecution.ts");
  const harnessMain = source("scripts/ai-harness/harnessMain.ts");
  check(
    "live quality arm: Automatic is the stored mode over the product's readiness and a pack-guarded Vulkan host, and the unset arm keeps the qualified CPU path",
    /gpuReadiness\(store\)/.test(liveExecution) &&
      /verify: async \(\) => \{\s*guardRuns \+= 1;\s*const verdict = await store\.verifyForLoad\(\)/.test(liveExecution) &&
      /\.\.\.\(gpu \? \{ executionMode: "auto" as const, vramReserveBytes: null \} : \{\}\)/.test(harnessMain) &&
      /transport: gpu \? \(backend\) => \(backend === "vulkan" \? gpu\.manager : manager\) : \(\) => manager/.test(harnessMain)
  );
  for (const file of ["scripts/ai-harness/gpuLive.ts", "scripts/ai-harness/gpuLifecycle.ts", "scripts/ai-harness/gpuProgress.ts"]) {
    const text = source(file);
    const created = (text.match(/new AiUtilityHostManager\(/g) ?? []).length;
    const tracked = (text.match(/hosts\.track\(\s*new AiUtilityHostManager\(/g) ?? []).length;
    check(`${path.basename(file)}: runs inside withHostTeardown and tracks every manager it creates (${tracked}/${created})`, text.includes("withHostTeardown(") && created > 0 && tracked === created);
  }
  const launcher = source("scripts/verify-ai-gpu-host.mts");
  check(
    "verify-ai-gpu-host: the behaviour summary prints before cleanup, which goes through removeWhenReleased with no bare rmSync",
    launcher.indexOf("behaviour: ") > 0 && launcher.indexOf("behaviour: ") < launcher.indexOf("await removeWhenReleased(") && !/\brmSync\(/.test(launcher)
  );
  check("verify-ai-gpu-backend-gate: section C classifies adapters through windowsAdapters", /adapterIdentityVerdict\(adapters\)/.test(source("scripts/verify-ai-gpu-backend-gate.mts")));
  check(
    "live quality arm: every GPU plan's Vulkan device count is recorded from the runtime's own answer and printed by the launcher",
    /if \(request\.type === "gpuPlan"\) \{\s*const plan = answer as AiGpuPlan;\s*plans\.push\(\{ deviceCount: plan\.deviceCount/.test(liveExecution) &&
      /gpuPlans: this\.gpus\.flatMap\(\(gpu\) => gpu\.plans\(\)\)/.test(liveExecution) &&
      source("scripts/verify-ai-explanation-live.mts").includes("· runtime GPU plans: Vulkan devices ${JSON.stringify(plans.map((p) => p.deviceCount))}")
  );
  const quality = source("scripts/verify-ai-gpu-quality.mts");
  check(
    "verify-ai-gpu-quality: where a run ran is judged by gpuQualityVerdict over idle nvidia-smi readings taken with no gate running, its exit follows that verdict, and no blanket console rule remains",
    /gpuQualityVerdict\(\{/.test(quality) &&
      /if \(arm === "auto"\) idleReadings\.push\(idleVramMib\(\)\);\s*const run = await runGate\(gate\)/.test(quality) &&
      /compute\?\.verdict === "FAIL" \? 1 : unsettled > 0 \|\| compute\?\.verdict === "INCONCLUSIVE" \? 2 : 0/.test(quality) &&
      !/offConsole|before\.console|remote adapter \$\{/.test(quality)
  );
}

// ── F ────────────────────────────────────────────────────────────────────────────────────────────
console.log("\nF. GPU quality evidence: display topology and compute device are separate questions");
const MODEL_MIB = Math.floor((AI_MODEL_MANIFEST.find((entry) => entry.id === "qwen3.5-0.8b-q4-k-m")?.sizeBytes ?? 0) / 2 ** 20);
const GTX = { pnpDeviceId: "PCI\\VEN_10DE&DEV_13D7&SUBSYS_11291462&REV_A1", name: "NVIDIA GeForce GTX 980M" };
const ON_GPU = "gpu-offload on vulkan (25 of 25), answer vulkan/full";
const callLine = (feature: string, where = ON_GPU) => `    · ${feature} ok: ${where}, warm, first token 800 ms, generation 3000 ms, 37/256 out (350 in), 3800 ms end to end`;
const gateText = (calls: string[], readiness: string, pids: number[], vram: Array<number | null>) =>
  ["  execution, per model call:", ...calls, `    · readiness answers ${readiness}; pack guard runs 1; GPU host pids ${JSON.stringify(pids)}; nvidia-smi MiB after each call ${JSON.stringify(vram)}`].join("\n");
const READY = '[{"ok":true,"nvidiaAdapters":1}]';
const planLine = (devices: number[]) => `    · runtime GPU plans: Vulkan devices ${JSON.stringify(devices)}, VRAM total MiB ${JSON.stringify(devices.map(() => 8192))}`;
const withPlans = (gates: GateEvidence[], devices = [1]) => gates.map((gate) => ({ ...gate, text: `${gate.text}\n${planLine(devices)}` }));
const judge =(start: RunTopology, end: RunTopology, gates: GateEvidence[]) => gpuQualityVerdict({ start, end, gates, minModelVramMib: MODEL_MIB });
const RDP_START: RunTopology = { sessionName: "rdp-tcp#47", state: "Active", adapters: [GTX, REMOTE] };
const RDP_END: RunTopology = { sessionName: "", state: "Disc", adapters: [GTX] };
const CONSOLE: RunTopology = { sessionName: "console", state: "Active", adapters: [GTX] };
// GPU quality Run 2 part 1 (2026-10-03T14:17Z, b3450b43, temp folder awkit-gpu-quality-auto-uAq4tb), as printed: its
// start and end topology; the failure-analysis calls verbatim; every gate's readiness, host and nvidia-smi line
// verbatim (no runner idle reading existed then); the other gates' calls by count, each printed as ON_GPU.
const run2Part1: GateEvidence[] = [
  {
    name: "failure-analysis",
    text: gateText(
      [
        "    · failureAnalysis ok: gpu-offload on vulkan (25 of 25), answer vulkan/full, cold load 14374 ms, first token 1155 ms, generation 7588 ms, 146/256 out (413 in), 23143 ms end to end",
        "    · failureAnalysis ok: gpu-offload on vulkan (25 of 25), answer vulkan/full, warm, first token 766 ms, generation 3623 ms, 24/256 out (340 in), 4397 ms end to end",
        "    · failureAnalysis ok: gpu-offload on vulkan (25 of 25), answer vulkan/full, warm, first token 1974 ms, generation 8242 ms, 163/256 out (790 in), 10228 ms end to end"
      ],
      '[{"ok":true,"nvidiaAdapters":2}]',
      [21140],
      [2302, 2304, 1255]
    ),
    idleVramMib: []
  },
  { name: "locator-upgrade", text: gateText(Array(2).fill(callLine("locatorSemanticUpgrade")), READY, [9812], [2305, 1255]), idleVramMib: [] },
  { name: "authoring-A1", text: gateText(Array(3).fill(callLine("validationExplanation")), READY, [11660], [2304, 2304, 1254]), idleVramMib: [] },
  { name: "authoring-A2", text: gateText(Array(3).fill(callLine("validationExplanation")), READY, [13608], [2295, 2295, 1251]), idleVramMib: [] },
  { name: "authoring-A3", text: gateText(Array(3).fill(callLine("validationExplanation")), READY, [13116], [2304, 2304, 1255]), idleVramMib: [] },
  {
    name: "locator-quality",
    text: gateText([...Array(8).fill(callLine("locatorSemanticUpgrade")), ...Array(2).fill(callLine("locatorRepair"))], READY, [12536], [2300, 2295, 2295, 2295, 2295, 2295, 2292, 2292, 2300, 1251]),
    idleVramMib: []
  }
];
/** One gate on the GPU at the console's levels, with the runner's idle readings around it. */
const gpuGate = (name: string, vram: Array<number | null> = [2036, 2036, 987], idle: Array<number | null> = [985, 986], calls = Array(3).fill(callLine("errorExplanation")), readiness = READY): GateEvidence => ({
  name,
  text: `${gateText(calls, readiness, [9632], vram)}\n${planLine([1])}`,
  idleVramMib: idle
});
{
  const recorded = judge(RDP_START, RDP_END, run2Part1);
  check(
    "the recorded Run 2 part 1 over RDP, which printed no runtime device count: INCONCLUSIVE, since off the console readiness counts the NVIDIA GPU twice and the product's E2 check would pass a second Vulkan device",
    recorded.verdict === "INCONCLUSIVE" && recorded.reasons.length === 6 && recorded.reasons.every((r) => /Vulkan device count was not recorded/.test(r)),
    recorded.reasons
  );
  const rdp = judge(RDP_START, RDP_END, withPlans(run2Part1));
  check(
    `the same record with the runtime's own count (1 Vulkan device, one NVIDIA PCI adapter), over RDP (start ${RDP_START.sessionName} with the Remote Display Adapter, end disconnected): ${COMPUTE_LABELS.remote}`,
    rdp.verdict === "PASS" && rdp.label === COMPUTE_LABELS.remote && rdp.topology === "remote-session" && rdp.reasons.length === 0,
    rdp
  );
  check(
    "...on the one NVIDIA compute adapter, unchanged, with the remote adapter as display topology, and every gate's model held over the model's size in NVIDIA VRAM",
    rdp.computeAdapters.start.join() === "PCI\\VEN_10DE&DEV_13D7&SUBSYS_11291462&REV_A1" &&
      rdp.computeAdapters.end.join() === rdp.computeAdapters.start.join() &&
      rdp.displayOnly.join() === "Microsoft Remote Display Adapter" &&
      rdp.gates.length === 6 &&
      rdp.gates.reduce((n, g) => n + g.calls, 0) === 24 &&
      rdp.gates.every((g) => g.idleMib !== null && g.loadedMib !== null && g.loadedMib - g.idleMib >= MODEL_MIB),
    { MODEL_MIB, gates: rdp.gates }
  );
  check("...and it is never a physical-console topology qualification", rdp.label !== COMPUTE_LABELS.console && !physicalConsole(RDP_START) && !physicalConsole(RDP_END));
  check("readiness's adapter count is not the device proof: the gate where Chromium counted the one NVIDIA GPU twice (RDP) is judged on Windows' one PCI adapter", /"nvidiaAdapters":2/.test(run2Part1[0].text) && rdp.verdict === "PASS");
  const second = judge(RDP_START, RDP_END, withPlans(run2Part1, [2]));
  check("RDP with the runtime binding 2 Vulkan devices for Windows' one NVIDIA adapter (a software ICD, say), which readiness's doubled count lets through: INCONCLUSIVE", second.verdict === "INCONCLUSIVE" && second.reasons.every((r) => /a device beyond them is not proven NVIDIA/.test(r)), second.reasons);
  const atConsole = judge(CONSOLE, CONSOLE, run2Part1);
  check(`control: the recorded evidence at the physical console, where the product's own E2 check is exact, reads ${COMPUTE_LABELS.console} with no recorded count`, atConsole.verdict === "PASS" && atConsole.label === COMPUTE_LABELS.console && atConsole.topology === "physical-console", atConsole);
}
{
  const console0 = { sessionName: "console", state: "Active", adapters: [GTX, REMOTE] };
  const run = judge(console0, CONSOLE, [gpuGate("error-G1")]);
  check("a console session with the Remote Display Adapter present is not the physical console's topology, at the start or the end", !physicalConsole(console0) && run.topology === "remote-session" && run.label !== COMPUTE_LABELS.console, run);
  check("physical console: console Active and no Remote Display Adapter; a disconnected console is not it", physicalConsole(CONSOLE) && !physicalConsole({ ...CONSOLE, state: "Disc" }));
}
{
  const roles = adapterRoles({ sessionName: "rdp-tcp#47", state: "Active", adapters: [GTX, REMOTE] });
  check("the Remote Display Adapter is never a compute GPU: display topology only", roles.compute.length === 1 && roles.displayOnly.join() === "Microsoft Remote Display Adapter" && roles.unknown.length === 0, roles);
  const remoteOnly = judge({ sessionName: "rdp-tcp#47", state: "Active", adapters: [REMOTE] }, { sessionName: "rdp-tcp#47", state: "Active", adapters: [REMOTE] }, [gpuGate("error-G1")]);
  check(`a Remote Display Adapter alone is no compute device: ${COMPUTE_LABELS.unproven}`, remoteOnly.verdict === "INCONCLUSIVE" && remoteOnly.reasons.some((r) => /no compute adapter/.test(r)), remoteOnly);
  const spoofed = { pnpDeviceId: "SWD\\REMOTEDISPLAYENUM\\RDPIDD_INDIRECTDISPLAY&SESSIONID_0002", name: "NVIDIA GeForce GTX 980M" };
  const named = judge({ ...RDP_START, adapters: [GTX, spoofed] }, RDP_END, [gpuGate("error-G1")]);
  check("a remote adapter carrying an NVIDIA name is still no compute GPU (no PCI identity): INCONCLUSIVE", named.verdict === "INCONCLUSIVE" && named.reasons.some((r) => /neither PCI-identified/.test(r)), named);
}
{
  const intel = { pnpDeviceId: "PCI\\VEN_8086&DEV_591B&SUBSYS_00000000&REV_04", name: "Intel(R) HD Graphics 630" };
  const hybrid = judge({ ...RDP_START, adapters: [GTX, intel, REMOTE] }, { ...RDP_END, adapters: [GTX, intel] }, [gpuGate("error-G1")]);
  check("RDP with an ambiguous device, a hybrid machine (NVIDIA + Intel): INCONCLUSIVE, though every call reports Vulkan", hybrid.verdict === "INCONCLUSIVE" && hybrid.reasons.some((r) => /not NVIDIA/.test(r)), hybrid);
  const other = { pnpDeviceId: "PCI\\VEN_10DE&DEV_1C8D&SUBSYS_00000000&REV_A1", name: "NVIDIA GeForce GTX 1050" };
  const changed = judge(RDP_START, { ...RDP_END, adapters: [other] }, [gpuGate("error-G1")]);
  check("RDP with the compute adapter changing between the start and the end: INCONCLUSIVE", changed.verdict === "INCONCLUSIVE" && changed.reasons.some((r) => /changed during the run/.test(r)), changed);
  const unread = judge(RDP_START, RDP_END, [gpuGate("error-G1", [2036, null, 987])]);
  check("RDP with nvidia-smi missing a call: INCONCLUSIVE", unread.verdict === "INCONCLUSIVE" && unread.reasons.some((r) => /did not read/.test(r)), unread);
  const flat = judge(RDP_START, RDP_END, [gpuGate("error-G1", [1252, 1253, 1251], [1250, 1251])]);
  check("RDP with NVIDIA VRAM never rising by the model's size: INCONCLUSIVE, whatever the calls report", flat.verdict === "INCONCLUSIVE" && flat.reasons.some((r) => /less than the model's/.test(r)), flat);
  const rdpShift = judge(RDP_START, RDP_END, [gpuGate("error-G1", [1255, 1256, 1254], [985, 1254])]);
  check("...including a rise of Remote Desktop's own display memory (985 → 1255 MiB), which is under the model's size", rdpShift.verdict === "INCONCLUSIVE", rdpShift);
  const usb = judge({ ...RDP_START, adapters: [GTX, REMOTE, { pnpDeviceId: "USB\\VID_17E9&PID_4301&MI_00\\7&1B2F3C4D&0&0000", name: "DisplayLink USB Device" }] }, RDP_END, [gpuGate("error-G1")]);
  check("an adapter of unknown identity beside the NVIDIA one: INCONCLUSIVE, though readiness answered ok with one NVIDIA adapter", usb.verdict === "INCONCLUSIVE", usb);
}
{
  const fallback = judge(RDP_START, RDP_END, [gpuGate("error-G1", undefined, undefined, [callLine("errorExplanation"), callLine("errorExplanation", "gpu-offload on cpu (0 of 25), answer cpu/cpu"), callLine("errorExplanation")])]);
  check(`RDP with a CPU fallback after Automatic resolved to the GPU: not GPU-qualified, ${COMPUTE_LABELS.wrong}`, fallback.verdict === "FAIL" && fallback.label === COMPUTE_LABELS.wrong, fallback);
  const partial = judge(CONSOLE, CONSOLE, [gpuGate("error-G1", undefined, undefined, Array(3).fill(callLine("errorExplanation", "gpu-offload on vulkan (12 of 25), answer vulkan/partial")))]);
  check("partial offload where every layer was expected FAILS, at the console too", partial.verdict === "FAIL", partial);
  const cpuOnly = judge(
    CONSOLE,
    CONSOLE,
    [gpuGate("error-G1", [null, null, null], [null, null], Array(3).fill(callLine("errorExplanation", "cpu on cpu (0 of 25), answer cpu/cpu")), '[{"ok":false,"reason":"VENDOR_UNPROVEN"}]')]
  );
  check("Automatic resolving to CPU & RAM only (readiness not proven) stays supported: INCONCLUSIVE as GPU evidence, never FAIL", cpuOnly.verdict === "INCONCLUSIVE" && cpuOnly.reasons.some((r) => /did not resolve to the GPU/.test(r)), cpuOnly);
}
{
  const g1Shape = [2036, 2032]; // Run 1's error-G1: both readings before the release landed
  const without = judge(CONSOLE, CONSOLE, [gpuGate("error-G1", g1Shape, [], Array(2).fill(callLine("errorExplanation")))]);
  const withIdle = judge(CONSOLE, CONSOLE, [gpuGate("error-G1", g1Shape, [985, 994], Array(2).fill(callLine("errorExplanation")))]);
  check("a gate whose own readings never caught the release is unproven alone, and proven by the runner's idle readings around it", without.verdict === "INCONCLUSIVE" && withIdle.verdict === "PASS", { without: without.reasons, withIdle: withIdle.gates });
  check("no gate at all is no evidence", judge(CONSOLE, CONSOLE, []).verdict === "INCONCLUSIVE");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 && passed > 0 ? 0 : 1);
