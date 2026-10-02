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
 *  E. Wiring: the three GPU modes and the launcher use these helpers.
 *
 * Run: npm run verify:ai-gpu-harness
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { classifyAdapters } from "@src/ai/AiExecutionProfile";

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
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 && passed > 0 ? 0 : 1);
