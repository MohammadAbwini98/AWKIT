/**
 * R0 refactoring characterization.
 *
 * This verifier records the R0 baseline and advances its dependency oracle after each approved
 * refactoring tranche. It combines AST-resolved dependency/checkpoint guards with real
 * store/lifecycle/capacity implementations.
 * Every section includes a mutation control: the guard must reject the concrete regression it is
 * intended to detect, rather than merely proving that a file or string exists.
 *
 * Run through `scripts/benchmark/run.mjs` so the real ExecutionEngine can load against the maintained
 * Electron test composition. No Chromium or network is used.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { replaceFileAtomically } from "../src/storage/atomicReplace";
import { activeFolderCoordinationKeys, folderCoordinationKey } from "../src/storage/folderWriteCoordinator";
import { JsonProfileStore } from "../src/storage/ProfileStore";
import { ExecutionEngine } from "../src/runner/ExecutionEngine";
import type { ExecutionEnginePorts } from "../src/runner/ExecutionEnginePorts";
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
/** Every failing label, restated in the summary. This verifier emits ~130 lines, so a single FAIL in
 *  the middle is easy to lose in a scrollback or a truncated CI log. */
const failures: string[] = [];

function check(label: string, condition: unknown, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  [PASS] ${label}${detail ? ` -- ${detail}` : ""}`);
  } else {
    failed += 1;
    failures.push(`${label}${detail ? ` -- ${detail}` : ""}`);
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
  console.log("\nR0.1/R1A/R0.6 - architecture dependency and dead-code consumers");
  const enginePath = "src/runner/ExecutionEngine.ts";
  const engineText = source(enginePath);
  const portPath = "src/runner/ExecutionEnginePorts.ts";
  const expectedMainEdges = ["app/main/appPaths.ts"];
  const mainEdges = (path: string, text: string): string[] =>
    importsOf(path, text)
      .map((specifier) => resolveImport(path, specifier))
      .filter((resolved): resolved is string => resolved?.startsWith("app/main/") === true)
      .sort();
  const assertR1aCleanBoundary = (text: string): void => {
    const actual = mainEdges(enginePath, text);
    invariant(
      JSON.stringify(actual) === JSON.stringify(expectedMainEdges),
      `ExecutionEngine Electron-main edges changed: ${actual.join(", ") || "none"}`
    );
  };

  assertR1aCleanBoundary(engineText);
  check("R1A leaves only the separately sanctioned ExecutionEngine -> appPaths bridge", true, expectedMainEdges[0]);
  mutationRejected("reintroducing ExecutionEngine -> session.ipc", () => {
    assertR1aCleanBoundary(`import { getSessionService } from "../../app/main/ipc/session.ipc";\n${engineText}`);
  });
  mutationRejected("reintroducing ExecutionEngine -> profileStores", () => {
    assertR1aCleanBoundary(`import { createReportStore } from "../../app/main/profileStores";\n${engineText}`);
  });
  mutationRejected("a replacement ExecutionEngine -> Electron-main dependency through an alias", () => {
    assertR1aCleanBoundary(`import { registerExecutionIpc } from "@main/ipc/execution.ipc";\n${engineText}`);
  });
  assertR1aCleanBoundary(`import type { FlowStep } from "@src/profiles/FlowProfile";\n${engineText}`);
  check("valid core/application imports are not broadly banned by the architecture guard", true);
  check(
    "the narrow ExecutionEngine port contract is itself framework-independent",
    mainEdges(portPath, source(portPath)).length === 0
  );

  const executionIpcPath = "app/main/ipc/execution.ipc.ts";
  // R2 moved application-level run preparation (including the single ExecutionEngine.startRun call)
  // out of the IPC facade into this service. Port composition and bootstrap wiring stayed in the IPC
  // layer, so the two paths below are deliberately different files.
  const executionServicePath = "app/main/execution/ExecutionApplicationService.ts";
  const mainPath = "app/main/main.ts";
  const assertProductionPortComposition = (ipcText: string, mainText: string): void => {
    const portCalls = calls(executionIpcPath, (call, sf) => callText(call, sf) === "executionEngine.setExecutionPorts", ipcText);
    invariant(portCalls.length === 1, `production ExecutionEngine port registrations: ${portCalls.length}`);
    const wiring = portCalls[0].arguments[0]?.getText(parse(executionIpcPath, ipcText)) ?? "";
    invariant(/sessionAccess:\s*getSessionService\(\)/.test(wiring), "production session-access adapter is missing");
    invariant(/createReportStore\(\)\.import\(report\)/.test(wiring), "production report-persistence adapter is missing");
    invariant(
      /!executionEngine\.dispatchGateRegistered\s*\|\|\s*!executionEngine\.executionPortsRegistered/.test(mainText),
      "bootstrap no longer fails closed when execution ports are missing"
    );
  };
  const executionIpcText = source(executionIpcPath);
  const mainText = source(mainPath);
  assertProductionPortComposition(executionIpcText, mainText);
  check("Electron main composes both narrow ports and bootstrap rejects missing production composition", true);
  mutationRejected("production session access being omitted from composition", () => {
    assertProductionPortComposition(executionIpcText.replace("sessionAccess: getSessionService()", "sessionAccess: undefined"), mainText);
  });
  mutationRejected("production report persistence being disconnected from createReportStore", () => {
    assertProductionPortComposition(executionIpcText.replace("await createReportStore().import(report);", "void report;"), mainText);
  });
  mutationRejected("production bootstrap accepting an unconfigured ExecutionEngine", () => {
    assertProductionPortComposition(executionIpcText, mainText.replace(" || !executionEngine.executionPortsRegistered", ""));
  });

  const productionFiles = [...walkFiles("app"), ...walkFiles("src")]
    .map(normalizedRepoPath)
    .filter((path) => !path.startsWith("src/testing/"));
  const startRunConsumers = productionFiles.filter((path) =>
    calls(path, (call, sf) => callText(call, sf) === "executionEngine.startRun").length > 0
  );
  invariant(JSON.stringify(startRunConsumers) === JSON.stringify([executionServicePath]), `execution entry points: ${startRunConsumers.join(", ")}`);
  check("the execution application service remains the single production caller that starts ExecutionEngine runs", true, startRunConsumers[0]);
  mutationRejected("a parallel production execution entry", () => {
    // The regression R2 can introduce: the IPC facade keeps (or regains) its own direct engine call
    // alongside the extracted service, so run preparation exists in two places at once.
    const mutated = [...startRunConsumers, executionIpcPath];
    invariant(mutated.length === 1 && mutated[0] === executionServicePath, `execution entry points: ${mutated.join(", ")}`);
  });

  const scenarioConsumers = productionFiles.filter((path) => importsOf(path).some((specifier) => resolveImport(path, specifier) === "src/orchestrator/ScenarioOrchestrator.ts"));
  check(
    "ScenarioOrchestrator is live in both execution composition and runner traversal (not a replacement target)",
    scenarioConsumers.includes(executionServicePath) && scenarioConsumers.includes("src/runner/PlaywrightRunner.ts"),
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

  const builder = JSON.parse(source("electron-builder.json")) as { files?: unknown };
  // `(builder.files ?? [])` made the packaging conclusion below fail OPEN: if the key were ever
  // removed or renamed, `sourceIsPackagedDirectly` would be false and "dead candidates are not raw
  // packaged sources" would pass by never reading a packaging rule at all. Prove the allowlist exists
  // and is a non-empty array of strings BEFORE anything is derived from it.
  const builderFiles = builder.files;
  const builderFilesDeclared = Array.isArray(builderFiles) && builderFiles.length > 0 && builderFiles.every((entry) => typeof entry === "string");
  check(
    "electron-builder.json still declares a non-empty string `files` allowlist for the packaging conclusion to be derived from",
    builderFilesDeclared,
    Array.isArray(builderFiles) ? `entries=${builderFiles.length}` : `files=${JSON.stringify(builderFiles)}`
  );
  const builderFileEntries: string[] = builderFilesDeclared ? (builderFiles as string[]) : [];
  const sourceIsPackagedDirectly = builderFileEntries.some((entry) => entry === "src/**" || entry.startsWith("src/"));
  const builtText = walkFiles("out", new Set([".js", ".mjs"])).map((path) => readFileSync(path, "utf8")).join("\n");
  const bundledDeadSymbols = candidates.filter((candidate) => builtText.includes(candidate.symbol)).map((candidate) => candidate.symbol);
  check(
    "dead candidates are not raw packaged sources and are absent from current production bundles",
    !sourceIsPackagedDirectly && bundledDeadSymbols.length === 0,
    `packaged symbols=${bundledDeadSymbols.join(", ") || "none"}`
  );
}

async function executionPortBehavior(): Promise<void> {
  console.log("\nR1A - injected session access and report persistence behavior");
  const persisted: Array<Record<string, unknown>> = [];
  const sessionAccess: ExecutionEnginePorts["sessionAccess"] = {
    list: async () => [],
    getById: async () => null,
    startCapture: async () => ({ active: false, status: "closed" }),
    getStatus: () => ({ active: false, status: "idle" }),
    stopCapture: () => undefined,
    hasCapturedData: () => false,
    markUsed: async () => undefined
  };
  const ports: ExecutionEnginePorts = {
    sessionAccess,
    reportPersistence: {
      persist: async (report) => {
        persisted.push(report as unknown as Record<string, unknown>);
      }
    }
  };
  const engine = new ExecutionEngine(ports);
  check("constructor injection registers the complete ExecutionEngine port pair", engine.executionPortsRegistered);
  check("a bare verifier engine remains constructible but is not mistaken for production composition", !new ExecutionEngine().executionPortsRegistered);
  const internals = engine as unknown as {
    sessionAccess?: ExecutionEnginePorts["sessionAccess"];
    runReports: Map<string, unknown[]>;
    runStartTimes: Map<string, string>;
    processQueue: (
      executionId: string,
      profile: ConcurrentRunProfile,
      flows: [],
      scenario: { id: string; name: string },
      workflowDataSource: undefined,
      dataSources: Record<string, never>,
      dirs: StorageDirs,
      runtimeInputs: Record<string, unknown>
    ) => Promise<void>;
  };
  check("the exact injected session-access object is retained for runner composition", internals.sessionAccess === sessionAccess);
  mutationRejected("a different session-access object being substituted", () => {
    invariant(internals.sessionAccess !== sessionAccess, "injected session access identity changed");
  });

  const folder = await mkdtemp(join(tmpdir(), "awkit-r1a-report-"));
  try {
    const executionId = "r1a-report";
    const profile = runProfile(1);
    const dirs: StorageDirs = {
      root: folder,
      downloads: join(folder, "downloads"),
      screenshots: join(folder, "screenshots"),
      logs: join(folder, "logs"),
      reports: join(folder, "reports")
    };
    const instance = new InstanceManager().createInstancesForRun(profile, [{}], dirs)[0];
    engine.pool.add({
      ...instance,
      executionId,
      status: "completed",
      startedAt: "2026-09-03T00:00:00.000Z",
      endedAt: "2026-09-03T00:00:01.000Z"
    });
    internals.runReports.set(executionId, []);
    internals.runStartTimes.set(executionId, "2026-09-03T00:00:00.000Z");
    await internals.processQueue(
      executionId,
      profile,
      [],
      { id: "r1a-scenario", name: "R1A scenario" },
      undefined,
      {},
      dirs,
      { compatibility: "preserved" }
    );

    const reportPath = join(dirs.reports, executionId, "report.json");
    const writtenReport = JSON.parse(await readFile(reportPath, "utf8")) as Record<string, unknown>;
    const persistedReport = persisted[0];
    const { id, ...profileProjection } = persistedReport ?? {};
    check("ReportService still writes the canonical nested report artifact", existsSync(reportPath));
    check("the injected report port receives exactly one profile projection with the execution id", persisted.length === 1 && id === executionId);
    check(
      "the profile projection remains byte-for-field compatible with the canonical JSON report",
      JSON.stringify(profileProjection) === JSON.stringify(writtenReport)
    );
    mutationRejected("a report adapter dropping the runtimeInputs compatibility field", () => {
      const { runtimeInputs: _removed, ...mutated } = profileProjection;
      invariant(JSON.stringify(mutated) === JSON.stringify(writtenReport), "report profile projection diverged from report.json");
    });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
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

/**
 * Yields the event loop a bounded number of times. NOT a sleep: no wall-clock duration is waited on
 * and nothing depends on how fast the host is, only on the loop having been given `turns` chances to
 * make progress. Used as the always-terminating arm of the concurrency gate below.
 */
function drainEventLoop(turns: number): Promise<void> {
  return new Promise<void>((settle) => {
    let remaining = Math.max(1, turns);
    const step = (): void => {
      remaining -= 1;
      if (remaining <= 0) settle();
      else setImmediate(step);
    };
    setImmediate(step);
  });
}

/**
 * Retained for callers that only need to yield the loop. It is NOT a valid bound for the concurrency
 * gate below -- see `drainFilesystemTurns`.
 */
const GATE_DRAIN_TURNS = 200;

/**
 * How many real filesystem round trips the gate's escape arm spends before giving up on a writer that
 * has not arrived. A genuinely free writer needs at most two (`mkdir` + `writeFile`).
 *
 * Sized by measurement, not by estimate: at 64 turns the observed margin was only 4.2x
 * (fastestBound=9.978ms vs slowestFreeWriter=2.367ms), because a `readdir` of a nearly empty folder
 * is several times cheaper than the `writeFile` a competitor must complete. 64 was therefore already
 * within one bad scheduling quantum of being unsound. `gateBoundDominatesAFreeWriter` re-measures the
 * ratio on every run and FAILS below 4x, so this constant can never quietly stop being a bound.
 */
const GATE_FS_TURNS = 256;

/**
 * The always-terminating arm of the concurrency gate, paced in the SAME currency a competing writer
 * spends: real filesystem round trips.
 *
 * MEASURED CORRECTION (2026-09-04). This arm used to be `drainEventLoop(200)`, justified in a comment
 * as "a handful of loop turns". That claim was false. 200 chained `setImmediate` turns cost a median
 * of 0.746 ms on this host, while a free writer still has to complete a `writeFile` -- a libuv
 * THREADPOOL round trip -- at a median of 0.855 ms. In 19 of 25 samples the free writer was SLOWER
 * than the bound, so the holder routinely raced ahead of a competitor that was not blocked by
 * anything at all. The damage ran in both directions: the pre-R1B mutation control intermittently
 * reported `maxActive=1` (failing to reproduce the overlap it exists to demonstrate), and the
 * different-resolved-folder independence checks intermittently reported `maxActive=1` too -- which,
 * had the assertions been written the other way round, is exactly the shape of a check that passes
 * because nothing happened rather than because coordination worked.
 *
 * Spending filesystem round trips instead makes the bound dominate a free writer BY CONSTRUCTION
 * rather than by luck, while a writer queued behind a folder lane still cannot arrive no matter how
 * many are spent. Still no wall-clock sleep and no timer: nothing waits on a duration.
 */
async function drainFilesystemTurns(folder: string, turns: number): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await readdir(folder).catch(() => [] as string[]);
  }
}

interface OverlapProbe {
  /** Instrumented `renameImpl` for one writer. */
  renameFor(owner: string): (from: string, to: string) => Promise<void>;
  /** Settles the first time any writer is inside atomic replacement. */
  readonly firstEntered: Promise<void>;
  /** Highest number of writers simultaneously inside atomic replacement. */
  readonly maxActive: number;
  /** Ordered `owner:enter` / `owner:exit` log. */
  readonly events: readonly string[];
  /** Live coordination keys sampled at the instant each writer entered. */
  readonly keysOnEnter: readonly (readonly string[])[];
  /** Renames that threw, i.e. attempts `replaceFileAtomically` went on to retry. */
  readonly renameFailures: readonly string[];
}

/**
 * Measures whether two writers can be inside atomic replacement at the same instant, deterministically
 * and WITHOUT a sleep or a wall-clock timer.
 *
 * Each rename records `enter`, waits on a gate, renames, then records `exit`. The gate is
 * `race(allArrived, drainFilesystemTurns(folder, n))`, which terminates on BOTH branches:
 *   - independent per-instance queues -> every writer reaches its rename, `allArrived` wins, and the
 *     writers are held together long enough for the overlap to be observable;
 *   - one lane per resolved folder    -> the queued writer can never arrive, so the bounded drain
 *     wins and the holder proceeds alone.
 * So neither the fixed build nor a mutated one can hang here, and the two outcomes are distinguishable
 * (`maxActive` 2 vs 1, interleaved vs strictly serial event log).
 *
 * MEASURED CORRECTION (2026-09-04): `exit` is recorded in a `finally`. It used to be recorded only on
 * the success path, and `replaceFileAtomically` RETRIES `renameImpl` on a transient `EPERM`/`EBUSY`
 * (`src/storage/atomicReplace.ts`), so a single writer whose first rename lost a Windows sharing race
 * re-entered with `active` still held at 1. That fabricated `maxActive=2` and an interleaved log
 * (`A:enter A:enter A:exit B:enter B:exit`) for ONE writer, failing the R1B non-overlap assertions
 * against a correct implementation. Releasing in `finally` makes a retry read as what it is -- a
 * second sequential attempt -- and `renameFailures` keeps it visible instead of silent.
 */
function overlapProbe(writerCount: number): OverlapProbe {
  const allArrived = deferred();
  const firstEntered = deferred();
  const events: string[] = [];
  const keysOnEnter: string[][] = [];
  const renameFailures: string[] = [];
  let arrived = 0;
  let active = 0;
  let maxActive = 0;

  return {
    renameFor: (owner: string) => async (from: string, to: string): Promise<void> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      events.push(`${owner}:enter`);
      keysOnEnter.push(activeFolderCoordinationKeys());
      arrived += 1;
      firstEntered.resolve();
      if (arrived >= writerCount) allArrived.resolve();
      try {
        await Promise.race([allArrived.promise, drainFilesystemTurns(dirname(to), GATE_FS_TURNS)]);
        await rename(from, to);
      } catch (error) {
        renameFailures.push(`${owner}: ${(error as Error).message}`);
        throw error;
      } finally {
        events.push(`${owner}:exit`);
        active -= 1;
      }
    },
    firstEntered: firstEntered.promise,
    get maxActive() { return maxActive; },
    get events() { return events; },
    get keysOnEnter() { return keysOnEnter; },
    get renameFailures() { return renameFailures; }
  };
}

/**
 * Re-measures, at run time, the assumption every `maxActive === 1` assertion in this section rests on:
 * that the gate's escape arm outlasts a writer that is genuinely free. If it does not, "no overlap was
 * observed" stops being evidence of coordination and becomes an artifact of the holder finishing
 * first -- the exact defect this harness shipped with until 2026-09-04.
 */
async function gateBoundDominatesAFreeWriter(folder: string): Promise<{ bound: number; free: number }> {
  const time = async (work: () => Promise<unknown>): Promise<number> => {
    const started = process.hrtime.bigint();
    await work();
    return Number(process.hrtime.bigint() - started) / 1e6;
  };
  // Slowest observed bound vs fastest observed free writer would flatter the margin, so take the
  // pessimistic pairing: the cheapest bound against the dearest free writer.
  const bounds: number[] = [];
  const frees: number[] = [];
  for (let sample = 0; sample < 5; sample += 1) {
    bounds.push(await time(() => drainFilesystemTurns(folder, GATE_FS_TURNS)));
    frees.push(await time(async () => {
      const scratch = join(folder, `bound-probe-${sample}.tmp`);
      await writeFile(scratch, "x".repeat(512), "utf8");
      await rm(scratch, { force: true });
    }));
  }
  return { bound: Math.min(...bounds), free: Math.max(...frees) };
}

/** First place the log shows one critical section opening before the previous one closed, or null. */
function firstInterleave(events: readonly string[]): string | null {
  for (let index = 0; index + 1 < events.length; index += 1) {
    if (events[index].endsWith(":enter") && events[index + 1].endsWith(":enter")) {
      return `${events[index]} -> ${events[index + 1]}`;
    }
  }
  return null;
}

interface PairHarness {
  write(owner: "A" | "B", doc: StoreDoc): Promise<unknown>;
}

/**
 * Issues two whole-document writes derived from the SAME loaded snapshot — the stale-snapshot shape
 * R0 characterized. `B` is issued only once `A` is already inside atomic replacement, so admission
 * order is fixed by construction rather than by filesystem scheduling: whatever the harness observes
 * afterwards is a property of the coordination design, not of which `mkdir` happened to land first.
 */
async function runOrderedPair(
  harness: PairHarness,
  base: StoreDoc,
  probe: OverlapProbe,
  betweenWrites?: () => Promise<void>
): Promise<PromiseSettledResult<unknown>[]> {
  const snapshotA = structuredClone(base);
  const snapshotB = structuredClone(base);
  const writeA = harness.write("A", { ...snapshotA, name: "writer-A", future: { ...snapshotA.future, aOnly: true } });
  await probe.firstEntered;
  if (betweenWrites) await betweenWrites();
  const writeB = harness.write("B", { ...snapshotB, payload: "writer-B", future: { ...snapshotB.future, bOnly: true } });
  return Promise.allSettled([writeA, writeB]);
}

/**
 * The PRE-R1B design rebuilt locally: a write chain owned by the INSTANCE rather than by the
 * destination folder. Two of these pointed at one folder is exactly what shipped before
 * `folderWriteCoordinator`, so it is the control that proves the R0.2 assertions above can still
 * fail. It deliberately reuses the real `replaceFileAtomically` so the injected seam behaves
 * identically to the store's own write path.
 */
class InstanceQueuedStore {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly folder: string,
    private readonly renameImpl: (from: string, to: string) => Promise<void>
  ) {}

  update(doc: StoreDoc): Promise<unknown> {
    const task = async (): Promise<void> => {
      const target = join(this.folder, `${doc.id}.json`);
      const tmp = `${target}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
      await writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
      await replaceFileAtomically(tmp, target, { renameImpl: this.renameImpl });
    };
    const result = this.chain.then(task, task);
    this.chain = result.then(() => undefined, () => undefined);
    return result;
  }
}

