import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import type { WorkflowProfile } from "@src/profiles/WorkflowProfile";
import {
  FailureArtifactWriter,
  type FailureArtifact,
  type FailureDefinitions,
  type FailureMachineSnapshot
} from "@src/testing/failures/FailureArtifactWriter";
import { FailureReproducer } from "@src/testing/failures/FailureReproducer";
import { Shrinker } from "@src/testing/failures/Shrinker";
import { CoverageTracker } from "@src/testing/random/CoverageTracker";
import { GENERATOR_VERSION, resolveConstraints } from "@src/testing/random/GenerationConstraints";
import { parseRandomLabArgs } from "./random-test-lab.mts";

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function rejects(label: string, action: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await action();
    check(label, false, "did not reject");
  } catch (error) {
    check(label, pattern.test(error instanceof Error ? error.message : String(error)));
  }
}

const root = await mkdtemp(join(tmpdir(), "awkit-random-failures-"));
try {
  const constraints = resolveConstraints({ seed: "phase-4-verifier", workflowCount: 1 });
  const coverage = new CoverageTracker().snapshot();
  const machine: FailureMachineSnapshot = {
    platform: "win32",
    architecture: "x64",
    cpuCount: 8,
    totalMemoryMb: 16_384,
    freeMemoryMb: 8_192,
    nodeVersion: "v-test"
  };
  const simpleFlow: FlowProfile = {
    id: "flow-primary",
    name: "Primary",
    version: 1,
    nodes: [
      { id: "start", type: "start", name: "Start" },
      { id: "target", type: "wait", name: "Target", config: { maxIterations: 4 } },
      { id: "end", type: "end", name: "End" }
    ],
    edges: [
      { id: "edge-1", source: "start", target: "target", type: "success" },
      { id: "edge-2", source: "target", target: "end", type: "success", maxLoopCount: 3 }
    ]
  };
  const unrelatedFlow: FlowProfile = {
    id: "flow-unrelated",
    name: "Unrelated",
    version: 1,
    nodes: [
      { id: "u-start", type: "start", name: "Start" },
      { id: "u-end", type: "end", name: "End" }
    ],
    edges: [{ id: "u-edge", source: "u-start", target: "u-end", type: "success" }]
  };
  const workflow: WorkflowProfile = {
    id: "workflow",
    name: "Workflow",
    version: 1,
    nodes: [
      { id: "w-start", type: "start", alias: "Start", order: 0 },
      {
        id: "w-ref-primary",
        type: "flowRef",
        flowId: simpleFlow.id,
        alias: simpleFlow.name,
        order: 1,
        required: true,
        inputBindings: {}
      },
      {
        id: "w-ref-unrelated",
        type: "flowRef",
        flowId: unrelatedFlow.id,
        alias: unrelatedFlow.name,
        order: 2,
        required: false,
        inputBindings: {}
      },
      { id: "w-end", type: "end", alias: "End", order: 3 }
    ],
    edges: [
      { id: "w-edge-1", source: "w-start", target: "w-ref-primary", type: "always" },
      { id: "w-edge-2", source: "w-ref-primary", target: "w-ref-unrelated", type: "always" },
      { id: "w-edge-3", source: "w-ref-unrelated", target: "w-end", type: "always" }
    ],
    runtimeInputs: [],
    execution: { mode: "parallel", maxConcurrentInstances: 8, stopOnRequiredFlowFailure: true }
  };
  const definitions: FailureDefinitions = { workflows: [workflow], flows: [simpleFlow, unrelatedFlow] };
  const writer = new FailureArtifactWriter({
    outputDirectory: join(root, "reports", "random-tests", "failures"),
    now: () => new Date("2026-07-29T08:00:00.000Z"),
    machineSnapshot: () => machine
  });
  const request = {
    seed: constraints.seed,
    failure: { category: "invariant" as const, signature: "target-present", message: "Target remains." },
    definitions,
    constraints,
    coverage
  };

  console.log("\nFailure artifact writer");
  const first = await writer.write(request);
  const second = await writer.write(request);
  check("same timestamp and seed allocate distinct artifact directories", first.directory !== second.directory);
  check("reproduction command is npm/Windows safe", first.artifact.reproductionCommand.includes(' --artifact "reports\\'));
  check("artifact records the generator version", first.artifact.generatorVersion === GENERATOR_VERSION);
  check("machine snapshot excludes hostname and username", !/hostname|username|userName/i.test(JSON.stringify(first.artifact.machine)));
  check(
    "original definitions are preserved in a dedicated immutable file",
    (await readFile(join(first.directory, "original-definitions.json"), "utf8")).includes('"flow-primary"')
  );
  await rejects(
    "resolved secret values are rejected before persistence",
    () =>
      writer.write({
        ...request,
        definitions: {
          workflows: [],
          flows: [{ ...simpleFlow, nodes: [{ id: "secret", type: "fill", name: "Secret", valueSource: { type: "secret", secretName: "login", value: "plaintext" } }], edges: [] }]
        }
      }),
    /Refusing to persist a resolved secret/
  );

  console.log("\nFailure reproducer");
  const reproducer = new FailureReproducer();
  const exact = await reproducer.reproduce(first.artifactPath, (candidate) =>
    candidate.flows.some((flow) => flow.nodes.some((node) => node.id === "target"))
      ? { category: "invariant", signature: "target-present" }
      : undefined
  );
  check("same category and signature reproduce", exact.reproduced);
  const wrongSignature = await reproducer.reproduce(first.artifactPath, () => ({
    category: "invariant",
    signature: "different"
  }));
  check("same category with a different signature does not reproduce", !wrongSignature.reproduced);
  const stalePath = join(root, "stale.json");
  await writeFile(stalePath, JSON.stringify({ ...first.artifact, generatorVersion: "0.0.0" }), "utf8");
  await rejects("generator-version drift fails loudly", () => reproducer.load(stalePath), /Generator version mismatch/);

  console.log("\nCategory-preserving shrinker");
  const storedBefore = JSON.stringify(first.artifact.definitions);
  const result = await new Shrinker().shrink(first.artifact, (candidate) =>
    candidate.flows.some((flow) => flow.nodes.some((node) => node.id === "target"))
      ? { category: "invariant", signature: "target-present" }
      : undefined
  );
  check("unrelated flows are removed first", result.minimizedDefinitions.flows.length === 1);
  check("the signature-owning node remains", result.minimizedDefinitions.flows[0]?.nodes.some((node) => node.id === "target"));
  check("concurrency is reduced after structural stages", result.minimizedDefinitions.workflows[0]?.execution.maxConcurrentInstances === 1);
  const stageOrder = result.steps.map((step) => step.stage);
  check(
    "accepted shrink steps preserve the mandated stage order",
    stageOrder.every((stage, index) => index === 0 || ["removeUnrelatedFlows", "removeBranches", "removeNonessentialNodes", "reduceConcurrency", "reduceLoopIterations"].indexOf(stage) >= ["removeUnrelatedFlows", "removeBranches", "removeNonessentialNodes", "reduceConcurrency", "reduceLoopIterations"].indexOf(stageOrder[index - 1]!))
  );
  check("stored originals are never mutated", JSON.stringify(first.artifact.definitions) === storedBefore);

  console.log("\nCLI argument contract");
  const spaced = parseRandomLabArgs(["reproduce", "--artifact", "C:\\Lab Artifacts\\failure.json"]);
  const equals = parseRandomLabArgs(["smoke", "--seed=windows-seed", "--workflow-count=3"]);
  check("space-containing Windows artifact paths stay intact", spaced.artifact === "C:\\Lab Artifacts\\failure.json");
  check("equals-form options are supported", equals.seed === "windows-seed" && equals.workflowCount === 3);
  await rejects(
    "reproduce requires an artifact",
    async () => parseRandomLabArgs(["reproduce"]),
    /--artifact is required/
  );

  console.log(`\nRandom failure infrastructure: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
}
