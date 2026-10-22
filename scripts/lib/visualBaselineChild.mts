/**
 * Child process for verify:visual-baseline-cross-process (Phase N, N6.3). A real Node process running the
 * production flow-store hooks, VisualBaselineStore and cross-process lock against a shared temporary
 * flows folder. The parent drives it over the IPC channel; pauses inside the critical section are released
 * only by explicit parent signals (barriers), never by timing.
 *
 * Mutant configurations (each removes one protection; used only to prove the verifier detects it):
 *   no-lock              flow writes skip the cross-process lock (in-process lane only)
 *   swallow-lock-errors  an acquisition failure is ignored and the write proceeds
 *   no-fence             the fencing check before a protected write is skipped
 *   textual-identity     the folder identity and lock location follow the configured spelling, not the folder
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import type { FlowProfile } from "@src/profiles/FlowProfile";
import { FlowBaselineLifecycle } from "@src/runner/visualAssertion/flowBaselineLifecycle";
import { VisualBaselineStore } from "@src/runner/visualAssertion/VisualBaselineStore";
import { VisualBaselineLayout, sha256Hex } from "@src/runner/visualAssertion/visualBaselineLayout";
import { visualStepContentDigest } from "@src/runner/visualAssertion/stepContentDigest";
import { CrossProcessLockError } from "@src/storage/crossProcessLock";
import { JsonProfileStore, type ProfileWriteContext } from "@src/storage/ProfileStore";
import { conditions, geometry, PIXELS, testProtector } from "./visualBaselineKit.mts";

type Mutant = "none" | "no-lock" | "swallow-lock-errors" | "no-fence" | "textual-identity";

interface InitArgs {
  flowsFolder: string;
  runtimeRoot: string;
  mode: "dev" | "packaged";
  lockTimeoutMs: number;
  deadProbe?: boolean;
  mutant?: Mutant;
}

const signals = new Map<string, Array<() => void>>();
const pendingSignals = new Set<string>();
function waitFor(name: string): Promise<void> {
  if (pendingSignals.delete(name)) return Promise.resolve();
  return new Promise((resolve) => signals.set(name, [...(signals.get(name) ?? []), resolve]));
}
function emit(event: string, data: Record<string, unknown> = {}): void {
  process.send?.({ event, ...data });
}

let pauseOn: { operation?: string; deletion?: boolean } = {};

function makeLayout(args: InitArgs): VisualBaselineLayout {
  const options = {
    flowsFolder: args.flowsFolder,
    runtimeRoot: args.runtimeRoot,
    lockTimeoutMs: args.lockTimeoutMs,
    isProcessAlive: args.deadProbe ? () => false : undefined
  };
  const mutant = args.mutant ?? "none";
  class ChildLayout extends VisualBaselineLayout {
    constructor() {
      super(options);
    }
    protected override async lockOptions() {
      const real = await super.lockOptions();
      return mutant === "textual-identity" ? { ...real, directory: join(args.runtimeRoot, "textual-locks", sha256Hex(args.flowsFolder)) } : real;
    }
    override async folderKey(): Promise<string> {
      return mutant === "textual-identity" ? sha256Hex(`textual\u0000${args.flowsFolder}`) : super.folderKey();
    }
    override async exclusive<R>(task: () => Promise<R>): Promise<R> {
      if (mutant === "no-lock") return task();
      if (mutant === "swallow-lock-errors") {
        try {
          return await super.exclusive(task);
        } catch (error) {
          if (error instanceof CrossProcessLockError) return task();
          throw error;
        }
      }
      return super.exclusive(task);
    }
    override async assertHeld(): Promise<void> {
      if (mutant === "no-lock" || mutant === "no-fence") return;
      if (mutant === "swallow-lock-errors") return super.assertHeld().catch(() => undefined);
      return super.assertHeld();
    }
    protected override async deleteSignedFiles(flowId: string): Promise<void> {
      if (pauseOn.deletion) {
        pauseOn = {};
        emit("paused");
        await waitFor("continue");
      }
      return super.deleteSignedFiles(flowId);
    }
  }
  return new ChildLayout();
}

class PausingLifecycle extends FlowBaselineLifecycle {
  protected override async onWrite(context: ProfileWriteContext<FlowProfile>): Promise<void> {
    await super.onWrite(context);
    if (pauseOn.operation === context.operation) {
      pauseOn = {};
      emit("paused");
      await waitFor("continue");
    }
  }
}

let state: { args: InitArgs; layout: VisualBaselineLayout; flows: JsonProfileStore<FlowProfile>; store: VisualBaselineStore } | null = null;

function init(args: InitArgs): void {
  const layout = makeLayout(args);
  const lifecycle = new PausingLifecycle(layout);
  const flows = new JsonProfileStore<FlowProfile>({ folder: args.flowsFolder, hooks: lifecycle.hooks() });
  const store = new VisualBaselineStore({ layout, appMode: args.mode, protector: testProtector(), readFlow: (id) => flows.get(id) });
  state = { args, layout, flows, store };
}

async function digestOf(flowId: string, stepId: string): Promise<string | null> {
  const flow = await state!.flows.get(flowId);
  const step = flow?.nodes.find((n) => n.id === stepId);
  return step ? visualStepContentDigest(step as unknown as { id: string } & Record<string, unknown>) : null;
}

async function handle(cmd: string, args: Record<string, unknown>): Promise<unknown> {
  if (cmd === "init") {
    init(args as unknown as InitArgs);
    return { pid: process.pid };
  }
  const s = state!;
  switch (cmd) {
    case "ping":
      return "pong";
    case "pause":
      pauseOn = args as typeof pauseOn;
      return true;
    case "hold":
      await s.layout.coordinate(async () => {
        emit("holding");
        await waitFor("release");
      });
      return true;
    case "hold-then-guarded-write": {
      let inner: { written: boolean; code?: string } = { written: false };
      try {
        await s.layout.coordinate(async () => {
          emit("holding");
          await waitFor("resume");
          try {
            await s.layout.assertHeld();
            writeFileSync(String(args.marker), "A");
            inner = { written: true };
          } catch (error) {
            inner = { written: false, code: (error as { code?: string }).code ?? (error as Error).message };
          }
        });
        return { ...inner, outer: "ok" };
      } catch (error) {
        return { ...inner, outer: (error as { code?: string }).code ?? (error as Error).message };
      }
    }
    case "guarded-write":
      await s.layout.coordinate(async () => {
        await s.layout.assertHeld();
        writeFileSync(String(args.marker), String(args.value));
      });
      return true;
    case "create-flow":
      await s.flows.create(args.profile as FlowProfile);
      return true;
    case "import-flow":
      await s.flows.import(args.profile as FlowProfile);
      return true;
    case "write-flow":
      await s.flows.update(String(args.id), args.profile as FlowProfile);
      return true;
    case "ensure-token":
      return s.store.ensureToken(String(args.flowId));
    case "read-token":
      return s.layout.readToken(String(args.flowId));
    case "step-digest":
      return digestOf(String(args.flowId), String(args.stepId));
    case "prepare-approval": {
      const flowId = String(args.flowId);
      const stepId = String(args.stepId);
      const boundEpoch = await s.store.ensureToken(flowId);
      return {
        flowId,
        stepId,
        stepContentDigest: await digestOf(flowId, stepId),
        conditions: conditions(),
        epoch: boundEpoch,
        width: 48,
        height: 40,
        contentDigest: PIXELS.baseline,
        geometry: geometry(),
        boundEpoch,
        boundKeyGeneration: await s.store.keyGeneration(),
        approver: "author-1",
        runUser: "runner-1",
        runId: "run-1",
        appVersion: "0.1.53"
      };
    }
    case "approve":
      return s.store.approveUnchecked(args.request as never);
    case "lookup":
      return s.store.lookup({ flowId: String(args.flowId), stepId: String(args.stepId), stepContentDigest: String(args.digest), conditions: conditions() });
    case "sweep":
      return s.store.sweep();
    case "switch-folder":
      init({ ...s.args, flowsFolder: String(args.flowsFolder) });
      return true;
    default:
      throw new Error(`unknown command ${cmd}`);
  }
}

process.on("message", (message: { id?: number; cmd?: string; args?: Record<string, unknown>; signal?: string }) => {
  if (message.signal) {
    const waiting = signals.get(message.signal);
    if (waiting && waiting.length > 0) {
      signals.delete(message.signal);
      for (const resolve of waiting) resolve();
    } else {
      pendingSignals.add(message.signal);
    }
    return;
  }
  if (message.cmd === "exit") process.exit(0);
  const id = message.id;
  handle(message.cmd ?? "", message.args ?? {}).then(
    (result) => process.send?.({ id, ok: true, result }),
    (error: unknown) => process.send?.({ id, ok: false, error: { code: (error as { code?: string }).code ?? "error", message: (error as Error).message } })
  );
});
process.send?.({ event: "ready" });