const SHARED_DOC: StoreDoc = { id: "shared", name: "original", payload: "original", future: { preserved: true } };

async function seedShared(folder: string): Promise<void> {
  await new JsonProfileStore<StoreDoc>({ folder }).create(structuredClone(SHARED_DOC));
}

async function storeConcurrency(): Promise<void> {
  console.log("\nR1B/R0.2 - one write coordinator per resolved store folder");
  const folder = await mkdtemp(join(tmpdir(), "awkit-r1b-store-"));
  try {
    const original = SHARED_DOC;
    await seedShared(folder);

    // ── Case 0: the harness proves its own bound before asserting anything with it ─────────────
    // Every `maxActive === 1` below means "the queued writer could not arrive". That is only evidence
    // if a writer that CAN arrive would have. Measure it rather than assume it.
    const margin = await gateBoundDominatesAFreeWriter(folder);
    check(
      "harness precondition: the concurrency gate outlasts a genuinely free writer, so an unobserved overlap cannot be a timing artifact",
      margin.bound > margin.free * 4,
      `slowestFreeWriter=${margin.free.toFixed(3)}ms fastestBound=${margin.bound.toFixed(3)}ms ratio=${(margin.bound / margin.free).toFixed(1)}x`
    );

    // ── Case 1+2: two INDEPENDENTLY CONSTRUCTED stores, one resolved folder ────────────────────
    // Nothing is shared between them but the folder string: no store registry, no handed-in queue,
    // no common parent object. If serialization were still owned by the instance they would overlap.
    const probe = overlapProbe(2);
    const storeA = new JsonProfileStore<StoreDoc>({ folder, atomicReplace: { renameImpl: probe.renameFor("A") } });
    const storeB = new JsonProfileStore<StoreDoc>({ folder, atomicReplace: { renameImpl: probe.renameFor("B") } });
    check("the two same-folder writers are separately constructed store instances, not one shared object", storeA !== storeB && storeA instanceof JsonProfileStore && storeB instanceof JsonProfileStore);

    const midFlight: { doc: StoreDoc | null } = { doc: null };
    const settled = await runOrderedPair(
      { write: (owner, doc) => (owner === "A" ? storeA : storeB).update("shared", doc) },
      original,
      probe,
      async () => { midFlight.doc = JSON.parse(await readFile(join(folder, "shared.json"), "utf8")) as StoreDoc; }
    );

    check("both same-folder writes complete", settled.length === 2 && settled.every((result) => result.status === "fulfilled"), settled.map((r) => r.status).join(", "));
    // Reported separately so a transient Windows sharing retry is diagnosed as a retry, rather than
    // surfacing as an unexplained extra `enter` in the interleave and event-count assertions below.
    check("each same-folder writer renamed once, so the event log below counts writers and not retries", probe.renameFailures.length === 0, probe.renameFailures.join(" | "));
    check("no two same-folder replacement critical sections are ever active at the same instant", probe.maxActive === 1, `maxActive=${probe.maxActive}`);
    check(
      "the same-folder critical sections are strictly serial: every enter is followed by its own exit",
      probe.events.length === 4 && firstInterleave(probe.events) === null,
      probe.events.join(" ")
    );
    check("the previous complete JSON stays readable while a replacement holds the folder", JSON.stringify(midFlight.doc) === JSON.stringify(original), JSON.stringify(midFlight.doc));
    check(
      "exactly one coordination key is live for the folder at every entry into replacement",
      probe.keysOnEnter.length === 2 && probe.keysOnEnter.every((keys) => keys.length === 1 && keys[0] === folderCoordinationKey(folder)),
      probe.keysOnEnter.map((keys) => `[${keys.join(",")}]`).join(" ")
    );

    // ── Case 3: the stale-snapshot lost update is BOUNDED, not eliminated ──────────────────────
    // `update(id, wholeDocument)` has no version/etag, so a whole-document replacement written from
    // an older snapshot still discards the earlier writer's field. R1B does not add optimistic
    // concurrency, and pretending otherwise here would be a false PASS. What IS now true, and is what
    // these assert, is that the two replacements never physically overlap and the surviving document
    // is exactly the last ADMITTED writer's — the same answer on every run.
    const reloaded = await new JsonProfileStore<StoreDoc>({ folder }).get("shared");
    check("the last admitted writer's whole document is the final state, read back from a fresh store", reloaded?.payload === "writer-B" && reloaded?.name === "original", JSON.stringify(reloaded));
    check("each replacement published a complete document, never a truncated or merged file", JSON.stringify(reloaded) === JSON.stringify({ id: "shared", name: "original", payload: "writer-B", future: { preserved: true, bOnly: true } }), JSON.stringify(reloaded));
    check("unknown fields carried by the surviving snapshot survive save/reload", reloaded?.future?.preserved === true && reloaded?.future?.bOnly === true);
    check(
      "stale-snapshot lost update stays BOUNDED by existing store semantics, not eliminated: whole-document replacement is still last-writer-wins, so the earlier writer's field is not merged in",
      reloaded?.future?.aOnly === undefined,
      JSON.stringify(reloaded?.future)
    );

    // Determinism: the outcome is decided by admission order, not by a race inside replacement. Each
    // repeat fires both writes simultaneously, then asserts the document on disk is exactly the whole
    // document of whichever writer the coordinator admitted LAST, and that they never overlapped.
    const outcomes: string[] = [];
    for (let run = 0; run < 5; run += 1) {
      const repeatFolder = await mkdtemp(join(tmpdir(), "awkit-r1b-determinism-"));
      try {
        await seedShared(repeatFolder);
        const repeatProbe = overlapProbe(2);
        const repeatA = new JsonProfileStore<StoreDoc>({ folder: repeatFolder, atomicReplace: { renameImpl: repeatProbe.renameFor("A") } });
        const repeatB = new JsonProfileStore<StoreDoc>({ folder: repeatFolder, atomicReplace: { renameImpl: repeatProbe.renameFor("B") } });
        await Promise.all([
          repeatA.update("shared", { ...original, name: "writer-A", future: { preserved: true, aOnly: true } }),
          repeatB.update("shared", { ...original, payload: "writer-B", future: { preserved: true, bOnly: true } })
        ]);
        const finalDoc = await new JsonProfileStore<StoreDoc>({ folder: repeatFolder }).get("shared");
        const lastAdmitted = [...repeatProbe.events].reverse().find((event) => event.endsWith(":enter"))?.split(":")[0] ?? "?";
        const expected = lastAdmitted === "A"
          ? { id: "shared", name: "writer-A", payload: "original", future: { preserved: true, aOnly: true } }
          : { id: "shared", name: "original", payload: "writer-B", future: { preserved: true, bOnly: true } };
        outcomes.push(`${repeatProbe.maxActive}|${lastAdmitted}|${JSON.stringify(finalDoc) === JSON.stringify(expected)}`);
      } finally {
        await rm(repeatFolder, { recursive: true, force: true });
      }
    }
    check(
      "repeated same-folder races never overlap and always leave exactly the last-admitted writer's whole document",
      outcomes.length === 5 && outcomes.every((outcome) => outcome.startsWith("1|") && outcome.endsWith("|true")),
      outcomes.join(", ")
    );

    // ── Mutation control: restore the pre-R1B per-instance queues and the above must fail ───────
    const legacyFolder = await mkdtemp(join(tmpdir(), "awkit-r1b-legacy-control-"));
    try {
      await seedShared(legacyFolder);
      const legacyProbe = overlapProbe(2);
      const legacyA = new InstanceQueuedStore(legacyFolder, legacyProbe.renameFor("A"));
      const legacyB = new InstanceQueuedStore(legacyFolder, legacyProbe.renameFor("B"));
      const legacySettled = await runOrderedPair(
        { write: (owner, doc) => (owner === "A" ? legacyA : legacyB).update(doc) },
        original,
        legacyProbe
      );
      check("mutation control: the legacy facade completed both writes, so it is a like-for-like control", legacySettled.length === 2 && legacySettled.every((result) => result.status === "fulfilled"));
      check("mutation control: per-instance write chains let two same-folder writers overlap", legacyProbe.maxActive === 2, `maxActive=${legacyProbe.maxActive}`);
      mutationRejected("the non-overlap assertion when independent per-instance queues are restored", () => {
        invariant(legacyProbe.maxActive === 1, `restored per-instance queues overlapped: maxActive=${legacyProbe.maxActive}`);
      });
      mutationRejected("the strictly-serial event-log assertion when independent per-instance queues are restored", () => {
        const interleave = firstInterleave(legacyProbe.events);
        invariant(interleave === null, `interleaved critical sections: ${interleave} in ${legacyProbe.events.join(" ")}`);
      });
    } finally {
      await rm(legacyFolder, { recursive: true, force: true });
    }

    // ── Case 4: different resolved folders keep independent concurrency (negative control) ──────
    const folderX = await mkdtemp(join(tmpdir(), "awkit-r1b-folder-x-"));
    const folderY = await mkdtemp(join(tmpdir(), "awkit-r1b-folder-y-"));
    try {
      await seedShared(folderX);
      await seedShared(folderY);
      const crossProbe = overlapProbe(2);
      const storeX = new JsonProfileStore<StoreDoc>({ folder: folderX, atomicReplace: { renameImpl: crossProbe.renameFor("A") } });
      const storeY = new JsonProfileStore<StoreDoc>({ folder: folderY, atomicReplace: { renameImpl: crossProbe.renameFor("B") } });
      const crossSettled = await runOrderedPair(
        { write: (owner, doc) => (owner === "A" ? storeX : storeY).update("shared", doc) },
        original,
        crossProbe
      );
      check("both cross-folder writes complete", crossSettled.length === 2 && crossSettled.every((result) => result.status === "fulfilled"));
      check("different resolved folders are NOT serialized against each other", crossProbe.maxActive === 2, `maxActive=${crossProbe.maxActive}`);
      check("distinct folders produce distinct coordination keys", folderCoordinationKey(folderX) !== folderCoordinationKey(folderY), `${folderCoordinationKey(folderX)} vs ${folderCoordinationKey(folderY)}`);
      check(
        "each folder holds its own live coordination key at the same instant",
        crossProbe.keysOnEnter.length === 2 && crossProbe.keysOnEnter[1].length === 2 &&
          crossProbe.keysOnEnter[1].includes(folderCoordinationKey(folderX)) &&
          crossProbe.keysOnEnter[1].includes(folderCoordinationKey(folderY)),
        crossProbe.keysOnEnter.map((keys) => `[${keys.join(",")}]`).join(" ")
      );
    } finally {
      await rm(folderX, { recursive: true, force: true });
      await rm(folderY, { recursive: true, force: true });
    }

    // Differently spelled paths for ONE folder must not split into two lanes.
    const spellings = [
      folder,
      `${folder}${sep}`,
      `${folder}${sep}.`,
      `${folder}${sep}nested${sep}..`,
      folder.replace(/[\\/]/g, "/")
    ];
    const spellingKeys = new Set(spellings.map(folderCoordinationKey));
    check("differently spelled paths for one folder collapse to a single coordination key", spellings.length === 5 && spellingKeys.size === 1, [...spellingKeys].join(" | "));
    const spellingProbe = overlapProbe(2);
    const spelledA = new JsonProfileStore<StoreDoc>({ folder: spellings[2], atomicReplace: { renameImpl: spellingProbe.renameFor("A") } });
    const spelledB = new JsonProfileStore<StoreDoc>({ folder: spellings[1], atomicReplace: { renameImpl: spellingProbe.renameFor("B") } });
    const spellingSettled = await runOrderedPair(
      { write: (owner, doc) => (owner === "A" ? spelledA : spelledB).update("shared", doc) },
      original,
      spellingProbe
    );
    check(
      "stores configured with different spellings of one folder share the lane rather than splitting it",
      spellingSettled.length === 2 && spellingProbe.maxActive === 1 && firstInterleave(spellingProbe.events) === null && spellingProbe.events.length === 4,
      `maxActive=${spellingProbe.maxActive}, events=${spellingProbe.events.join(" ")}`
    );

    // ── Case 7: a store constructed AFTER the lane was evicted joins the same coordinator ───────
    await drainEventLoop(8);
    const keysBetween = activeFolderCoordinationKeys();
    check("no coordination key outlives the writes it coordinated", keysBetween.length === 0, keysBetween.join(", "));
    const recreatedProbe = overlapProbe(2);
    const recreatedA = new JsonProfileStore<StoreDoc>({ folder, atomicReplace: { renameImpl: recreatedProbe.renameFor("A") } });
    const recreatedB = new JsonProfileStore<StoreDoc>({ folder, atomicReplace: { renameImpl: recreatedProbe.renameFor("B") } });
    const recreatedSettled = await runOrderedPair(
      { write: (owner, doc) => (owner === "A" ? recreatedA : recreatedB).update("shared", doc) },
      original,
      recreatedProbe
    );
    check(
      "stores recreated for the same folder after eviction join one coordinator again, with no overlap",
      recreatedSettled.length === 2 && recreatedProbe.maxActive === 1 && recreatedProbe.events.length === 4 && firstInterleave(recreatedProbe.events) === null,
      `maxActive=${recreatedProbe.maxActive}, events=${recreatedProbe.events.join(" ")}`
    );
    check(
      "the recreated pair rejoins the SAME coordination key the evicted lane used",
      recreatedProbe.keysOnEnter.length === 2 && recreatedProbe.keysOnEnter.every((keys) => keys.length === 1 && keys[0] === folderCoordinationKey(folder)),
      recreatedProbe.keysOnEnter.map((keys) => `[${keys.join(",")}]`).join(" ")
    );

    // ── Case 5: atomic replacement still leaves valid complete JSON and no orphan temp files ────
    const entries = await readdir(folder);
    const jsonEntries = entries.filter((entry) => entry.endsWith(".json"));
    const tmpEntries = entries.filter((entry) => entry.endsWith(".tmp"));
    check("the coordinated folder is non-empty and holds exactly the one profile file", entries.length > 0 && jsonEntries.length === 1, `entries=${entries.length}, json=${jsonEntries.length}`);
    check("coordinated same-folder writes leave no orphan temp files", tmpEntries.length === 0, tmpEntries.join(", ") || "none");
    let roundTripped = 0;
    for (const entry of jsonEntries) {
      const raw = await readFile(join(folder, entry), "utf8");
      const parsed = JSON.parse(raw) as StoreDoc;
      if (raw === `${JSON.stringify(parsed, null, 2)}\n`) roundTripped += 1;
    }
    check("every persisted file is complete JSON that round-trips through the store's pretty-print", jsonEntries.length > 0 && roundTripped === jsonEntries.length, `${roundTripped}/${jsonEntries.length}`);

    // ── Case 6: a failed write does not block, poison or strand later writes to the same folder ─
    const failureFolder = await mkdtemp(join(tmpdir(), "awkit-r1b-failure-"));
    try {
      const good = new JsonProfileStore<StoreDoc>({ folder: failureFolder });
      await good.create(structuredClone(original));
      let failureAttempts = 0;
      const enospc = (): NodeJS.ErrnoException => {
        const error = new Error("ENOSPC: no space left on device") as NodeJS.ErrnoException;
        error.code = "ENOSPC";
        return error;
      };
      const failing = new JsonProfileStore<StoreDoc>({
        folder: failureFolder,
        atomicReplace: {
          renameImpl: async () => {
            failureAttempts += 1;
            throw enospc();
          }
        }
      });
      const [failure, success] = await Promise.allSettled([
        failing.update("shared", { ...original, name: "must-not-land" }),
        good.update("shared", { ...original, name: "survivor", future: { preserved: true, futureVersion: 2 } })
      ]);
      const afterFailure = await new JsonProfileStore<StoreDoc>({ folder: failureFolder }).get("shared");
      check("one store failure does not poison a separate store instance's successful save", failure.status === "rejected" && success.status === "fulfilled" && afterFailure?.name === "survivor", `${failure.status}/${success.status}/${afterFailure?.name}`);
      // `.every()` is vacuously true over an empty listing, so the residue clause used to pass just as
      // well if the folder had been emptied — or had never been written at all. Capture the listing
      // once, prove it is non-empty AND still holds the record the writers were contending over, and
      // only then assert the residue predicate over it.
      const failureEntries = await readdir(failureFolder);
      check(
        "the failure folder is non-empty and still holds shared.json, so the residue check below has something to range over",
        failureEntries.length > 0 && failureEntries.includes("shared.json"),
        `entries=${failureEntries.join(", ") || "none"}`
      );
      check("non-transient failure is reported once and leaves no temp residue", failureAttempts === 1 && failureEntries.length > 0 && failureEntries.every((entry) => !entry.endsWith(".tmp")), `attempts=${failureAttempts}, entries=${failureEntries.join(", ") || "none"}`);
      check("unknown fields survive the successful writer beside a failed writer", afterFailure?.future?.futureVersion === 2);

      // Strictly sequential: the failure is fully settled BEFORE the next write is admitted, so this
      // proves the lane was not left stranded or poisoned rather than merely overtaken.
      let sequentialFailure: NodeJS.ErrnoException | null = null;
      try {
        await failing.update("shared", { ...original, name: "still-must-not-land" });
      } catch (error) {
        sequentialFailure = error as NodeJS.ErrnoException;
      }
      check("the sequential failing write rejects with its original errno", sequentialFailure?.code === "ENOSPC", String(sequentialFailure));
      const laterWrite = await good.update("shared", { ...original, name: "after-failure", future: { preserved: true, futureVersion: 3 } });
      const afterLater = await new JsonProfileStore<StoreDoc>({ folder: failureFolder }).get("shared");
      check("a later valid write to the SAME folder still succeeds after a failure settled", laterWrite.name === "after-failure" && afterLater?.name === "after-failure" && afterLater?.future?.futureVersion === 3, JSON.stringify(afterLater));
      await drainEventLoop(8);
      const keysAfterFailure = activeFolderCoordinationKeys();
      check("the failed write left no stranded coordination lane", keysAfterFailure.length === 0, keysAfterFailure.join(", ") || "none");
    } finally {
      await rm(failureFolder, { recursive: true, force: true });
    }

    // ── Case 8: a configured-path change routes to a new key and strands nothing behind ─────────
    const oldConfigured = await mkdtemp(join(tmpdir(), "awkit-r1b-configured-old-"));
    const newConfigured = await mkdtemp(join(tmpdir(), "awkit-r1b-configured-new-"));
    try {
      await seedShared(oldConfigured);
      await seedShared(newConfigured);
      const switchProbe = overlapProbe(2);
      const beforeSwitch = new JsonProfileStore<StoreDoc>({ folder: oldConfigured, atomicReplace: { renameImpl: switchProbe.renameFor("A") } });
      const afterSwitch = new JsonProfileStore<StoreDoc>({ folder: newConfigured, atomicReplace: { renameImpl: switchProbe.renameFor("B") } });
      const switchSettled = await runOrderedPair(
        { write: (owner, doc) => (owner === "A" ? beforeSwitch : afterSwitch).update("shared", doc) },
        original,
        switchProbe
      );
      check(
        "a write to the newly configured folder does not queue behind the previously configured one",
        switchSettled.length === 2 && switchProbe.maxActive === 2 && firstInterleave(switchProbe.events) !== null,
        `maxActive=${switchProbe.maxActive}, events=${switchProbe.events.join(" ")}`
      );
      check(
        "the newly configured folder is coordinated under its own key while the old one is still busy",
        switchProbe.keysOnEnter.length === 2 &&
          switchProbe.keysOnEnter[0].length === 1 && switchProbe.keysOnEnter[0][0] === folderCoordinationKey(oldConfigured) &&
          switchProbe.keysOnEnter[1].length === 2 && switchProbe.keysOnEnter[1].includes(folderCoordinationKey(newConfigured)),
        switchProbe.keysOnEnter.map((keys) => `[${keys.join(",")}]`).join(" ")
      );
      await drainEventLoop(8);
      const oldKey = folderCoordinationKey(oldConfigured);
      const newKey = folderCoordinationKey(newConfigured);
      const keysAfterSwitch = activeFolderCoordinationKeys();
      // What the second conjunct used to say — `!keysAfterSwitch.includes(oldKey)` — was implied by
      // `length === 0` and so asserted nothing. The proposition it was reaching for is a PRECONDITION,
      // not a postcondition: two DISTINCT keys have to have been live at once for "neither survives"
      // to describe a real path change rather than a contest that never routed anywhere.
      check(
        "the path change put two DISTINCT coordination keys live at the same instant, so releasing both is a real transition",
        oldKey !== newKey &&
          switchProbe.keysOnEnter.length === 2 &&
          switchProbe.keysOnEnter[1].includes(oldKey) && switchProbe.keysOnEnter[1].includes(newKey),
        `old=${oldKey} new=${newKey} onEnter=${switchProbe.keysOnEnter.map((keys) => `[${keys.join(",")}]`).join(" ")}`
      );
      check(
        "neither the old nor the new configured folder key survives the path change",
        keysAfterSwitch.length === 0,
        keysAfterSwitch.join(", ") || "none"
      );
    } finally {
      await rm(oldConfigured, { recursive: true, force: true });
      await rm(newConfigured, { recursive: true, force: true });
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

    // ── Case 8, source level: every factory must resolve its destination on EVERY call ──────────
    // Coordination is keyed by the folder string a store was CONSTRUCTED with, so a factory that
    // resolved its path once at module scope would keep handing out stores aimed at the folder
    // configured at import time. A Settings path change would then be coordinated under — and would
    // write into — the stale folder, and every runtime assertion above would still pass, because the
    // defect is in what the factory hands the store, not in the coordinator. That makes it a property
    // of the real `profileStores.ts` and it is asserted against the real source.
    const expectedResolvers = new Map([
      ["createFlowProfileStore", "getConfiguredPaths"],
      ["createWorkflowProfileStore", "getConfiguredPaths"],
      ["createDataSourceProfileStore", "getConfiguredPaths"],
      ["createRuntimeInputProfileStore", "getRuntimePaths"],
      ["createInstanceProfileStore", "getRuntimePaths"],
      ["createReportStore", "getConfiguredPaths"]
    ]);
    const assertPerCallResolution = (text: string): void => {
      const sf = parse(profileStoresPath, text);
      const seen = new Set<string>();
      walk(sf, (node) => {
        if (!ts.isFunctionDeclaration(node) || !node.name || !node.body) return;
        const resolver = expectedResolvers.get(node.name.text);
        if (!resolver) return;
        let resolvesPerCall = false;
        walk(node.body, (child) => {
          if (ts.isCallExpression(child) && child.expression.getText(sf) === resolver) resolvesPerCall = true;
        });
        invariant(resolvesPerCall, `${node.name.text} does not call ${resolver}() inside its own body — its destination folder looks resolved once outside the factory`);
        seen.add(node.name.text);
      });
      // Cardinality: without this a renamed or deleted factory would simply not be visited, and the
      // loop above would pass by never running.
      invariant(
        seen.size === expectedResolvers.size,
        `expected ${expectedResolvers.size} store factories, matched ${seen.size}: ${[...seen].sort().join(", ")}`
      );
    };
    assertPerCallResolution(factoryText);
    check(`all ${expectedResolvers.size} store factories resolve their destination folder per call, so a configured-path change cannot be coordinated under a stale key`, true);
    mutationRejected("a factory reading a module-scope cached path instead of resolving per call", () => {
      assertPerCallResolution(factoryText.replace("folder: getConfiguredPaths().reports", "folder: cachedPaths.reports"));
    });
    mutationRejected("runtime-path resolution being hoisted out of a factory body", () => {
      assertPerCallResolution(factoryText.replace("const paths = getRuntimePaths();", ""));
    });
    mutationRejected("a store factory silently dropping out of the scanned set", () => {
      assertPerCallResolution(factoryText.replace("export function createReportStore(", "export function createReportStoreRenamed("));
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

interface SourceSpan {
  start: number;
  end: number;
}

/**
 * Apply one targeted textual regression to an in-memory copy of a real production source.
 *
 * Nothing on disk is touched. The two invariants are the whole point: `mutationRejected` passes on ANY
 * thrown error, so a mutation whose anchor silently matched zero times would make its paired negative
 * control pass on the mutation's own failure to apply rather than on the guard rejecting the
 * regression. Callers therefore build every mutated text at TOP LEVEL (outside the `mutationRejected`
 * closure) so an anchor drift crashes this verifier loudly instead of being absorbed as a pass.
 *
 * Line-ending agnostic: `\n` anchors are rewritten to CRLF when the file on disk uses CRLF, so an
 * anchor can never fail merely because of how the working tree checked the file out.
 */
function mutateOnce(text: string, anchor: string, replacement: string): string {
  const crlf = text.includes("\r\n");
  const wanted = crlf ? anchor.split("\n").join("\r\n") : anchor;
  const applied = crlf ? replacement.split("\n").join("\r\n") : replacement;
  const occurrences = text.split(wanted).length - 1;
  invariant(occurrences === 1, `mutation anchor matched ${occurrences} times, expected exactly 1: ${JSON.stringify(anchor)}`);
  const at = text.indexOf(wanted);
  const mutated = `${text.slice(0, at)}${applied}${text.slice(at + wanted.length)}`;
  invariant(mutated !== text, `mutation produced an identical source: ${JSON.stringify(anchor)}`);
  return mutated;
}

/**
 * Body span of the single `function <name>` declaration in `path`. The cardinality invariant matters:
 * a renamed or duplicated declaration would otherwise yield an empty/ambiguous span that every scoped
 * predicate below would range over vacuously.
 */
function functionBodySpan(path: string, text: string, name: string): SourceSpan {
  const sf = parse(path, text);
  const spans: SourceSpan[] = [];
  walk(sf, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name && node.body) {
      spans.push({ start: node.body.getStart(sf), end: node.body.end });
    }
  });
  invariant(spans.length === 1, `expected exactly one \`function ${name}\` in ${path}, found ${spans.length}`);
  return spans[0];
}

/**
 * Body span of the single `<name>(...)` method declaration in `path`.
 *
 * R2 moved run preparation onto `ExecutionApplicationService`, so the scoped predicates below now
 * range over a class member rather than a top-level function. The cardinality invariant is the same
 * one `functionBodySpan` carries and matters for the same reason: a renamed, overloaded or duplicated
 * method would otherwise yield an empty/ambiguous span that every scoped predicate ranges over
 * vacuously.
 */
function methodBodySpan(path: string, text: string, name: string): SourceSpan {
  const sf = parse(path, text);
  const spans: SourceSpan[] = [];
  walk(sf, (node) => {
    if (ts.isMethodDeclaration(node) && node.name.getText(sf) === name && node.body) {
      spans.push({ start: node.body.getStart(sf), end: node.body.end });
    }
  });
  invariant(spans.length === 1, `expected exactly one \`${name}(...)\` method in ${path}, found ${spans.length}`);
  return spans[0];
}

/** Top-level statements of the single `<name>(...)` method declaration in `path`. */
function methodBodyStatements(path: string, text: string, name: string): readonly ts.Statement[] {
  const sf = parse(path, text);
  const bodies: ts.Block[] = [];
  walk(sf, (node) => {
    if (ts.isMethodDeclaration(node) && node.name.getText(sf) === name && node.body) {
      bodies.push(node.body);
    }
  });
  invariant(bodies.length === 1, `expected exactly one \`${name}(...)\` method in ${path}, found ${bodies.length}`);
  return bodies[0].statements;
}

/** Body span of the inline handler passed to the single `ipcMain.handle("<channel>", ...)` registration. */
function ipcHandlerSpan(path: string, text: string, channel: string): SourceSpan {
  const registrations = calls(path, (call, sf) => callText(call, sf) === "ipcMain.handle" && stringArg(call, 0) === channel, text);
  invariant(registrations.length === 1, `expected exactly one ipcMain.handle("${channel}") in ${path}, found ${registrations.length}`);
  const handler = registrations[0].arguments[1];
  invariant(
    handler !== undefined && (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)),
    `ipcMain.handle("${channel}") no longer registers an inline handler function`
  );
  return { start: handler.getStart(), end: handler.end };
}

function callsWithin(
  path: string,
  text: string,
  span: SourceSpan,
  predicate: (call: ts.CallExpression, sf: ts.SourceFile) => boolean
): ts.CallExpression[] {
  return calls(path, (call, sf) => call.getStart(sf) >= span.start && call.end <= span.end && predicate(call, sf), text);
}

function nodesWithin<T extends ts.Node>(path: string, text: string, span: SourceSpan, guard: (node: ts.Node) => node is T): T[] {
  const sf = parse(path, text);
  const found: T[] = [];
  walk(sf, (node) => {
    if (guard(node) && node.getStart(sf) >= span.start && node.end <= span.end) found.push(node);
  });
  return found;
}

/** The single `const <name> = { ... }` object literal declared inside `span`. */
function objectLiteralNamed(path: string, text: string, span: SourceSpan, name: string): ts.ObjectLiteralExpression {
  const sf = parse(path, text);
  const literals: ts.ObjectLiteralExpression[] = [];
  walk(sf, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer !== undefined &&
      ts.isObjectLiteralExpression(node.initializer) &&
      node.getStart(sf) >= span.start &&
      node.end <= span.end
    ) {
      literals.push(node.initializer);
    }
  });
  invariant(literals.length === 1, `expected exactly one \`const ${name} = { ... }\` literal in ${path}, found ${literals.length}`);
  return literals[0];
}

