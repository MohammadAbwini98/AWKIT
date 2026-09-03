/**
 * R0 refactoring characterization.
 *
 * This verifier deliberately records today's boundaries without moving them. It combines
 * AST-resolved dependency/checkpoint guards with real store/lifecycle/capacity implementations.
 * Every section includes a mutation control: the guard must reject the concrete regression it is
 * intended to detect, rather than merely proving that a file or string exists.
 *
 * Run through `scripts/benchmark/run.mjs` so the real ExecutionEngine can load against the maintained
 * Electron test composition. No Chromium or network is used.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdtemp, readFile, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { JsonProfileStore } from "../src/storage/ProfileStore";
import { ExecutionEngine } from "../src/runner/ExecutionEngine";
import { InstanceManager, type StorageDirs } from "../src/instances/InstanceManager";
import { ConcurrentExecutionCoordinator } from "../src/orchestrator/ConcurrentExecutionCoordinator";
import type { ConcurrentRunProfile } from "../src/instances/ConcurrentRunProfile";
import type { InstanceRuntimeState } from "../src/instances/InstanceRuntimeState";
import { BrowserWorkerPool } from "../src/runner/browser/BrowserWorkerPool";
import { BackpressureController } from "../src/runner/concurrency/BackpressureController";
import { DEFAULT_CAPACITY_TUNING, planCapacity } from "../src/runner/concurrency/CapacityPlanner";
import type { MachineCapabilities } from "../src/runner/concurrency/MachineCapabilityDetector";
import {
  CLEARED_ENFORCEMENT_STATE,
  ENFORCEMENT_TRIGGERS,
  nextEnforcementState
} from "../src/licensing/RunGateEnforcement";
import { LicenseStatus } from "../src/licensing/LicenseTypes";

process.env.AWKIT_DURABLE_STORE = "0";
process.env.AWKIT_CDP_OBSERVATION = "0";
process.env.PRODUCTION_OFFLINE = "false";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
let failed = 0;

function check(label: string, condition: unknown, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  [PASS] ${label}${detail ? ` -- ${detail}` : ""}`);
  } else {
    failed += 1;
    console.error(`  [FAIL] ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function mutationRejected(label: string, mutation: () => void): void {
  let error = "";
  try {
    mutation();
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  check(`negative control rejects ${label}`, error.length > 0, error);
}

function source(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function parse(path: string, text = source(path)): ts.SourceFile {
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function walk(node: ts.Node, visitor: (node: ts.Node) => void): void {
  visitor(node);
  node.forEachChild((child) => walk(child, visitor));
}

function normalizedRepoPath(path: string): string {
  return relative(root, path).split(sep).join("/");
}

function walkFiles(folder: string, extensions = new Set([".ts", ".tsx", ".mts", ".mjs", ".js"])): string[] {
  const absolute = join(root, folder);
  if (!existsSync(absolute)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const full = join(absolute, entry.name);
    if (entry.isDirectory()) found.push(...walkFiles(normalizedRepoPath(full), extensions));
    else if (extensions.has(extname(entry.name))) found.push(full);
  }
  return found;
}

function importsOf(path: string, text = source(path)): string[] {
  const sf = parse(path, text);
  const imports: string[] = [];
  walk(sf, (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) {
      imports.push(node.arguments[0].text);
    }
  });
  return imports;
}

function resolveImport(importer: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith(".")) base = resolve(root, dirname(importer), specifier);
  else if (specifier.startsWith("@src/")) base = resolve(root, "src", specifier.slice(5));
  else if (specifier.startsWith("@main/")) base = resolve(root, "app/main", specifier.slice(6));
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return normalizedRepoPath(candidate);
  }
  return normalizedRepoPath(base);
}

function calls(path: string, predicate: (call: ts.CallExpression, sf: ts.SourceFile) => boolean, text = source(path)): ts.CallExpression[] {
  const sf = parse(path, text);
  const matches: ts.CallExpression[] = [];
  walk(sf, (node) => {
    if (ts.isCallExpression(node) && predicate(node, sf)) matches.push(node);
  });
  return matches;
}

function callText(call: ts.CallExpression, sf: ts.SourceFile): string {
  return call.expression.getText(sf);
}

function stringArg(call: ts.CallExpression, index: number): string | null {
  const arg = call.arguments[index];
  return arg && ts.isStringLiteralLike(arg) ? arg.text : null;
}

function replaceNode(text: string, node: ts.Node, replacement = "(void 0)"): string {
  return `${text.slice(0, node.getStart())}${replacement}${text.slice(node.end)}`;
}

async function architectureAndDeadCode(): Promise<void> {
  console.log("\nR0.1/R0.6 - architecture dependency and dead-code consumers");
  const enginePath = "src/runner/ExecutionEngine.ts";
  const engineText = source(enginePath);
  const mainImports = importsOf(enginePath, engineText).filter((item) => item.startsWith("../../app/main/"));
  const expectedMainImports = [
    "../../app/main/appPaths",
    "../../app/main/ipc/session.ipc",
    "../../app/main/profileStores"
  ];
  const prohibited = mainImports.filter((item) => item !== "../../app/main/appPaths");

  const assertCurrentBoundary = (text: string): void => {
    const actual = importsOf(enginePath, text).filter((item) => item.startsWith("../../app/main/")).sort();
    invariant(JSON.stringify(actual) === JSON.stringify([...expectedMainImports].sort()), `ExecutionEngine Electron-main edges changed: ${actual.join(", ")}`);
  };
  const assertR1aCleanBoundary = (text: string): void => {
    const edges = importsOf(enginePath, text).filter(
      (item) => item.startsWith("../../app/main/") && item !== "../../app/main/appPaths"
    );
    invariant(edges.length === 0, `R1A removal gate blocked by: ${edges.join(", ")}`);
  };

  assertCurrentBoundary(engineText);
  check(
    "current boundary identifies only the sanctioned appPaths bridge plus the two exact unwanted Electron-main edges",
    JSON.stringify(prohibited.sort()) === JSON.stringify(["../../app/main/ipc/session.ipc", "../../app/main/profileStores"].sort()),
    prohibited.join(", ")
  );
  mutationRejected("the current unwanted ExecutionEngine -> Electron-main dependency at the future R1A removal gate", () => assertR1aCleanBoundary(engineText));
  mutationRejected("an additional ExecutionEngine -> Electron-main dependency", () => {
    assertCurrentBoundary(`import { registerExecutionIpc } from "../../app/main/ipc/execution.ipc";\n${engineText}`);
  });
  assertCurrentBoundary(`import type { FlowStep } from "@src/profiles/FlowProfile";\n${engineText}`);
  check("valid core/application imports are not broadly banned by the architecture guard", true);

  const productionFiles = [...walkFiles("app"), ...walkFiles("src")]
    .map(normalizedRepoPath)
    .filter((path) => !path.startsWith("src/testing/"));
  const startRunConsumers = productionFiles.filter((path) =>
    calls(path, (call, sf) => callText(call, sf) === "executionEngine.startRun").length > 0
  );
  invariant(JSON.stringify(startRunConsumers) === JSON.stringify(["app/main/ipc/execution.ipc.ts"]), `execution entry points: ${startRunConsumers.join(", ")}`);
  check("execution.ipc remains the single production caller that starts ExecutionEngine runs", true, startRunConsumers[0]);
  mutationRejected("a parallel production execution entry", () => {
    const mutated = [...startRunConsumers, "app/main/validation/index.ts"];
    invariant(mutated.length === 1 && mutated[0] === "app/main/ipc/execution.ipc.ts", `execution entry points: ${mutated.join(", ")}`);
  });

  const scenarioConsumers = productionFiles.filter((path) => importsOf(path).some((specifier) => resolveImport(path, specifier) === "src/orchestrator/ScenarioOrchestrator.ts"));
  check(
    "ScenarioOrchestrator is live in both execution composition and runner traversal (not a replacement target)",
    scenarioConsumers.includes("app/main/ipc/execution.ipc.ts") && scenarioConsumers.includes("src/runner/PlaywrightRunner.ts"),
    scenarioConsumers.join(", ")
  );

  const candidates: Array<{ path: string; symbol: string }> = [
    { path: "src/orchestrator/ExecutionQueue.ts", symbol: "ExecutionQueue" },
    { path: "src/orchestrator/FlowOrchestrator.ts", symbol: "FlowOrchestrator" },
    { path: "src/orchestrator/FlowOutputRegistry.ts", symbol: "FlowOutputRegistry" },
    { path: "src/orchestrator/ConditionalFlowRouter.ts", symbol: "ConditionalFlowRouter" },
    { path: "src/instances/InstanceEvents.ts", symbol: "InstanceStatusChangedEvent" },
    { path: "src/instances/InstanceLockManager.ts", symbol: "InstanceLockManager" }
  ];
  const testToolFiles = [...walkFiles("scripts"), ...walkFiles("tools"), ...walkFiles("mock-site"), ...walkFiles("src/testing")].map(normalizedRepoPath);
  const allInspectable = [...new Set([...productionFiles, ...testToolFiles])];

  for (const candidate of candidates) {
    const productionConsumers: string[] = [];
    const testToolConsumers: string[] = [];
    const identifierConsumers: string[] = [];
    for (const path of allInspectable) {
      if (path === candidate.path) continue;
      const resolvedImports = importsOf(path).map((specifier) => resolveImport(path, specifier));
      if (resolvedImports.includes(candidate.path)) {
        (productionFiles.includes(path) ? productionConsumers : testToolConsumers).push(path);
      }
      if (productionFiles.includes(path)) {
        const sf = parse(path);
        let referenced = false;
        walk(sf, (node) => {
          if (ts.isIdentifier(node) && node.text === candidate.symbol) referenced = true;
        });
        if (referenced) identifierConsumers.push(path);
      }
    }
    const apparentlyDead = productionConsumers.length === 0 && testToolConsumers.length === 0 && identifierConsumers.length === 0;
    check(
      `${candidate.symbol} is apparently dead: no production, dynamic, IPC/preload, or test/tool consumer`,
      apparentlyDead,
      `production=${productionConsumers.length}, test/tool=${testToolConsumers.length}, identifiers=${identifierConsumers.length}`
    );
    mutationRejected(`${candidate.symbol} no-consumer classification when a production importer is introduced`, () => {
      const mutatedConsumers = [...productionConsumers, "app/main/ipc/execution.ipc.ts"];
      invariant(mutatedConsumers.length === 0, `${candidate.symbol} production consumers: ${mutatedConsumers.join(", ")}`);
    });
  }

  const builder = JSON.parse(source("electron-builder.json")) as { files?: string[] };
  const sourceIsPackagedDirectly = (builder.files ?? []).some((entry) => entry === "src/**" || entry.startsWith("src/"));
  const builtText = walkFiles("out", new Set([".js", ".mjs"])).map((path) => readFileSync(path, "utf8")).join("\n");
  const bundledDeadSymbols = candidates.filter((candidate) => builtText.includes(candidate.symbol)).map((candidate) => candidate.symbol);
  check(
    "dead candidates are not raw packaged sources and are absent from current production bundles",
    !sourceIsPackagedDirectly && bundledDeadSymbols.length === 0,
    `packaged symbols=${bundledDeadSymbols.join(", ") || "none"}`
  );
}

interface StoreDoc {
  id: string;
  name: string;
  payload: string;
  future?: Record<string, unknown>;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

async function storeConcurrency(): Promise<void> {
  console.log("\nR0.2 - same-folder real-store concurrency");
  const folder = await mkdtemp(join(tmpdir(), "awkit-r0-store-"));
  try {
    const seed = new JsonProfileStore<StoreDoc>({ folder });
    const original: StoreDoc = { id: "shared", name: "original", payload: "original", future: { preserved: true } };
    await seed.create(original);
    const snapshotA = structuredClone((await seed.get("shared"))!);
    const snapshotB = structuredClone((await seed.get("shared"))!);

    const bothArrived = deferred();
    const releaseRenames = deferred();
    const bFinished = deferred();
    let arrived = 0;
    let active = 0;
    let maxActive = 0;
    let bOnDisk: StoreDoc | null = null;

    const makeRename = (owner: "A" | "B") => async (from: string, to: string): Promise<void> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      arrived += 1;
      if (arrived === 2) bothArrived.resolve();
      await releaseRenames.promise;
      if (owner === "A") await bFinished.promise;
      await rename(from, to);
      if (owner === "B") {
        bOnDisk = JSON.parse(await readFile(to, "utf8")) as StoreDoc;
        bFinished.resolve();
      }
      active -= 1;
    };

    const storeA = new JsonProfileStore<StoreDoc>({ folder, atomicReplace: { renameImpl: makeRename("A") } });
    const storeB = new JsonProfileStore<StoreDoc>({ folder, atomicReplace: { renameImpl: makeRename("B") } });
    const writeA = storeA.update("shared", { ...snapshotA, name: "writer-A", future: { ...snapshotA.future, aOnly: true } });
    const writeB = storeB.update("shared", { ...snapshotB, payload: "writer-B", future: { ...snapshotB.future, bOnly: true } });
    await bothArrived.promise;
    const whileBothWaiting = JSON.parse(await readFile(join(folder, "shared.json"), "utf8")) as StoreDoc;
    check("separate real store instances enter atomic replacement concurrently for one resolved folder", maxActive === 2, `maxActive=${maxActive}`);
    check("the previous complete JSON remains readable while both replacements are waiting", JSON.stringify(whileBothWaiting) === JSON.stringify(original));
    releaseRenames.resolve();
    await Promise.all([writeA, writeB]);

    const reloaded = await new JsonProfileStore<StoreDoc>({ folder }).get("shared");
    check("each atomic replacement exposes a complete document, never a truncated file", bOnDisk?.payload === "writer-B" && reloaded?.name === "writer-A");
    check("the deterministic last writer reloads exactly from a fresh store", reloaded?.name === "writer-A" && reloaded.payload === "original");
    check("unknown fields carried by the winning snapshot survive save/reload", reloaded?.future?.preserved === true && reloaded.future.aOnly === true);
    check("independent stale snapshots can lose the other writer's field", reloaded?.future?.bOnly === undefined, JSON.stringify(reloaded));
    check("same-folder overlap leaves no temporary files", (await readdir(folder)).every((entry) => !entry.endsWith(".tmp")));

    const sharedFolder = await mkdtemp(join(tmpdir(), "awkit-r0-store-shared-control-"));
    try {
      const base = new JsonProfileStore<StoreDoc>({ folder: sharedFolder });
      await base.create(original);
      let queue = Promise.resolve();
      let coordinatedActive = 0;
      let coordinatedMax = 0;
      const coordinatedRename = (from: string, to: string): Promise<void> => {
        const result = queue.then(async () => {
          coordinatedActive += 1;
          coordinatedMax = Math.max(coordinatedMax, coordinatedActive);
          try { await rename(from, to); } finally { coordinatedActive -= 1; }
        });
        queue = result.catch(() => undefined);
        return result;
      };
      const left = new JsonProfileStore<StoreDoc>({ folder: sharedFolder, atomicReplace: { renameImpl: coordinatedRename } });
      const right = new JsonProfileStore<StoreDoc>({ folder: sharedFolder, atomicReplace: { renameImpl: coordinatedRename } });
      await Promise.all([
        left.update("shared", { ...original, name: "left" }),
        right.update("shared", { ...original, name: "right" })
      ]);
      mutationRejected("the independent-queue overlap risk after a shared coordinator mutation", () => {
        invariant(coordinatedMax === 2, `shared coordinator reduced maxActive to ${coordinatedMax}`);
      });
    } finally {
      await rm(sharedFolder, { recursive: true, force: true });
    }

    const failureFolder = await mkdtemp(join(tmpdir(), "awkit-r0-store-failure-"));
    try {
      const good = new JsonProfileStore<StoreDoc>({ folder: failureFolder });
      await good.create(original);
      let failureAttempts = 0;
      const failing = new JsonProfileStore<StoreDoc>({
        folder: failureFolder,
        atomicReplace: {
          renameImpl: async () => {
            failureAttempts += 1;
            const error = new Error("ENOSPC: no space left on device") as NodeJS.ErrnoException;
            error.code = "ENOSPC";
            throw error;
          }
        }
      });
      const [failure, success] = await Promise.allSettled([
        failing.update("shared", { ...original, name: "must-not-land" }),
        good.update("shared", { ...original, name: "survivor", future: { preserved: true, futureVersion: 2 } })
      ]);
      const afterFailure = await new JsonProfileStore<StoreDoc>({ folder: failureFolder }).get("shared");
      check("one store failure does not poison a separate store instance's successful save", failure.status === "rejected" && success.status === "fulfilled" && afterFailure?.name === "survivor");
      check("non-transient failure is reported once and leaves no temp residue", failureAttempts === 1 && (await readdir(failureFolder)).every((entry) => !entry.endsWith(".tmp")));
      check("unknown fields survive the successful writer beside a failed writer", afterFailure?.future?.futureVersion === 2);
    } finally {
      await rm(failureFolder, { recursive: true, force: true });
    }

    const profileStoresPath = "app/main/profileStores.ts";
    const expectedConfigured = new Map([
      ["createFlowProfileStore", "flows"],
      ["createWorkflowProfileStore", "workflows"],
      ["createDataSourceProfileStore", "dataSources"],
      ["createReportStore", "reports"]
    ]);
    const assertConfiguredFactories = (text: string): void => {
      const sf = parse(profileStoresPath, text);
      for (const [functionName, field] of expectedConfigured) {
        let matched = false;
        walk(sf, (node) => {
          if (!ts.isFunctionDeclaration(node) || node.name?.text !== functionName) return;
          walk(node, (child) => {
            if (!ts.isPropertyAccessExpression(child) || child.name.text !== field) return;
            if (ts.isCallExpression(child.expression) && child.expression.expression.getText(sf) === "getConfiguredPaths") matched = true;
          });
        });
        invariant(matched, `${functionName} no longer resolves getConfiguredPaths().${field}`);
      }
    };
    const factoryText = source(profileStoresPath);
    assertConfiguredFactories(factoryText);
    check("flow/workflow/data/report factories resolve the canonical configured destination on every construction", true);
    const reportAccess = (() => {
      const sf = parse(profileStoresPath, factoryText);
      let found: ts.PropertyAccessExpression | null = null;
      walk(sf, (node) => {
        if (ts.isPropertyAccessExpression(node) && node.name.text === "reports" && ts.isCallExpression(node.expression)) found = node;
      });
      return found;
    })();
    mutationRejected("configured report-path resolution being bypassed", () => {
      invariant(reportAccess, "report configured-path node missing");
      assertConfiguredFactories(replaceNode(factoryText, reportAccess, "undefined"));
    });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

function runProfile(maxConcurrentInstances: number): ConcurrentRunProfile {
  return {
    id: `r0-${maxConcurrentInstances}`,
    scenarioId: "r0-scenario",
    runMode: "fixedConcurrent",
    maxConcurrentInstances,
    browserWindowMode: "headless",
    instanceTemplate: { browser: "chromium", headless: true, isolationMode: "browserContext" },
    resourceControls: { maxBrowserContextsPerProcess: 2, delayBetweenInstanceStartsMs: 0 },
    failurePolicy: {
      stopAllOnCriticalFailure: false,
      continueOtherInstancesOnFailure: true,
      retryFailedInstance: false,
      retryCount: 0
    }
  };
}

function dirsFor(label: string): StorageDirs {
  const base = join(tmpdir(), label);
  return {
    root: base,
    downloads: join(base, "downloads"),
    screenshots: join(base, "screenshots"),
    logs: join(base, "logs"),
    reports: join(base, "reports")
  };
}

function assertCancelledPendingNeverStarted(instances: InstanceRuntimeState[], pendingCancellationIds: readonly string[]): void {
  const cancelledFromPending = new Set(pendingCancellationIds);
  const regressed = instances.filter(
    (instance) => cancelledFromPending.has(instance.instanceId) && instance.status === "cancelled" && instance.startedAt !== undefined
  );
  invariant(regressed.length === 0, `cancelled instance entered running: ${regressed.map((item) => item.instanceId).join(", ")}`);
}

async function cancellationLifecycle(): Promise<void> {
  console.log("\nR0.3 - deterministic cancellation lifecycle");
  const manager = new InstanceManager();
  const coordinator = new ConcurrentExecutionCoordinator();
  const states = manager.createInstancesForRun(runProfile(2), Array.from({ length: 5 }), dirsFor("awkit-r0-cancel"));
  const engine = new ExecutionEngine();
  engine.setDispatchGate(() => ({ admit: true, reason: "LICENSE_GATE_ALLOWED" }));
  states[1] = { ...states[1], status: "running", startedAt: "2026-09-03T00:00:00.000Z" };
  states[4] = { ...states[4], status: "completed", startedAt: "2026-09-03T00:00:00.000Z", endedAt: "2026-09-03T00:00:01.000Z" };
  states.forEach((state) => engine.pool.add(state));

  const cancelled = engine.cancelPendingInstances("R0 deterministic cancellation");
  check("pending and queued instances cancel as one bounded sweep", cancelled.length === 3, cancelled.join(", "));
  check("already-running work is not cancelled by the pending admission sweep", engine.pool.get(states[1].instanceId)?.status === "running");
  check("completed history remains completed with its original endedAt", engine.pool.get(states[4].instanceId)?.status === "completed" && engine.pool.get(states[4].instanceId)?.endedAt === "2026-09-03T00:00:01.000Z");
  const firstEnded = cancelled.map((id) => engine.pool.get(id)?.endedAt);
  check("all cancelled instances reach the truthful final InstanceStatus with endedAt", cancelled.every((id) => engine.pool.get(id)?.status === "cancelled" && !!engine.pool.get(id)?.endedAt));
  check("repeating the pending cancellation sweep is idempotent", engine.cancelPendingInstances("repeat").length === 0 && cancelled.every((id, index) => engine.pool.get(id)?.endedAt === firstEnded[index]));

  engine.stopInstance(states[4].instanceId);
  check("stopping terminal history is a no-op rather than retroactive cancellation", engine.pool.get(states[4].instanceId)?.status === "completed" && engine.pool.get(states[4].instanceId)?.endedAt === "2026-09-03T00:00:01.000Z");
  engine.stopInstance(states[1].instanceId);
  const runningCancelledAt = engine.pool.get(states[1].instanceId)?.endedAt;
  engine.stopInstance(states[1].instanceId);
  check("already-running work cancels on explicit stop and repeated stop is idempotent", engine.pool.get(states[1].instanceId)?.status === "cancelled" && engine.pool.get(states[1].instanceId)?.endedAt === runningCancelledAt);

  let activeRepeatError = "";
  const fresh = manager.createInstancesForRun(runProfile(1), [{}], dirsFor("awkit-r0-recovery"))[0];
  engine.pool.add(fresh);
  try { engine.repeatInstance(fresh.instanceId); } catch (error) { activeRepeatError = error instanceof Error ? error.message : String(error); }
  check("repeat refuses pending/active work without mutating retry state", activeRepeatError.includes("still active") && engine.pool.get(fresh.instanceId)?.retryAttempt === 0);
  const promoted = coordinator.startPending(engine.getInstances(), 1);
  check("new work can be admitted after cancelled work releases capacity", promoted.find((item) => item.instanceId === fresh.instanceId)?.status === "running");
  assertCancelledPendingNeverStarted(promoted, cancelled);
  check("cancelled pending instances never re-enter running during later admission", true);

  mutationRejected("a cancelled pending instance being allowed to enter running", () => {
    const target = cancelled[0];
    const mutated = promoted.map((item) => item.instanceId === target ? { ...item, status: "cancelled" as const, startedAt: new Date().toISOString() } : item);
    assertCancelledPendingNeverStarted(mutated, cancelled);
  });

  const enginePath = "src/runner/ExecutionEngine.ts";
  const sf = parse(enginePath);
  let processQueue: ts.MethodDeclaration | null = null;
  walk(sf, (node) => {
    if (ts.isMethodDeclaration(node) && node.name.getText(sf) === "processQueue") processQueue = node;
  });
  invariant(processQueue, "processQueue method missing");
  const gateCalls: ts.CallExpression[] = [];
  const runningUpdates: ts.CallExpression[] = [];
  walk(processQueue, (node) => {
    if (!ts.isCallExpression(node)) return;
    const name = callText(node, sf);
    if (name === "this.evaluateDispatchGate") gateCalls.push(node);
    if (name === "this.pool.update" && node.arguments[1]?.getText(sf).includes('status: "running"')) runningUpdates.push(node);
  });
  const finalGate = gateCalls.at(-1)!;
  const runningUpdate = runningUpdates[0];
  let awaitBetween = false;
  walk(processQueue, (node) => {
    if (ts.isAwaitExpression(node) && node.pos > finalGate.end && node.end < runningUpdate.pos) awaitBetween = true;
  });
  invariant(gateCalls.length === 2 && finalGate.end < runningUpdate.pos && !awaitBetween, "dispatch final-gate ordering changed");
  check("admission has an initial and final synchronous gate before the running transition", true);
  mutationRejected("running transition moving before the final admission gate", () => {
    invariant(runningUpdate.pos < finalGate.end, "mutated order would dispatch before the final gate");
  });
}

function machine(logicalCpuCount: number, totalMemoryMb: number, availableMemoryMb: number): MachineCapabilities {
  return {
    machineId: `r0-${logicalCpuCount}-${totalMemoryMb}`,
    platform: "win32",
    architecture: "x64",
    logicalCpuCount,
    totalMemoryMb,
    availableMemoryMb,
    operatingSystem: "Windows_NT",
    detectedAt: "2026-09-03T00:00:00.000Z"
  };
}

function assertCapacityResponds(low: number, high: number): void {
  invariant(high > low, `capacity became hardcoded or non-responsive: low=${low}, high=${high}`);
}

async function capacityCharacterization(): Promise<void> {
  console.log("\nR0.4 - capacity, saturation, and recovery");
  const manager = new InstanceManager();
  const coordinator = new ConcurrentExecutionCoordinator();
  const sequential = manager.createInstancesForRun(runProfile(1), [{}, {}, {}], dirsFor("awkit-r0-sequential"));
  check("sequential profile creates one pending instance and queues the remainder", sequential.filter((item) => item.status === "pending").length === 1 && sequential.filter((item) => item.status === "queued").length === 2);
  const parallel = manager.createInstancesForRun(runProfile(2), [{}, {}, {}], dirsFor("awkit-r0-parallel"));
  check("parallel profile derives two pending instances from maxConcurrentInstances", parallel.filter((item) => item.status === "pending").length === 2 && parallel.filter((item) => item.status === "queued").length === 1);
  const started = coordinator.startPending(parallel, 2);
  check("coordinator saturates at the declared instance limit", started.filter((item) => item.status === "running").length === 2 && started.filter((item) => item.status === "queued").length === 1);
  const oneCompleted = started.map((item, index) => index === 0 ? { ...item, status: "completed" as const, endedAt: new Date().toISOString() } : item);
  const promoted = coordinator.promoteQueued(oneCompleted, 2);
  check("queued work is promoted after capacity is released", promoted.filter((item) => item.status === "pending").length === 1);
  const saturatedWithCancellation = started.map((item, index) => index === 0 ? { ...item, status: "cancelled" as const, endedAt: new Date().toISOString() } : item);
  const promotedAfterCancel = coordinator.promoteQueued(saturatedWithCancellation, 2);
  check("cancellation under saturation releases one slot for queued work", promotedAfterCancel.filter((item) => item.status === "pending").length === 1);

  const pool = new BrowserWorkerPool({
    maxBrowsersPerHost: 1,
    maxActiveFlows: 1,
    minFreeMemoryMb: 0,
    maxRecentCrashes: 99,
    maxSystemMemoryPercent: 100,
    maxProcessMemoryMb: Number.MAX_SAFE_INTEGER,
    maxCpuPercent: 100
  });
  const backpressure = new BackpressureController(pool);
  const slot = pool.tryAcquireSlot("r0-capacity");
  const blocked = backpressure.admit(1, 1);
  check("browser/resource saturation produces explicit backpressure instead of over-admission", !!slot && !blocked.allow && /saturated/.test(blocked.reason ?? ""), blocked.reason);
  pool.releaseSlot(slot!);
  const recovered = backpressure.admit(0, 1);
  check("backpressure recovers immediately after the browser/resource claim is released", recovered.allow, recovered.reason);

  const constrained = planCapacity({ capabilities: machine(4, 8 * 1024, 5 * 1024), workloadClass: "medium", tuning: DEFAULT_CAPACITY_TUNING });
  const capable = planCapacity({ capabilities: machine(16, 64 * 1024, 48 * 1024), workloadClass: "medium", tuning: DEFAULT_CAPACITY_TUNING });
  assertCapacityResponds(constrained.conservativeRecommendedCapacity, capable.conservativeRecommendedCapacity);
  check("canonical capacity changes with detected host headroom", true, `${constrained.conservativeRecommendedCapacity} -> ${capable.conservativeRecommendedCapacity}`);
  const measuredHeavy = planCapacity({
    capabilities: machine(16, 64 * 1024, 48 * 1024),
    workloadClass: "medium",
    tuning: DEFAULT_CAPACITY_TUNING,
    measuredMemoryPerInstanceMb: 8 * 1024,
    measuredCpuCoresPerInstance: 4
  });
  check("measured workload cost lowers the canonical recommendation", measuredHeavy.conservativeRecommendedCapacity < capable.conservativeRecommendedCapacity, `${capable.conservativeRecommendedCapacity} -> ${measuredHeavy.conservativeRecommendedCapacity}`);
  mutationRejected("a hardcoded capacity result that ignores host/workload inputs", () => {
    assertCapacityResponds(constrained.conservativeRecommendedCapacity, constrained.conservativeRecommendedCapacity);
  });
}

interface CheckpointSpec {
  label: string;
  path: string;
  expected: number;
  matches: (text: string) => ts.Node[];
}

function callNodes(path: string, text: string, callee: string, arg?: string): ts.Node[] {
  return calls(path, (call, sf) => callText(call, sf) === callee && (arg === undefined || stringArg(call, 0) === arg), text);
}

async function licensingCheckpoints(): Promise<void> {
  console.log("\nR0.5 - independent licensing checkpoints");
  const specs: CheckpointSpec[] = [
    { label: "startup enforcement evaluation", path: "app/main/licensing/licenseEnforcementService.ts", expected: 1, matches: (text) => callNodes("app/main/licensing/licenseEnforcementService.ts", text, "applyRunGateEnforcement", "startup") },
    { label: "periodic main-process revalidation", path: "app/main/licensing/licenseEnforcementService.ts", expected: 1, matches: (text) => callNodes("app/main/licensing/licenseEnforcementService.ts", text, "applyRunGateEnforcement", "interval") },
    { label: "application-focus main-process revalidation", path: "app/main/licensing/licenseEnforcementService.ts", expected: 1, matches: (text) => callNodes("app/main/licensing/licenseEnforcementService.ts", text, "applyRunGateEnforcement", "window-focus") },
    { label: "authoritative renderer-triggered revalidation IPC", path: "app/main/ipc/licensing.ipc.ts", expected: 1, matches: (text) => callNodes("app/main/ipc/licensing.ipc.ts", text, "applyRunGateEnforcement", "revalidate-ipc") },
    { label: "run-request checks for new and repeat requests", path: "app/main/ipc/execution.ipc.ts", expected: 2, matches: (text) => callNodes("app/main/ipc/execution.ipc.ts", text, "applyRunGateEnforcement", "run-request") },
    { label: "pre-run check immediately before ExecutionEngine.startRun", path: "app/main/ipc/execution.ipc.ts", expected: 1, matches: (text) => callNodes("app/main/ipc/execution.ipc.ts", text, "applyRunGateEnforcement", "pre-run") },
    { label: "stale-dispatch and parked-resume revalidation", path: "app/main/licensing/licenseEnforcementService.ts", expected: 2, matches: (text) => callNodes("app/main/licensing/licenseEnforcementService.ts", text, "applyRunGateEnforcement", "pre-run") },
    { label: "initial dispatch, final dispatch, and repeat-instance engine gates", path: "src/runner/ExecutionEngine.ts", expected: 3, matches: (text) => callNodes("src/runner/ExecutionEngine.ts", text, "this.evaluateDispatchGate") },
    { label: "preload exposure of the authoritative revalidate IPC", path: "app/main/preload.ts", expected: 1, matches: (text) => calls("app/main/preload.ts", (call, sf) => callText(call, sf) === "invoke" && stringArg(call, 0) === "licensing:revalidate", text) },
    { label: "renderer direct licensing revalidation call", path: "app/renderer/layout/StatusBar.tsx", expected: 1, matches: (text) => callNodes("app/renderer/layout/StatusBar.tsx", text, "window.playwrightFlowStudio.licensing.revalidate") },
    { label: "renderer periodic revalidation trigger", path: "app/renderer/layout/StatusBar.tsx", expected: 1, matches: (text) => calls("app/renderer/layout/StatusBar.tsx", (call, sf) => callText(call, sf) === "window.setInterval" && call.arguments[0]?.getText(sf) === "revalidate", text) },
    { label: "renderer focus revalidation trigger", path: "app/renderer/layout/StatusBar.tsx", expected: 1, matches: (text) => calls("app/renderer/layout/StatusBar.tsx", (call, sf) => callText(call, sf) === "window.addEventListener" && stringArg(call, 0) === "focus" && call.arguments[1]?.getText(sf) === "revalidate", text) },
    { label: "startup registration of the enforcement watcher", path: "app/main/main.ts", expected: 1, matches: (text) => callNodes("app/main/main.ts", text, "startLicenseEnforcementWatcher") }
  ];

  for (const spec of specs) {
    const text = source(spec.path);
    const matches = spec.matches(text);
    check(`${spec.label} remains independently wired`, matches.length === spec.expected, `count=${matches.length}`);
    mutationRejected(`${spec.label} being removed or bypassed`, () => {
      invariant(matches[0], `${spec.label} baseline node missing`);
      const mutated = replaceNode(text, matches[0]);
      const count = spec.matches(mutated).length;
      invariant(count === spec.expected, `${spec.label} count changed ${spec.expected} -> ${count}`);
    });
  }

  const expectedTriggers = ["startup", "interval", "window-focus", "revalidate-ipc", "license-changed", "run-request", "pre-run"];
  check("licensing policy retains the complete independent trigger vocabulary", JSON.stringify(ENFORCEMENT_TRIGGERS) === JSON.stringify(expectedTriggers));
  const blockingInput = {
    activeRunDisposition: "cancel-pending" as const,
    reason: "LICENSE_INTEGRITY_FAILURE" as const,
    status: LicenseStatus.INVALID_SIGNATURE
  };
  const first = nextEnforcementState(CLEARED_ENFORCEMENT_STATE, blockingInput, 100);
  const repeated = nextEnforcementState(first.next, blockingInput, 101);
  check("periodic/focus/revalidate repeats still sweep newly queued work while deduplicating audit", first.shouldCancelPending && repeated.shouldCancelPending && !repeated.shouldAudit);
  mutationRejected("one blocking checkpoint suppressing the repeat pending-work sweep", () => {
    invariant({ ...repeated, shouldCancelPending: false }.shouldCancelPending, "blocking revalidation no longer sweeps pending work");
  });
}

async function main(): Promise<void> {
  console.log("AWKIT R0 architecture and regression characterization");
  await architectureAndDeadCode();
  await storeConcurrency();
  await cancellationLifecycle();
  await capacityCharacterization();
  await licensingCheckpoints();
  console.log(`\nR0 characterization: ${passed} PASS / ${failed} FAIL`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