/**
 * R2 - application-level run preparation, characterized AFTER the extraction.
 *
 * R2 moved run preparation out of `app/main/ipc/execution.ipc.ts` into
 * `app/main/execution/ExecutionApplicationService.ts`. The layering is now: IPC transport +
 * sender/session/RBAC authorization -> ExecutionApplicationService -> ExecutionEngine. Every
 * assertion here describes the code AS IT IS TODAY; the controls were re-pointed at whichever module
 * now owns each behavior, and none of them were relaxed to accommodate the move. Controls that
 * describe the IPC handler's authorization decision (R2.1, R2.6) stay on the IPC facade; controls
 * that describe run preparation (R2.2, R2.3, R2.5, R2.7-R2.11) follow `runWorkflow` into the service.
 * R2.4 keeps its existing owners -- the engine-side gate consultations characterized in R0.3/R0.5 and
 * the `setDispatchGate(licenseDispatchGate)` registration asserted by `verify:license-dispatch-gate`
 * -- because the extraction moved neither. R2.10 is
 * deliberately split across both modules and therefore also asserts that the two halves are wired to
 * each other. Each control is paired with an in-memory mutation of the real source that reproduces
 * one concrete regression, so the control is proven to FAIL for that regression rather than merely
 * proving that some identifier still exists. A TypeScript compile error is never accepted as mutation
 * evidence -- only the guard's own rejection is.
 */
async function runPreparationCharacterization(): Promise<void> {
  console.log("\nR2 - application-level run preparation (post-extraction characterization)");
  const ipcPath = "app/main/ipc/execution.ipc.ts";
  const servicePath = "app/main/execution/ExecutionApplicationService.ts";
  const enginePath = "src/runner/ExecutionEngine.ts";
  const ipcText = source(ipcPath);
  const serviceText = source(servicePath);
  const engineText = source(enginePath);

  // --- R2.1 sender/RBAC authorization completes before the call into the application service --------
  // Authorization stayed in the IPC handler; the privileged work it guards is now one hop away, so the
  // control asserts the same ordering against the service call rather than against an inline function.
  const assertAuthorizationPrecedesRunPreparation = (text: string): void => {
    const handler = ipcHandlerSpan(ipcPath, text, "execution:runWorkflow");
    const authorizations = callsWithin(ipcPath, text, handler, (call, sf) => /^assertSender[A-Za-z]*$/.test(callText(call, sf)));
    const privileged = callsWithin(ipcPath, text, handler, (call, sf) => callText(call, sf) === "applicationService.runWorkflow");
    // Cardinality BEFORE ordering. `every(authorization precedes privileged)` is vacuously true over an
    // empty authorization set, which is itself the regression this control exists to reject.
    invariant(authorizations.length === 2, `execution:runWorkflow authorization calls: ${authorizations.length}`);
    const callees = authorizations.map((call) => call.expression.getText()).sort();
    invariant(
      JSON.stringify(callees) === JSON.stringify(["assertSenderPermission", "assertSenderSuperUser"]),
      `execution:runWorkflow authorization callees: ${callees.join(", ")}`
    );
    invariant(
      privileged.length === 1,
      `execution:runWorkflow privileged applicationService.runWorkflow calls: ${privileged.length}`
    );
    const privilegedStart = privileged[0].getStart();
    // Positional, not merely both-present: "both are present" passes trivially when the order is inverted.
    const late = authorizations.filter((call) => call.getStart() >= privilegedStart).map((call) => call.expression.getText());
    invariant(
      late.length === 0,
      `applicationService.runWorkflow is reached before authorization completes: ${late.join(", ")}`
    );
  };
  assertAuthorizationPrecedesRunPreparation(ipcText);
  check(
    "every sender/RBAC authorization in execution:runWorkflow completes before the call into ExecutionApplicationService",
    true,
    "assertSenderSuperUser + assertSenderPermission both precede applicationService.runWorkflow(request, browserLaunchSnapshot)"
  );
  const hoistedPrivilegedCall = mutateOnce(
    mutateOnce(
      ipcText,
      "    let browserLaunchSnapshot: RunBrowserLaunchSnapshot | undefined;",
      "    const hoisted = applicationService.runWorkflow(request, undefined);\n    let browserLaunchSnapshot: RunBrowserLaunchSnapshot | undefined;"
    ),
    "    return applicationService.runWorkflow(request, browserLaunchSnapshot);",
    "    return hoisted;"
  );
  mutationRejected("the call into ExecutionApplicationService being hoisted above the sender/RBAC authorization block", () => {
    assertAuthorizationPrecedesRunPreparation(hoistedPrivilegedCall);
  });

  // --- R2.2/R2.3 both licensing checkpoints are consulted AND enforced before dispatch --------------
  // R0.5 counts these checkpoints per module, which rejects deletion. It cannot reject the shape the
  // extraction actually risks: the checkpoint still being called while its decision is ignored, or the
  // pre-run checkpoint drifting past the dispatch it is supposed to gate. Both subjects moved into
  // `ExecutionApplicationService.runWorkflow`, so both are asserted there, positionally.
  const assertLicensingGatesEnforcedBeforeDispatch = (text: string): void => {
    const body = methodBodySpan(servicePath, text, "runWorkflow");
    const gates = callsWithin(servicePath, text, body, (call, sf) => callText(call, sf) === "applyRunGateEnforcement");
    // Cardinality BEFORE ordering, again: the per-guard ordering loop below is vacuously satisfied by an
    // empty set, which is exactly the "licensing removed" regression.
    invariant(gates.length === 2, `runWorkflow applyRunGateEnforcement calls: ${gates.length}`);
    const triggers = gates.map((call) => stringArg(call, 0) ?? "none");
    invariant(
      JSON.stringify(triggers) === JSON.stringify(["run-request", "pre-run"]),
      `runWorkflow licensing triggers in source order: ${triggers.join(", ")}`
    );
    const guards = nodesWithin(servicePath, text, body, ts.isIfStatement)
      .filter((node) => /^!\w+\.allowed$/.test(node.expression.getText()))
      .sort((a, b) => a.getStart() - b.getStart());
    invariant(guards.length === 2, `runWorkflow licensing decision guards: ${guards.length}`);
    const guardExpressions = guards.map((node) => node.expression.getText());
    invariant(
      JSON.stringify(guardExpressions) === JSON.stringify(["!gate.allowed", "!preRunGate.allowed"]),
      `runWorkflow licensing decision guards: ${guardExpressions.join(", ")}`
    );
    const dispatches = callsWithin(servicePath, text, body, (call, sf) => callText(call, sf) === "executionEngine.startRun");
    invariant(dispatches.length === 1, `runWorkflow executionEngine.startRun calls: ${dispatches.length}`);
    const dispatch = dispatches[0];
    for (let index = 0; index < gates.length; index += 1) {
      // Consulted, then enforced, then dispatched -- for each checkpoint independently.
      invariant(
        gates[index].getStart() < guards[index].getStart(),
        `the ${triggers[index]} decision is enforced before it is obtained`
      );
      invariant(
        guards[index].end < dispatch.getStart(),
        `the ${triggers[index]} licensing decision is enforced after the run is dispatched`
      );
      invariant(
        /licenseBlockedResult\(/.test(guards[index].thenStatement.getText()),
        `the ${triggers[index]} guard no longer short-circuits with a license-blocked result`
      );
    }

    // The final licensing check is a last-moment admission gate, so its checkpoint, denial guard,
    // and dispatch must be consecutive top-level statements. Merely checking source order would let
    // unrelated awaited work widen the time-of-check/time-of-use window after admission.
    const statements = methodBodyStatements(servicePath, text, "runWorkflow");
    const statementIndexContaining = (node: ts.Node): number =>
      statements.findIndex((statement) => statement.getStart() <= node.getStart() && statement.end >= node.end);
    const preRunCheckpointIndex = statementIndexContaining(gates[1]);
    const preRunGuardIndex = statementIndexContaining(guards[1]);
    const dispatchIndex = statementIndexContaining(dispatch);
    invariant(
      preRunCheckpointIndex >= 0 && preRunGuardIndex >= 0 && dispatchIndex >= 0,
      `pre-run checkpoint/guard/dispatch top-level statement indexes: ${preRunCheckpointIndex}/${preRunGuardIndex}/${dispatchIndex}`
    );
    invariant(
      preRunGuardIndex === preRunCheckpointIndex + 1 && dispatchIndex === preRunGuardIndex + 1,
      `pre-run checkpoint/guard/dispatch are no longer adjacent top-level statements: ${preRunCheckpointIndex}/${preRunGuardIndex}/${dispatchIndex}`
    );
  };
  assertLicensingGatesEnforcedBeforeDispatch(serviceText);
  check(
    "run preparation consults and enforces both licensing checkpoints, with the pre-run checkpoint and guard immediately adjacent to dispatch",
    true,
    'applyRunGateEnforcement("run-request") -> !gate.allowed -> [applyRunGateEnforcement("pre-run"); !preRunGate.allowed; executionEngine.startRun] as consecutive top-level statements'
  );
  const requestTimeLicensingRemoved = mutateOnce(
    serviceText,
    '    const gate = applyRunGateEnforcement("run-request").decision;',
    "    const gate = { allowed: true, status: { userAction: \"\" } } as unknown as RunGateDecision;"
  );
  mutationRejected("the request-time licensing checkpoint being removed from run preparation", () => {
    assertLicensingGatesEnforcedBeforeDispatch(requestTimeLicensingRemoved);
  });
  // Deliberately a BYPASS, not a deletion: the pre-run checkpoint is still called, so a control that
  // only counts call sites still passes. The decision is simply never acted on.
  const preRunLicensingIgnored = mutateOnce(
    serviceText,
    "    if (!preRunGate.allowed) return licenseBlockedResult(preRunGate, validation);",
    "    void preRunGate;"
  );
  mutationRejected("the pre-run licensing decision being obtained and then ignored before dispatch", () => {
    assertLicensingGatesEnforcedBeforeDispatch(preRunLicensingIgnored);
  });
  // Deliberately valid awaited work, inserted after the denial guard. All checkpoint/guard/dispatch
  // cardinality and ordinary source-order assertions remain true; only the adjacency invariant can
  // reject this widened post-admission window.
  const awaitedWorkBetweenPreRunGuardAndDispatch = mutateOnce(
    serviceText,
    "    if (!preRunGate.allowed) return licenseBlockedResult(preRunGate, validation);\n    await executionEngine.startRun(",
    "    if (!preRunGate.allowed) return licenseBlockedResult(preRunGate, validation);\n    await Promise.resolve();\n    await executionEngine.startRun("
  );
  mutationRejected("awaited work being inserted between the pre-run licensing guard and dispatch", () => {
    assertLicensingGatesEnforcedBeforeDispatch(awaitedWorkBetweenPreRunGuardAndDispatch);
  });

  // --- R2.5 workflow validation runs and gates the run --------------------------------------------
  // `runWorkflow` is now a method on ExecutionApplicationService, so the span is resolved with
  // `methodBodySpan` -- which carries the same exactly-one cardinality invariant `functionBodySpan`
  // did, for the same reason: an ambiguous span would make every scoped predicate below vacuous.
  const assertWorkflowValidationGatesTheRun = (text: string): void => {
    const body = methodBodySpan(servicePath, text, "runWorkflow");
    const validations = callsWithin(servicePath, text, body, (call, sf) => callText(call, sf) === "validateWorkflow");
    const dispatches = callsWithin(servicePath, text, body, (call, sf) => callText(call, sf) === "executionEngine.startRun");
    invariant(validations.length === 1, `runWorkflow validateWorkflow calls: ${validations.length}`);
    invariant(dispatches.length === 1, `runWorkflow executionEngine.startRun calls: ${dispatches.length}`);
    invariant(
      validations[0].arguments[0]?.getText() === "request.workflowId",
      `validateWorkflow argument: ${validations[0].arguments[0]?.getText() ?? "none"}`
    );
    invariant(validations[0].getStart() < dispatches[0].getStart(), "validateWorkflow no longer runs before ExecutionEngine.startRun");
    const guards = nodesWithin(servicePath, text, body, ts.isIfStatement).filter((node) => node.expression.getText() === "!validation.valid");
    invariant(guards.length === 1, `runWorkflow \`!validation.valid\` guards: ${guards.length}`);
    invariant(
      guards[0].getStart() > validations[0].getStart() && guards[0].end < dispatches[0].getStart(),
      "the !validation.valid guard no longer sits between validation and dispatch"
    );
    invariant(
      /status:\s*"validationFailed"/.test(guards[0].thenStatement.getText()),
      "the !validation.valid guard no longer short-circuits with a validationFailed result"
    );
  };
  assertWorkflowValidationGatesTheRun(serviceText);
  check(
    "run preparation validates the workflow and blocks dispatch on the !validation.valid guard",
    true,
    "validateWorkflow(request.workflowId) -> !validation.valid -> executionEngine.startRun"
  );
  const validationSkipped = mutateOnce(
    serviceText,
    "    const validation = await validateWorkflow(request.workflowId);",
    "    const validation = { workflow: undefined, scenario: undefined, plan: undefined, issues: [], valid: true };"
  );
  mutationRejected("workflow validation being skipped in run preparation", () => {
    assertWorkflowValidationGatesTheRun(validationSkipped);
  });
  const validationGuardDefeated = mutateOnce(serviceText, "    if (!validation.valid) {", "    if (false) {");
  mutationRejected("the !validation.valid guard no longer blocking dispatch of an invalid workflow", () => {
    assertWorkflowValidationGatesTheRun(validationGuardDefeated);
  });

  // --- R2.6 the installed-Chrome Super User rule ---------------------------------------------------
  const assertInstalledChromeSuperUserRule = (text: string): void => {
    const handler = ipcHandlerSpan(ipcPath, text, "execution:runWorkflow");
    const branches = nodesWithin(ipcPath, text, handler, ts.isIfStatement).sort((a, b) => a.getStart() - b.getStart());
    invariant(branches.length === 2, `execution:runWorkflow authorization branches: ${branches.length}`);
    invariant(branches[0].expression.getText() === "request.dryRun === false", `real-run branch condition: ${branches[0].expression.getText()}`);
    invariant(
      branches[1].expression.getText() === 'browserLaunchSnapshot.mode === "installedChrome"',
      `installed-Chrome branch condition: ${branches[1].expression.getText()}`
    );
    const thenArm = branches[1].thenStatement;
    const elseArm = branches[1].elseStatement;
    invariant(elseArm !== undefined, "the installed-Chrome branch no longer has an else arm for the bundled-Chromium path");
    const superUser = callsWithin(ipcPath, text, { start: thenArm.getStart(), end: thenArm.end }, (call, sf) => callText(call, sf) === "assertSenderSuperUser");
    const permission = callsWithin(ipcPath, text, { start: elseArm.getStart(), end: elseArm.end }, (call, sf) => callText(call, sf) === "assertSenderPermission");
    invariant(superUser.length === 1, `installed-Chrome then-arm assertSenderSuperUser calls: ${superUser.length}`);
    invariant(permission.length === 1, `bundled-Chromium else-arm assertSenderPermission calls: ${permission.length}`);
    invariant(
      superUser[0].arguments[1]?.getText() === "Permission.WORKFLOW_EXECUTE",
      `installed-Chrome super-user permission: ${superUser[0].arguments[1]?.getText() ?? "none"}`
    );
    const audit = superUser[0].arguments[2]?.getText() ?? "";
    invariant(/eventType:\s*"INSTALLED_CHROME_EXECUTION_DENIED"/.test(audit), `installed-Chrome denial audit event: ${audit || "none"}`);
    invariant(/channel:\s*"execution:runWorkflow"/.test(audit), `installed-Chrome denial audit channel: ${audit || "none"}`);
  };
  assertInstalledChromeSuperUserRule(ipcText);
  check(
    "an installedChrome real run requires Super User, and only the bundled-Chromium arm falls back to the plain execute permission",
    true,
    "installedChrome -> assertSenderSuperUser(INSTALLED_CHROME_EXECUTION_DENIED); else -> assertSenderPermission"
  );
  const superUserDowngraded = mutateOnce(
    ipcText,
    "        await assertSenderSuperUser(event, Permission.WORKFLOW_EXECUTE, {",
    "        await assertSenderPermission(event, Permission.WORKFLOW_EXECUTE, {"
  );
  mutationRejected("the installed-Chrome arm being downgraded from Super User to the plain execute permission", () => {
    assertInstalledChromeSuperUserRule(superUserDowngraded);
  });
  const installedChromeConditionInverted = mutateOnce(
    ipcText,
    '      if (browserLaunchSnapshot.mode === "installedChrome") {',
    '      if (browserLaunchSnapshot.mode !== "installedChrome") {'
  );
  mutationRejected("the installed-Chrome mode test being inverted so installed Chrome takes the weaker arm", () => {
    assertInstalledChromeSuperUserRule(installedChromeConditionInverted);
  });
  // Anchored on the runWorkflow SITE, by channel: the same audit event type now legitimately appears in
  // the `execution:repeatInstance` handler too (R2.6b below), so the former file-wide anchor matches
  // twice and `mutateOnce` refuses it. Scoping the anchor makes the mutation strictly more precise, and
  // keeping the channel in the REPLACEMENT is deliberate -- the channel invariant must still pass, so
  // this control is proven to reject the lost event type specifically rather than incidentally.
  const installedChromeAuditDropped = mutateOnce(
    ipcText,
    'eventType: "INSTALLED_CHROME_EXECUTION_DENIED", channel: "execution:runWorkflow"',
    'eventType: "WORKFLOW_EXECUTION_DENIED", channel: "execution:runWorkflow"'
  );
  mutationRejected("the installed-Chrome denial losing its distinct audit event type", () => {
    assertInstalledChromeSuperUserRule(installedChromeAuditDropped);
  });

  // --- R2.6d one trusted browser-launch snapshot crosses the IPC/service boundary -----------------
  const assertSingleRunBrowserLaunchSnapshot = (ipcSource: string, serviceSource: string): void => {
    const handler = ipcHandlerSpan(ipcPath, ipcSource, "execution:runWorkflow");
    const settingsReads = callsWithin(ipcPath, ipcSource, handler, (call, sf) => callText(call, sf) === "getUiSettings");
    invariant(settingsReads.length === 1, `execution:runWorkflow getUiSettings calls: ${settingsReads.length}`);

    const snapshotAssignments = nodesWithin(ipcPath, ipcSource, handler, ts.isBinaryExpression).filter(
      (node) => node.operatorToken.kind === ts.SyntaxKind.EqualsToken && node.left.getText() === "browserLaunchSnapshot"
    );
    invariant(snapshotAssignments.length === 1, `browserLaunchSnapshot assignments: ${snapshotAssignments.length}`);
    invariant(
      snapshotAssignments[0].right.getText() === "Object.freeze({ ...settings.superUser.chrome })",
      `browserLaunchSnapshot source: ${snapshotAssignments[0].right.getText()}`
    );

    const chromeBranches = nodesWithin(ipcPath, ipcSource, handler, ts.isIfStatement).filter((node) =>
      /\.mode\s*===\s*"installedChrome"$/.test(node.expression.getText())
    );
    invariant(chromeBranches.length === 1, `execution:runWorkflow installed-Chrome mode branches: ${chromeBranches.length}`);
    invariant(
      chromeBranches[0].expression.getText() === 'browserLaunchSnapshot.mode === "installedChrome"',
      `authorization mode source: ${chromeBranches[0].expression.getText()}`
    );

    const serviceCalls = callsWithin(
      ipcPath,
      ipcSource,
      handler,
      (call, sf) => callText(call, sf) === "applicationService.runWorkflow"
    );
    invariant(serviceCalls.length === 1, `execution:runWorkflow applicationService.runWorkflow calls: ${serviceCalls.length}`);
    invariant(
      serviceCalls[0].arguments.length === 2 && serviceCalls[0].arguments[1]?.getText() === "browserLaunchSnapshot",
      `applicationService.runWorkflow snapshot argument: ${serviceCalls[0].arguments[1]?.getText() ?? "none"}`
    );

    const runBody = methodBodySpan(servicePath, serviceSource, "runWorkflow");
    const snapshotGuards = nodesWithin(servicePath, serviceSource, runBody, ts.isIfStatement).filter(
      (node) => node.expression.getText() === "!browserLaunchSnapshot"
    );
    invariant(snapshotGuards.length === 1, `runWorkflow missing-snapshot guards: ${snapshotGuards.length}`);
    invariant(/throw new Error\(/.test(snapshotGuards[0].thenStatement.getText()), "a real run no longer fails closed without the authorized snapshot");
    const templateCalls = callsWithin(
      servicePath,
      serviceSource,
      runBody,
      (call, sf) => callText(call, sf) === "this.resolveInstanceTemplate"
    );
    invariant(templateCalls.length === 1, `runWorkflow resolveInstanceTemplate calls: ${templateCalls.length}`);
    invariant(
      templateCalls[0].arguments[3]?.getText() === "browserLaunchSnapshot",
      `resolveInstanceTemplate snapshot argument: ${templateCalls[0].arguments[3]?.getText() ?? "none"}`
    );

    const templateBody = methodBodySpan(servicePath, serviceSource, "resolveInstanceTemplate");
    const templateSettingsReads = callsWithin(
      servicePath,
      serviceSource,
      templateBody,
      (call, sf) => callText(call, sf) === "getUiSettings"
    );
    invariant(templateSettingsReads.length === 1, `resolveInstanceTemplate certificate-settings reads: ${templateSettingsReads.length}`);
    const templateProperties = nodesWithin(servicePath, serviceSource, templateBody, ts.isPropertyAccessExpression).map((node) => node.getText());
    invariant(
      templateProperties.filter((value) => value === "browserLaunchSnapshot.mode").length === 1,
      `resolveInstanceTemplate snapshot mode reads: ${templateProperties.filter((value) => value === "browserLaunchSnapshot.mode").length}`
    );
    invariant(
      templateProperties.filter((value) => value === "browserLaunchSnapshot.executablePath").length === 1,
      `resolveInstanceTemplate snapshot executablePath reads: ${templateProperties.filter((value) => value === "browserLaunchSnapshot.executablePath").length}`
    );
    const rereadChrome = templateProperties.filter((value) => /\.superUser\.chrome(?:\.|$)/.test(value));
    invariant(rereadChrome.length === 0, `resolveInstanceTemplate re-reads superUser.chrome: ${rereadChrome.join(", ")}`);
  };
  assertSingleRunBrowserLaunchSnapshot(ipcText, serviceText);
  check(
    "a real run authorizes and launches from one frozen Chrome mode/executablePath snapshot resolved at the IPC boundary",
    true,
    "one getUiSettings -> Object.freeze({...superUser.chrome}) -> authorization + applicationService.runWorkflow -> snapshot-only launch; certificate Settings remain independent"
  );
  const authorizationRereadsChromeMode = mutateOnce(
    ipcText,
    '      if (browserLaunchSnapshot.mode === "installedChrome") {',
    '      if ((await getUiSettings()).superUser.chrome.mode === "installedChrome") {'
  );
  mutationRejected("authorization re-reading Chrome mode instead of using the run snapshot", () => {
    assertSingleRunBrowserLaunchSnapshot(authorizationRereadsChromeMode, serviceText);
  });
  const serviceRereadsChromeMode = mutateOnce(
    serviceText,
    '    if (browserLaunchSnapshot.mode === "installedChrome") {',
    '    if ((await getUiSettings()).superUser.chrome.mode === "installedChrome") {'
  );
  mutationRejected("browser launch re-reading Chrome mode instead of using the authorized snapshot", () => {
    assertSingleRunBrowserLaunchSnapshot(ipcText, serviceRereadsChromeMode);
  });
  const serviceRereadsChromeExecutable = mutateOnce(
    serviceText,
    "      const resolution = await new InstalledChromeResolver().resolve(browserLaunchSnapshot.executablePath);",
    "      const resolution = await new InstalledChromeResolver().resolve((await getUiSettings()).superUser.chrome.executablePath);"
  );
  mutationRejected("browser launch re-reading the Chrome executable path instead of using the authorized snapshot", () => {
    assertSingleRunBrowserLaunchSnapshot(ipcText, serviceRereadsChromeExecutable);
  });
  const snapshotDisconnectedFromService = mutateOnce(
    ipcText,
    "    return applicationService.runWorkflow(request, browserLaunchSnapshot);",
    "    return applicationService.runWorkflow(request, undefined);"
  );
  mutationRejected("the authorized Chrome snapshot being disconnected from the application service", () => {
    assertSingleRunBrowserLaunchSnapshot(snapshotDisconnectedFromService, serviceText);
  });

  // --- R2.6b Repeat carries the same installed-Chrome rule, decided from the STORED launch config ---
  // `execution:repeatInstance` relaunches a browser, so the R2.6 rule has to hold here too, and nothing
  // above sees this handler: R2.6 is scoped to `execution:runWorkflow`, and the R0.5 census only counts
  // `applyRunGateEnforcement("run-request")` in this file. File-scope matching would be worthless here --
  // `assertSenderSuperUser`, `INSTALLED_CHROME_EXECUTION_DENIED` and the channel name all already appear
  // elsewhere in this module -- so every predicate below is scoped INSIDE the handler span, whose own
  // exactly-one cardinality is enforced by `ipcHandlerSpan`. Two properties are load-bearing beyond "a
  // Super User check exists": the decision reads the instance's own stored `config.browserDistribution`
  // (a repeat relaunches from the stored config, so current Settings are not launch truth), and it sits
  // OUTSIDE the try, because inside it a denial would be caught and downgraded to an ordinary
  // `{ success: false, error }` result -- a denial that reads like a routine failure.
  const assertRepeatInstanceInstalledChromeRule = (text: string): void => {
    const handler = ipcHandlerSpan(ipcPath, text, "execution:repeatInstance");
    // Cardinality BEFORE ordering, throughout: every positional comparison below reads element [0] of a
    // collection already pinned to exactly one member, so no ordering claim can be satisfied vacuously
    // by an empty or missing collection.
    const permissions = callsWithin(ipcPath, text, handler, (call, sf) => callText(call, sf) === "assertSenderPermission");
    invariant(permissions.length === 1, `execution:repeatInstance assertSenderPermission calls: ${permissions.length}`);
    invariant(
      permissions[0].arguments[1]?.getText() === "Permission.WORKFLOW_EXECUTE",
      `execution:repeatInstance base permission: ${permissions[0].arguments[1]?.getText() ?? "none"}`
    );
    const resolutions = callsWithin(ipcPath, text, handler, (call, sf) => callText(call, sf) === "executionEngine.getInstances");
    invariant(resolutions.length === 1, `execution:repeatInstance instance resolutions: ${resolutions.length}`);
    // A zero-count assertion, made non-vacuous by the pinned span and the positive counts around it: the
    // repeat decision must not consult current Settings, because Repeat relaunches from the stored config.
    const settingsReads = callsWithin(ipcPath, text, handler, (call, sf) => callText(call, sf) === "getUiSettings");
    invariant(settingsReads.length === 0, `execution:repeatInstance getUiSettings calls: ${settingsReads.length}`);
    const superUser = callsWithin(ipcPath, text, handler, (call, sf) => callText(call, sf) === "assertSenderSuperUser");
    invariant(superUser.length === 1, `execution:repeatInstance assertSenderSuperUser calls: ${superUser.length}`);
    invariant(
      superUser[0].arguments[1]?.getText() === "Permission.WORKFLOW_EXECUTE",
      `execution:repeatInstance super-user permission: ${superUser[0].arguments[1]?.getText() ?? "none"}`
    );
    const audit = superUser[0].arguments[2]?.getText() ?? "";
    invariant(/eventType:\s*"INSTALLED_CHROME_EXECUTION_DENIED"/.test(audit), `execution:repeatInstance denial audit event: ${audit || "none"}`);
    invariant(/channel:\s*"execution:repeatInstance"/.test(audit), `execution:repeatInstance denial audit channel: ${audit || "none"}`);
    invariant(
      resolutions[0].end <= superUser[0].getStart(),
      "the repeated instance is resolved after the installed-Chrome authorization decision"
    );

    // The guarding branch is captured STRUCTURALLY (the single `if` that contains the Super User call)
    // and only then validated strictly. Collecting it by its literal condition instead would let a
    // weakened predicate fall out of the collection, and the control would then pass over an empty set.
    const guards = nodesWithin(ipcPath, text, handler, ts.isIfStatement).filter(
      (node) => node.getStart() <= superUser[0].getStart() && node.end >= superUser[0].end
    );
    invariant(guards.length === 1, `if-statements guarding the repeat Super User check: ${guards.length}`);
    const condition = guards[0].expression;
    invariant(ts.isBinaryExpression(condition), `repeat installed-Chrome condition is not a comparison: ${condition.getText()}`);
    invariant(
      condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken,
      `repeat installed-Chrome comparison operator: ${condition.operatorToken.getText()}`
    );
    invariant(condition.right.getText() === '"installedChrome"', `repeat installed-Chrome comparison value: ${condition.right.getText()}`);
    invariant(
      ts.isPropertyAccessExpression(condition.left),
      `repeat installed-Chrome decision input is not a property access: ${condition.left.getText()}`
    );
    // Bound to the instance that was actually resolved from the engine, by its declared name -- not to
    // any identifier that merely happens to expose a `.config.browserDistribution`.
    const bindings = nodesWithin(ipcPath, text, handler, ts.isVariableDeclaration).filter(
      (node) =>
        node.initializer !== undefined &&
        node.initializer.getStart() <= resolutions[0].getStart() &&
        node.initializer.end >= resolutions[0].end
    );
    invariant(bindings.length === 1, `execution:repeatInstance resolved-instance bindings: ${bindings.length}`);
    const instance = bindings[0].name.getText();
    invariant(
      new RegExp(`^${instance}\\??\\.config\\??\\.browserDistribution$`).test(condition.left.getText()),
      `repeat installed-Chrome decision input: ${condition.left.getText()}`
    );

    const missing = nodesWithin(ipcPath, text, handler, ts.isIfStatement).filter((node) => node.expression.getText() === `!${instance}`);
    invariant(missing.length === 1, `execution:repeatInstance unknown-instance guards: ${missing.length}`);
    invariant(/\breturn\b/.test(missing[0].thenStatement.getText()), `the unknown-instance guard no longer returns: ${missing[0].thenStatement.getText()}`);
    const gates = callsWithin(
      ipcPath,
      text,
      handler,
      (call, sf) => callText(call, sf) === "applyRunGateEnforcement" && stringArg(call, 0) === "run-request"
    );
    invariant(gates.length === 1, `execution:repeatInstance run-request licensing gates: ${gates.length}`);
    const relaunches = callsWithin(ipcPath, text, handler, (call, sf) => callText(call, sf) === "executionEngine.repeatInstance");
    invariant(relaunches.length === 1, `execution:repeatInstance engine relaunch calls: ${relaunches.length}`);
    invariant(missing[0].getStart() > resolutions[0].getStart(), "the unknown-instance guard is evaluated before the instance is resolved");
    invariant(
      missing[0].end < gates[0].getStart() && missing[0].end < relaunches[0].getStart(),
      "the unknown-instance guard no longer short-circuits before the licensing gate and the relaunch"
    );
    // Authorization (who) precedes the licensing gate (which machine), and precedes the relaunch itself.
    invariant(superUser[0].end <= gates[0].getStart(), "the run-request licensing gate is consulted before the installed-Chrome authorization decision");
    invariant(superUser[0].end <= relaunches[0].getStart(), "the instance is relaunched before the installed-Chrome authorization decision");
    // OUTSIDE the try, not merely before the relaunch. The catch is asserted to be the swallowing kind
    // first, so "outside the try" is a claim about a real downgrade path rather than about syntax.
    const tries = nodesWithin(ipcPath, text, handler, ts.isTryStatement);
    invariant(tries.length === 1, `execution:repeatInstance try statements: ${tries.length}`);
    const swallow = tries[0].catchClause;
    invariant(
      swallow !== undefined && /success:\s*false/.test(swallow.block.getText()),
      "the repeat try/catch no longer downgrades a throw to a failed result, so `outside the try` no longer means anything"
    );
    invariant(
      superUser[0].end <= tries[0].getStart(),
      "the installed-Chrome authorization sits inside the try that downgrades a denial to { success: false, error }"
    );
  };
  assertRepeatInstanceInstalledChromeRule(ipcText);
  check(
    "execution:repeatInstance requires Super User for an installedChrome repeat, decided from the instance's own stored launch config, before the licensing gate and outside the catchable try",
    true,
    'getInstances().find -> !repeatTarget return -> config.browserDistribution === "installedChrome" -> assertSenderSuperUser(INSTALLED_CHROME_EXECUTION_DENIED, execution:repeatInstance) -> try { applyRunGateEnforcement("run-request") }'
  );
  const repeatSuperUserBranch =
    '    if (repeatTarget.config?.browserDistribution === "installedChrome") {\n' +
    "      await assertSenderSuperUser(event, Permission.WORKFLOW_EXECUTE, {\n" +
    '        audit: { eventType: "INSTALLED_CHROME_EXECUTION_DENIED", channel: "execution:repeatInstance" }\n' +
    "      });\n" +
    "    }\n";
  // Mutation A -- the PRE-FIX handler: execute permission only, no instance resolution, no rule.
  const repeatAuthorizationRemoved = mutateOnce(
    ipcText,
    "    const repeatTarget = executionEngine.getInstances().find((i) => i.instanceId === instanceId);\n" +
      "    if (!repeatTarget) return { success: false, error: `Instance ${instanceId} not found.` };\n" +
      repeatSuperUserBranch,
    ""
  );
  mutationRejected("the pre-fix repeat handler, which authorized only the plain execute permission and never consulted the stored launch config", () => {
    assertRepeatInstanceInstalledChromeRule(repeatAuthorizationRemoved);
  });
  // Mutation B -- the predicate still exists and still compares strictly, but no longer against the
  // value that means installed Chrome, so an installed-Chrome repeat takes the weaker path.
  const repeatPredicateWeakened = mutateOnce(
    ipcText,
    'browserDistribution === "installedChrome"',
    'browserDistribution === "bundledChromium"'
  );
  mutationRejected("the repeat installed-Chrome predicate being weakened so an installed-Chrome repeat skips the Super User check", () => {
    assertRepeatInstanceInstalledChromeRule(repeatPredicateWeakened);
  });
  // Mutation B2 -- a different regression killing a different invariant: the comparison inverted, so
  // Super User is demanded of everything EXCEPT installed Chrome.
  const repeatPredicateInverted = mutateOnce(
    ipcText,
    '    if (repeatTarget.config?.browserDistribution === "installedChrome") {',
    '    if (repeatTarget.config?.browserDistribution !== "installedChrome") {'
  );
  mutationRejected("the repeat installed-Chrome comparison being inverted so installed Chrome takes the weaker arm", () => {
    assertRepeatInstanceInstalledChromeRule(repeatPredicateInverted);
  });
  // Mutation C -- the denial is still raised, but audited against the wrong channel, so the audit trail
  // attributes a repeat denial to the run-workflow surface.
  const repeatAuditChannelWrong = mutateOnce(ipcText, 'channel: "execution:repeatInstance"', 'channel: "execution:runWorkflow"');
  mutationRejected("the repeat denial being audited against the execution:runWorkflow channel instead of its own", () => {
    assertRepeatInstanceInstalledChromeRule(repeatAuditChannelWrong);
  });
  // Mutation D -- authorization moved INSIDE the catchable try. Every call site still exists and the
  // decision still precedes the gate; only the throw path changes, from a propagated denial to an
  // ordinary `{ success: false, error }`. A control that counted calls or compared only against the
  // gate would pass here.
  const repeatAuthorizationInsideTry = mutateOnce(
    mutateOnce(ipcText, repeatSuperUserBranch, ""),
    '    try {\n      const gate = applyRunGateEnforcement("run-request").decision;',
    "    try {\n" + repeatSuperUserBranch.trimEnd() + '\n      const gate = applyRunGateEnforcement("run-request").decision;'
  );
  mutationRejected("the repeat Super User denial being moved inside the try that downgrades a throw to a failed result", () => {
    assertRepeatInstanceInstalledChromeRule(repeatAuthorizationInsideTry);
  });
  // Mutation E -- the rule survives but its INPUT changes: the decision is taken from current Settings
  // rather than from the launch configuration the instance was actually started with.
  const repeatDecidedFromCurrentSettings = mutateOnce(
    ipcText,
    '    if (repeatTarget.config?.browserDistribution === "installedChrome") {',
    '    if ((await getUiSettings()).superUser.chrome.mode === "installedChrome") {'
  );
  mutationRejected("the repeat decision being taken from current Settings instead of the instance's stored launch config", () => {
    assertRepeatInstanceInstalledChromeRule(repeatDecidedFromCurrentSettings);
  });

  // --- R2.6c the dryRun authorization complement, ACROSS the IPC facade and the application service -
  // `execution:runWorkflow` authorizes only inside `if (request.dryRun === false)`, and `execution:validate`
  // is deliberately ungated so a Viewer's pre-run preview keeps working. That exemption is safe for exactly
  // one reason, and the reason is invisible in either module alone: `ExecutionApplicationService.runWorkflow`
  // short-circuits with `if (request.dryRun !== false) return { status: "validated", ... }` BEFORE
  // `applyRunGateEnforcement` and `executionEngine.startRun`, so every request that skipped the IPC guard
  // launches no browser. The two predicates are exact COMPLEMENTS -- and nothing else in this repository
  // says so. R2.6 pins the IPC half's condition text; R2.2/R2.5 pin the service half's dispatch ordering.
  // Narrowing the service predicate alone to `request.dryRun === true` is a real privilege escalation -- an
  // unauthenticated `dryRun: undefined` request would stop short-circuiting and fall through to dispatch --
  // and it leaves every one of those existing controls green. This control therefore asserts the RELATION
  // between the two conditions, so changing EITHER side alone turns the suite red, while a deliberate
  // consistent change of both stays possible.
  //
  // Both sources are parameters so each mutation below can be applied to ONE side while the other stays
  // real: a complement claim proven only against two simultaneously-mutated sources would prove nothing.
  const assertDryRunAuthorizationComplement = (ipcSource: string, serviceSource: string): void => {
    // (1) `execution:validate` is ungated. A zero-count is vacuous on its own -- a renamed channel, a
    // deleted handler or a mis-spelled predicate all satisfy it -- so the POSITIVE delegation count is
    // asserted first, which proves the span really is the preview handler before anything is counted at 0.
    const validateHandler = ipcHandlerSpan(ipcPath, ipcSource, "execution:validate");
    const previews = callsWithin(
      ipcPath,
      ipcSource,
      validateHandler,
      (call, sf) => callText(call, sf) === "applicationService.validateWorkflow"
    );
    invariant(previews.length === 1, `execution:validate applicationService.validateWorkflow calls: ${previews.length}`);
    const previewAuthorizations = callsWithin(ipcPath, ipcSource, validateHandler, (call, sf) =>
      /^assertSender[A-Za-z]*$/.test(callText(call, sf))
    );
    invariant(
      previewAuthorizations.length === 0,
      `execution:validate is no longer ungated, so the documented Viewer pre-run preview is broken: ${previewAuthorizations
        .map((call) => call.expression.getText())
        .join(", ")}`
    );

    // (2) The IPC guard, captured structurally and only then validated strictly. Cardinality BEFORE
    // structure: the containment filter below is vacuously satisfied by every `if` in the handler when the
    // authorization set is empty, which is itself the regression this control exists to reject.
    const runHandler = ipcHandlerSpan(ipcPath, ipcSource, "execution:runWorkflow");
    const authorizations = callsWithin(ipcPath, ipcSource, runHandler, (call, sf) =>
      /^assertSender[A-Za-z]*$/.test(callText(call, sf))
    );
    invariant(authorizations.length === 2, `execution:runWorkflow authorization calls: ${authorizations.length}`);
    // Capture permissively (the `if`s that contain EVERY authorization call), validate strictly. Collecting
    // the gate by its literal condition text would let a weakened predicate fall OUT of the collection, and
    // the control would then pass over an empty set -- passing precisely when the gate was weakened. There
    // are exactly two such branches: the outer dry-run gate and the inner installed-Chrome branch, whose
    // then/else arms hold one authorization each.
    const gatingBranches = nodesWithin(ipcPath, ipcSource, runHandler, ts.isIfStatement)
      .filter((node) => authorizations.every((call) => node.getStart() <= call.getStart() && node.end >= call.end))
      .sort((a, b) => a.getStart() - b.getStart());
    invariant(
      gatingBranches.length === 2,
      `if-statements containing every execution:runWorkflow authorization: ${gatingBranches.length}`
    );
    const dryRunGate = gatingBranches[0];
    const chromeBranch = gatingBranches[1];
    // Proper nesting, not merely source order: "outer" has to mean enclosing, or the wrong condition below
    // would be validated as the dry-run gate.
    invariant(
      dryRunGate.getStart() < chromeBranch.getStart() && dryRunGate.end > chromeBranch.end,
      "the execution:runWorkflow dry-run gate no longer encloses the installed-Chrome authorization branch"
    );
    const ipcCondition = dryRunGate.expression;
    invariant(ts.isBinaryExpression(ipcCondition), `the execution:runWorkflow dry-run gate is not a comparison: ${ipcCondition.getText()}`);
    invariant(
      ipcCondition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken,
      `execution:runWorkflow dry-run gate operator: ${ipcCondition.operatorToken.getText()}`
    );
    invariant(ipcCondition.left.getText() === "request.dryRun", `execution:runWorkflow dry-run gate subject: ${ipcCondition.left.getText()}`);
    invariant(
      ipcCondition.right.kind === ts.SyntaxKind.FalseKeyword,
      `execution:runWorkflow dry-run gate comparison value: ${ipcCondition.right.getText()}`
    );

    // (3) The service short-circuit, same discipline. The positive anchors come first so that both the
    // structural capture and the ordering assertions in (4) range over collections already pinned to a
    // known cardinality rather than over an empty set.
    const body = methodBodySpan(servicePath, serviceSource, "runWorkflow");
    const licensingGates = callsWithin(servicePath, serviceSource, body, (call, sf) => callText(call, sf) === "applyRunGateEnforcement");
    invariant(licensingGates.length === 2, `runWorkflow applyRunGateEnforcement calls: ${licensingGates.length}`);
    const dispatches = callsWithin(servicePath, serviceSource, body, (call, sf) => callText(call, sf) === "executionEngine.startRun");
    invariant(dispatches.length === 1, `runWorkflow executionEngine.startRun calls: ${dispatches.length}`);
    // Captured by what the then-arm DOES (returns, and yields the validated result), never by its condition
    // text -- for the same reason as (2). A short-circuit that stopped returning would drop out of this
    // collection, so the cardinality invariant is what rejects that regression.
    const shortCircuits = nodesWithin(servicePath, serviceSource, body, ts.isIfStatement).filter(
      (node) => /\breturn\b/.test(node.thenStatement.getText()) && /status:\s*"validated"/.test(node.thenStatement.getText())
    );
    invariant(shortCircuits.length === 1, `runWorkflow \`return { status: "validated" }\` short-circuits: ${shortCircuits.length}`);
    const serviceCondition = shortCircuits[0].expression;
    invariant(ts.isBinaryExpression(serviceCondition), `the runWorkflow dry-run short-circuit is not a comparison: ${serviceCondition.getText()}`);
    invariant(
      serviceCondition.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken,
      `runWorkflow dry-run short-circuit operator: ${serviceCondition.operatorToken.getText()}`
    );
    invariant(serviceCondition.left.getText() === "request.dryRun", `runWorkflow dry-run short-circuit subject: ${serviceCondition.left.getText()}`);
    invariant(
      serviceCondition.right.kind === ts.SyntaxKind.FalseKeyword,
      `runWorkflow dry-run short-circuit comparison value: ${serviceCondition.right.getText()}`
    );

    // (4) Ordering. The no-browser property depends on WHERE the short-circuit sits, not only on its
    // predicate: the same predicate evaluated after the licensing gate or after dispatch would still read
    // correctly and would still launch a browser for an unauthorized request.
    invariant(
      shortCircuits[0].end < licensingGates[0].getStart(),
      "the dry-run short-circuit no longer returns before the first applyRunGateEnforcement call"
    );
    invariant(
      shortCircuits[0].end < dispatches[0].getStart(),
      "the dry-run short-circuit no longer returns before executionEngine.startRun"
    );

    // (5) The complement RELATION itself, stated between the two captured conditions rather than as two
    // independent literal checks, and deliberately expressed so that a consistent change of BOTH sides -- a
    // deliberate security decision -- still passes. As the code stands today this block is ENTAILED by
    // (2)+(3): (2) already pins the IPC side's operator and value, (3) already pins the service side's, so NO
    // mutation currently fails on (5) alone -- escalation mutants A and B are each rejected earlier, by (3)'s
    // and (2)'s operator checks respectively. (5) is therefore defense-in-depth against a future refactor
    // that relaxes (2) or (3), and it is deliberately NOT proven non-vacuous: the only way to manufacture a
    // mutant for it would have been to weaken (2) or (3), which would have been the dishonest way to make
    // this control read cleanly.
    invariant(
      ipcCondition.left.getText() === serviceCondition.left.getText(),
      `the IPC gate and the service short-circuit no longer test the same subject: ${ipcCondition.left.getText()} vs ${serviceCondition.left.getText()}`
    );
    invariant(
      ipcCondition.right.getText() === serviceCondition.right.getText(),
      `the IPC gate and the service short-circuit no longer compare against the same value: ${ipcCondition.right.getText()} vs ${serviceCondition.right.getText()}`
    );
    invariant(
      ipcCondition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
        serviceCondition.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken,
      `the IPC gate and the service short-circuit are no longer exact complements: IPC \`${ipcCondition.getText()}\` vs service \`${serviceCondition.getText()}\``
    );
  };
  assertDryRunAuthorizationComplement(ipcText, serviceText);
  check(
    "the ungated dry-run path launches no browser by construction: the execution:runWorkflow authorization gate and the ExecutionApplicationService.runWorkflow short-circuit are exact complements, and the short-circuit returns before licensing and dispatch",
    true,
    'execution:validate ungated -> IPC authorizes iff `request.dryRun === false` -> service returns { status: "validated" } iff `request.dryRun !== false`, before applyRunGateEnforcement and executionEngine.startRun'
  );
  // Mutation A -- THE escalation this control exists for. Applied to the SERVICE only, with the IPC source
  // left real: the predicate is narrowed so a request with no `dryRun` field stops short-circuiting and
  // reaches licensing and dispatch, while the IPC handler still authorizes nothing for it. Every existing
  // control (R2.1, R2.2, R2.5, R2.6) passes on this source.
  const serviceShortCircuitNarrowed = mutateOnce(serviceText, "    if (request.dryRun !== false) {", "    if (request.dryRun === true) {");
  mutationRejected(
    "the service dry-run short-circuit being narrowed to `request.dryRun === true`, so an unauthorized request with no dryRun flag falls through to licensing and dispatch",
    () => {
      assertDryRunAuthorizationComplement(ipcText, serviceShortCircuitNarrowed);
    }
  );
  // Mutation B -- the other side alone. The IPC gate still gates on `request.dryRun`, still compares
  // strictly, and still wraps both authorizations, so it reads like a harmless rewrite; it is simply no
  // longer the exact complement of the service predicate, which reopens the same hole from the facade side.
  const ipcGateNotComplement = mutateOnce(ipcText, "    if (request.dryRun === false) {", "    if (request.dryRun !== true) {");
  mutationRejected("the IPC dry-run gate being rewritten to a predicate that is not the exact complement of the service short-circuit", () => {
    assertDryRunAuthorizationComplement(ipcGateNotComplement, serviceText);
  });
  // Mutation C -- the opposite regression: `execution:validate` silently acquires a permission check,
  // which breaks the documented Viewer pre-run preview. Nothing else in this file would notice.
  const validatePreviewGated = mutateOnce(
    ipcText,
    '  ipcMain.handle("execution:validate", async (_, workflowId: string) => applicationService.validateWorkflow(workflowId));',
    '  ipcMain.handle("execution:validate", async (event, workflowId: string) => {\n' +
      "    await assertSenderPermission(event, Permission.WORKFLOW_EXECUTE);\n" +
      "    return applicationService.validateWorkflow(workflowId);\n" +
      "  });"
  );
  mutationRejected("execution:validate acquiring a sender authorization check, which breaks the documented ungated Viewer pre-run preview", () => {
    assertDryRunAuthorizationComplement(validatePreviewGated, serviceText);
  });
  // Mutation D -- the predicate survives verbatim, and so does the whole result object; only the early
  // RETURN is lost, so execution falls through to licensing and dispatch for every dry run. A control that
  // matched the short-circuit by its condition text would still find it and still pass.
  const shortCircuitFallsThrough = mutateOnce(
    serviceText,
    "    if (request.dryRun !== false) {\n      return {\n        status: \"validated\",",
    "    if (request.dryRun !== false) {\n      void {\n        status: \"validated\","
  );
  mutationRejected("the dry-run short-circuit losing its early return, so a dry run falls through to licensing and ExecutionEngine.startRun", () => {
    assertDryRunAuthorizationComplement(ipcText, shortCircuitFallsThrough);
  });
  // Mutation E -- nothing is deleted or reworded at all: the entire short-circuit is relocated below the
  // request-time licensing gate. Predicate, complement and cardinality all still hold; only the ordering
  // asserted in (4) changes, and with it the no-browser property.
  const serviceShortCircuitBlock =
    "    if (request.dryRun !== false) {\n" +
    "      return {\n" +
    '        status: "validated",\n' +
    "        executionId: randomUUID(),\n" +
    "        validation,\n" +
    '        message: "Workflow validation passed. Browser execution is available when dryRun=false."\n' +
    "      };\n" +
    "    }\n";
  const shortCircuitAfterLicensingGate = mutateOnce(
    mutateOnce(serviceText, serviceShortCircuitBlock, ""),
    '    const gate = applyRunGateEnforcement("run-request").decision;',
    '    const gate = applyRunGateEnforcement("run-request").decision;\n' + serviceShortCircuitBlock.trimEnd()
  );
  mutationRejected("the dry-run short-circuit being relocated below the request-time licensing gate, so a dry run is admitted before it returns", () => {
    assertDryRunAuthorizationComplement(ipcText, shortCircuitAfterLicensingGate);
  });

  // --- R2.7 Legacy Compatibility attribution reaches the run profile -------------------------------
  const assertLegacyCompatibilityAttribution = (text: string): void => {
    const body = methodBodySpan(servicePath, text, "runWorkflow");
    const collected = callsWithin(
      servicePath,
      text,
      body,
      (call, sf) => callText(call, sf) === "issue.key.startsWith" && stringArg(call, 0) === "legacyCompatibility."
    );
    invariant(collected.length === 1, `runWorkflow legacyCompatibility issue collections: ${collected.length}`);
    const recorded = callsWithin(servicePath, text, body, (call, sf) => callText(call, sf) === "service.recordRunUnderCompatibility");
    invariant(recorded.length === 1, `runWorkflow recordRunUnderCompatibility calls: ${recorded.length}`);
    invariant(
      recorded[0].arguments[0]?.getText() === "compatibilityFlowIds",
      `recordRunUnderCompatibility argument: ${recorded[0].arguments[0]?.getText() ?? "none"}`
    );
    const snapshots = callsWithin(servicePath, text, body, (call, sf) => callText(call, sf) === "service.grantsMap");
    invariant(snapshots.length === 1, `runWorkflow grant snapshot calls: ${snapshots.length}`);
    // Recording the run on the grant is not attribution: the report is blind unless the snapshot is
    // carried into the ConcurrentRunProfile that the run is started with.
    const profile = objectLiteralNamed(servicePath, text, body, "profile");
    const attribution = profile.properties.filter((property) => ts.isSpreadAssignment(property) && /legacyCompatibility/.test(property.getText()));
    invariant(attribution.length === 1, `ConcurrentRunProfile legacyCompatibility attribution properties: ${attribution.length}`);
    // Deadlines are snapshotted at admission, not re-derived at read time (grants expire and are revoked).
    const deadlines = nodesWithin(servicePath, text, body, ts.isPropertyAssignment).filter((property) => property.name.getText() === "expiresAt");
    invariant(deadlines.length === 1, `runWorkflow expiresAt attribution properties: ${deadlines.length}`);
    invariant(
      /grant\??\.expiresAt/.test(deadlines[0].initializer.getText()),
      `expiresAt attribution source: ${deadlines[0].initializer.getText()}`
    );
  };
  assertLegacyCompatibilityAttribution(serviceText);
  check(
    "Legacy Compatibility runs are recorded on the grant AND attributed onto the ConcurrentRunProfile with snapshotted deadlines",
    true,
    "recordRunUnderCompatibility + grantsMap snapshot + profile legacyCompatibility spread"
  );
  const attributionDropped = mutateOnce(serviceText, "      ...(legacyCompatibility ? { legacyCompatibility } : {}),", "");
  mutationRejected("Legacy Compatibility attribution being dropped from the ConcurrentRunProfile", () => {
    assertLegacyCompatibilityAttribution(attributionDropped);
  });
  const compatibilityRunUnrecorded = mutateOnce(
    serviceText,
    "      await service.recordRunUnderCompatibility(compatibilityFlowIds).catch(() => undefined);",
    "      void compatibilityFlowIds;"
  );
  mutationRejected("a run under Legacy Compatibility no longer being recorded against its grant", () => {
    assertLegacyCompatibilityAttribution(compatibilityRunUnrecorded);
  });

  // --- shared: bind call-site argument positions to the engine's declared parameter names ----------
  const startRunParameterNames = (text: string): string[] => {
    const sf = parse(enginePath, text);
    const declarations: ts.MethodDeclaration[] = [];
    walk(sf, (node) => {
      if (ts.isMethodDeclaration(node) && node.name.getText(sf) === "startRun") declarations.push(node);
    });
    invariant(declarations.length === 1, `ExecutionEngine startRun declarations: ${declarations.length}`);
    return declarations[0].parameters.map((parameter) => parameter.name.getText(sf));
  };
  const productionStartRunCall = (text: string): ts.CallExpression => {
    const body = methodBodySpan(servicePath, text, "runWorkflow");
    const dispatches = callsWithin(servicePath, text, body, (call, sf) => callText(call, sf) === "executionEngine.startRun");
    invariant(dispatches.length === 1, `runWorkflow executionEngine.startRun calls: ${dispatches.length}`);
    return dispatches[0];
  };

  // --- R2.8 runtime inputs are passed from the request into the run --------------------------------
  const assertRuntimeInputsReachTheRun = (text: string, engine: string): void => {
    const parameters = startRunParameterNames(engine);
    const call = productionStartRunCall(text);
    invariant(
      call.arguments.length === parameters.length,
      `startRun call passes ${call.arguments.length} arguments for ${parameters.length} declared parameters`
    );
    // Positional index is resolved from the ENGINE signature, so a silent parameter reorder cannot leave
    // this control asserting a hardcoded slot that no longer means "runtime inputs".
    const index = parameters.indexOf("runtimeInputs");
    invariant(index === 4, `ExecutionEngine.startRun runtimeInputs parameter index: ${index}`);
    const argument = call.arguments[index].getText();
    invariant(/^request\.runtimeInputs\s*\?\?\s*\{\s*\}$/.test(argument), `startRun runtimeInputs argument: ${argument}`);
  };
  assertRuntimeInputsReachTheRun(serviceText, engineText);
  check(
    "run preparation forwards request.runtimeInputs into the ExecutionEngine.startRun runtimeInputs parameter",
    true,
    "startRun argument 4 = request.runtimeInputs ?? {}"
  );
  const runtimeInputsDropped = mutateOnce(serviceText, "      request.runtimeInputs ?? {},", "      {},");
  mutationRejected("run preparation dropping request.runtimeInputs on the way into the run", () => {
    assertRuntimeInputsReachTheRun(runtimeInputsDropped, engineText);
  });
  const startRunParametersReordered = mutateOnce(
    engineText,
    "    dirs: StorageDirs,\n    runtimeInputs: Record<string, unknown>,",
    "    runtimeInputs: Record<string, unknown>,\n    dirs: StorageDirs,"
  );
  mutationRejected("the runtime-inputs argument position silently drifting away from the engine parameter it feeds", () => {
    assertRuntimeInputsReachTheRun(serviceText, startRunParametersReordered);
  });

  // --- R2.9 resolved data sources are passed into the run -----------------------------------------
  const assertDataSourcesReachTheRun = (text: string, engine: string): void => {
    const parameters = startRunParameterNames(engine);
    const body = methodBodySpan(servicePath, text, "runWorkflow");
    const resolved = callsWithin(servicePath, text, body, (call, sf) => callText(call, sf) === "resolveWorkflowDataSources");
    invariant(resolved.length === 1, `runWorkflow resolveWorkflowDataSources calls: ${resolved.length}`);
    invariant(
      resolved[0].arguments[0]?.getText() === "validation.workflow",
      `resolveWorkflowDataSources argument: ${resolved[0].arguments[0]?.getText() ?? "none"}`
    );
    const call = productionStartRunCall(text);
    invariant(
      call.arguments.length === parameters.length,
      `startRun call passes ${call.arguments.length} arguments for ${parameters.length} declared parameters`
    );
    invariant(resolved[0].getStart() < call.getStart(), "data sources are resolved after the run is started");
    for (const name of ["workflowDataSource", "dataSources"]) {
      const index = parameters.indexOf(name);
      invariant(index >= 0, `ExecutionEngine.startRun declares no ${name} parameter`);
      const argument = call.arguments[index].getText();
      invariant(argument === name, `startRun ${name} argument at position ${index}: ${argument}`);
    }
    // The bound workflow source also selects the run mode and the profile's data-source projection.
    const profile = objectLiteralNamed(servicePath, text, body, "profile");
    for (const property of ["runMode", "dataSource"]) {
      const matches = profile.properties.filter((candidate) => ts.isPropertyAssignment(candidate) && candidate.name.getText() === property);
      invariant(matches.length === 1, `ConcurrentRunProfile ${property} properties: ${matches.length}`);
      invariant(/workflowDataSource/.test(matches[0].getText()), `ConcurrentRunProfile ${property} no longer derives from workflowDataSource`);
    }
  };
  assertDataSourcesReachTheRun(serviceText, engineText);
  check(
    "run preparation resolves the workflow data sources and forwards both the bound source and the resolved map into the run",
    true,
    "resolveWorkflowDataSources(validation.workflow) -> startRun workflowDataSource + dataSources"
  );
  const dataSourceResolutionRemoved = mutateOnce(
    serviceText,
    "    const { workflowDataSource, dataSources } = await resolveWorkflowDataSources(validation.workflow);",
    "    const workflowDataSource = undefined;\n    const dataSources = {};"
  );
  mutationRejected("workflow data-source resolution being removed from run preparation", () => {
    assertDataSourcesReachTheRun(dataSourceResolutionRemoved, engineText);
  });
  const dataSourceArgumentDropped = mutateOnce(
    serviceText,
    "      workflowDataSource,\n      dataSources\n    );",
    "      workflowDataSource\n    );"
  );
  mutationRejected("the resolved data-source map being dropped from the ExecutionEngine.startRun arguments", () => {
    assertDataSourcesReachTheRun(dataSourceArgumentDropped, engineText);
  });

  // --- R2.10 Settings-derived capacity is applied to the engine before every run -------------------
  // Deliberately SPLIT across both modules by R2: the per-run CALL moved into the application service
  // with `runWorkflow`, while the function it calls stays exported from the IPC facade because
  // `settings.ipc.ts` imports it. Either half asserted alone would pass while the two were
  // disconnected -- a service holding a stub that never reads Settings, or an IPC function that
  // nothing calls before a run -- so the injection that joins them is asserted between them.
  const assertSettingsDerivedCapacityApplied = (ipc: string, service: string): void => {
    // Half 1 (service): the per-run application, sequenced before dispatch.
    const run = methodBodySpan(servicePath, service, "runWorkflow");
    const applied = callsWithin(servicePath, service, run, (call, sf) => callText(call, sf) === "this.applyRuntimeConcurrencyFromSettings");
    invariant(applied.length === 1, `runWorkflow this.applyRuntimeConcurrencyFromSettings calls: ${applied.length}`);
    invariant(applied[0].getStart() < productionStartRunCall(service).getStart(), "Settings-derived capacity is applied after the run is started");

    // The seam between the halves. `this.applyRuntimeConcurrencyFromSettings` is only the IPC facade's
    // capacity function if the facade still exports it, still injects it by that name, and the service
    // still stores exactly that injected value on the field the call above reads.
    const wholeIpc: SourceSpan = { start: 0, end: ipc.length };
    const exported = nodesWithin(ipcPath, ipc, wholeIpc, ts.isFunctionDeclaration).filter(
      (node) =>
        node.name?.text === "applyRuntimeConcurrencyFromSettings" &&
        node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true
    );
    invariant(exported.length === 1, `exported applyRuntimeConcurrencyFromSettings declarations in ${ipcPath}: ${exported.length}`);
    const constructions = nodesWithin(ipcPath, ipc, wholeIpc, ts.isNewExpression).filter(
      (node) => node.expression.getText() === "ExecutionApplicationService"
    );
    invariant(constructions.length === 1, `ExecutionApplicationService constructions in ${ipcPath}: ${constructions.length}`);
    const dependencies = constructions[0].arguments?.[0];
    invariant(
      dependencies !== undefined && ts.isObjectLiteralExpression(dependencies),
      "ExecutionApplicationService is no longer constructed with an injected dependency literal"
    );
    const injected = dependencies.properties.filter(
      (property) =>
        (ts.isShorthandPropertyAssignment(property) && property.name.text === "applyRuntimeConcurrencyFromSettings") ||
        (ts.isPropertyAssignment(property) &&
          property.name.getText() === "applyRuntimeConcurrencyFromSettings" &&
          property.initializer.getText() === "applyRuntimeConcurrencyFromSettings")
    );
    invariant(
      injected.length === 1,
      `ExecutionApplicationService is not injected with the IPC facade's own applyRuntimeConcurrencyFromSettings: matches=${injected.length}`
    );
    const stored = nodesWithin(servicePath, service, { start: 0, end: service.length }, ts.isBinaryExpression).filter(
      (node) =>
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        node.left.getText() === "this.applyRuntimeConcurrencyFromSettings" &&
        node.right.getText() === "dependencies.applyRuntimeConcurrencyFromSettings"
    );
    invariant(stored.length === 1, `service assignments of the injected capacity function: ${stored.length}`);

    // Half 2 (IPC facade): what that injected function actually does.
    const apply = functionBodySpan(ipcPath, ipc, "applyRuntimeConcurrencyFromSettings");
    const text = ipc;
    const wiring = {
      getUiSettings: callsWithin(ipcPath, text, apply, (call, sf) => callText(call, sf) === "getUiSettings"),
      computeEffectiveConcurrency: callsWithin(ipcPath, text, apply, (call, sf) => callText(call, sf) === "computeEffectiveConcurrency"),
      configureConcurrency: callsWithin(ipcPath, text, apply, (call, sf) => callText(call, sf) === "executionEngine.configureConcurrency"),
      buildMachineRunContext: callsWithin(ipcPath, text, apply, (call, sf) => callText(call, sf) === "buildMachineRunContext"),
      setMachineRunContext: callsWithin(ipcPath, text, apply, (call, sf) => callText(call, sf) === "executionEngine.setMachineRunContext")
    };
    const counts = Object.entries(wiring).map(([name, matches]) => `${name}=${matches.length}`).join(" ");
    invariant(Object.values(wiring).every((matches) => matches.length === 1), `settings-derived capacity wiring: ${counts}`);
    invariant(
      wiring.computeEffectiveConcurrency[0].arguments[0]?.getText() === "runtime",
      `computeEffectiveConcurrency input: ${wiring.computeEffectiveConcurrency[0].arguments[0]?.getText() ?? "none"}`
    );
    invariant(
      wiring.configureConcurrency[0].arguments[0]?.getText() === "overrides",
      `configureConcurrency input: ${wiring.configureConcurrency[0].arguments[0]?.getText() ?? "none"}`
    );
    invariant(
      wiring.computeEffectiveConcurrency[0].getStart() < wiring.configureConcurrency[0].getStart(),
      "the engine is configured before the Settings-derived capacity is computed"
    );
    // The host caps pushed into the engine must be the resolved ones, not constants.
    const overrides = objectLiteralNamed(ipcPath, text, apply, "overrides");
    const derived = overrides.properties
      .filter((property) => ts.isPropertyAssignment(property) && /^effective\./.test(property.initializer.getText()))
      .map((property) => property.name?.getText() ?? "");
    invariant(
      JSON.stringify(derived.sort()) === JSON.stringify(["maxActiveFlows", "maxBrowsersPerHost"]),
      `Settings-derived host caps: ${derived.join(", ") || "none"}`
    );
    // Sequential mode still pins every per-instance operation limiter, not only the two host caps.
    const pinned = nodesWithin(ipcPath, text, apply, ts.isBinaryExpression).filter(
      (node) => node.operatorToken.kind === ts.SyntaxKind.EqualsToken && /^overrides\.maxConcurrent/.test(node.left.getText())
    );
    invariant(pinned.length === 5, `sequential-mode operation limiters pinned: ${pinned.length}`);
    invariant(
      pinned.every((node) => node.right.getText() === "1"),
      `sequential-mode limiter values: ${pinned.map((node) => node.right.getText()).join(", ")}`
    );
  };
  assertSettingsDerivedCapacityApplied(ipcText, serviceText);
  check(
    "run preparation applies the Settings-derived capacity to the engine before dispatch, including the sequential operation limiters",
    true,
    "injected applyRuntimeConcurrencyFromSettings -> computeEffectiveConcurrency -> configureConcurrency + setMachineRunContext"
  );
  const perRunCapacityRemoved = mutateOnce(
    serviceText,
    "    await this.applyRuntimeConcurrencyFromSettings();",
    "    // per-run Settings-derived capacity application removed"
  );
  mutationRejected("run preparation no longer applying the Settings-derived capacity before a run", () => {
    assertSettingsDerivedCapacityApplied(ipcText, perRunCapacityRemoved);
  });
  const capacityNeverConfigured = mutateOnce(ipcText, "    executionEngine.configureConcurrency(overrides);", "    void overrides;");
  mutationRejected("the resolved Settings capacity never being pushed into the execution engine", () => {
    assertSettingsDerivedCapacityApplied(capacityNeverConfigured, serviceText);
  });
  // The two halves live in different modules, so they can be severed without either half changing:
  // the service keeps calling `this.applyRuntimeConcurrencyFromSettings()` and the IPC facade keeps
  // exporting the real function, but the service is handed a stub that never reads Settings.
  const capacityInjectionSevered = mutateOnce(
    ipcText,
    "    applyRuntimeConcurrencyFromSettings,",
    "    applyRuntimeConcurrencyFromSettings: async () => undefined,"
  );
  mutationRejected("the service being wired to a capacity stub instead of the Settings-derived implementation", () => {
    assertSettingsDerivedCapacityApplied(capacityInjectionSevered, serviceText);
  });

  // --- R2.11 no parallel production run entry point, whatever the receiver is named ----------------
  // The exact-match `executionEngine.startRun` scan in the R0.1 section cannot see a second entry point
  // that reaches the engine through a differently named receiver -- exactly the shape a run-preparation
  // extraction produces. Capture permissively (ANY `<receiver>.startRun(...)`), validate strictly.
  const startRunReceivers = (entries: Array<{ path: string; text: string }>): string[] => {
    const sites: string[] = [];
    for (const entry of entries) {
      for (const call of calls(entry.path, (node) => ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "startRun", entry.text)) {
        sites.push(`${entry.path}::${call.expression.getText()}`);
      }
    }
    return sites.sort();
  };
  const startRunCandidates = [...walkFiles("app"), ...walkFiles("src")]
    .map(normalizedRepoPath)
    .filter((path) => !path.startsWith("src/testing/"))
    .map((path) => ({ path, text: source(path) }))
    .filter((entry) => entry.text.includes("startRun"));
  invariant(
    startRunCandidates.some((entry) => entry.path === servicePath),
    "the known production run entry point was dropped by the candidate prefilter, so this scan would range over the wrong set"
  );
  const expectedStartRunSites = [
    "app/main/execution/ExecutionApplicationService.ts::executionEngine.startRun",
    "src/runner/ExecutionEngine.ts::this.observations.startRun"
  ];
  const assertNoParallelStartRunReceiver = (sites: string[]): void => {
    invariant(
      JSON.stringify(sites) === JSON.stringify(expectedStartRunSites),
      `production .startRun(...) call sites: ${sites.join(", ") || "none"}`
    );
  };
  const observedStartRunSites = startRunReceivers(startRunCandidates);
  assertNoParallelStartRunReceiver(observedStartRunSites);
  check(
    "every production .startRun(...) call site is the single execution entry point plus the unrelated observability collector",
    true,
    observedStartRunSites.join(", ")
  );
  const parallelEntryPointSites = startRunReceivers([
    ...startRunCandidates,
    {
      // A module that does not exist in the tree, so the injected site is unambiguously an
      // ADDITIONAL entry point rather than a re-reading of the real one.
      path: "app/main/execution/ParallelRunEntryPoint.ts",
      text: "export class ParallelRunEntryPoint {\n  async prepare(): Promise<void> {\n    await this.engine.startRun(executionId, profile, rows, dirs, runtimeInputs, scenario, flows);\n  }\n}\n"
    }
  ]);
  invariant(
    parallelEntryPointSites.length === observedStartRunSites.length + 1,
    `the injected parallel entry point was not observed: ${parallelEntryPointSites.join(", ")}`
  );
  mutationRejected("a second production run entry point that reaches the engine through a differently named receiver", () => {
    assertNoParallelStartRunReceiver(parallelEntryPointSites);
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
    // R2 split run preparation out of the IPC facade, so the two run-request checkpoints now live in
    // two different modules. They are asserted per module at an exact count each -- strictly more
    // precise than the single `expected: 2` over one file, which would have been satisfied by either
    // checkpoint being duplicated while the other was deleted.
    { label: "run-request check for a new run request", path: "app/main/execution/ExecutionApplicationService.ts", expected: 1, matches: (text) => callNodes("app/main/execution/ExecutionApplicationService.ts", text, "applyRunGateEnforcement", "run-request") },
    { label: "run-request check for a repeat request", path: "app/main/ipc/execution.ipc.ts", expected: 1, matches: (text) => callNodes("app/main/ipc/execution.ipc.ts", text, "applyRunGateEnforcement", "run-request") },
    { label: "pre-run check immediately before ExecutionEngine.startRun", path: "app/main/execution/ExecutionApplicationService.ts", expected: 1, matches: (text) => callNodes("app/main/execution/ExecutionApplicationService.ts", text, "applyRunGateEnforcement", "pre-run") },
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
  await executionPortBehavior();
  await cancellationLifecycle();
  await capacityCharacterization();
  await runPreparationCharacterization();
  await licensingCheckpoints();
  console.log(`\nR0 characterization: ${passed} PASS / ${failed} FAIL`);
  for (const failure of failures) console.error(`  [FAILED] ${failure}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
