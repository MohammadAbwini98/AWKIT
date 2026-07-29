import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { toDesignerDocument, toFlowProfile } from "@renderer/components/workflow/flowProfileMapping";
import { validateFlowProfile } from "@src/testing/oracle/TestExecutionOracle";
import { CoverageTracker } from "@src/testing/random/CoverageTracker";
import { resolveConstraints } from "@src/testing/random/GenerationConstraints";
import { generateCampaign } from "@src/testing/random/RandomWorkflowGenerator";
import { SeededRandom } from "@src/testing/random/SeededRandom";
import { diffSemantic } from "@src/testing/roundtrip/SemanticDiff";
import {
  FailureArtifactWriter,
  type FailureDefinitions,
  type FailureObservation
} from "@src/testing/failures/FailureArtifactWriter";
import { FailureReproducer } from "@src/testing/failures/FailureReproducer";

export interface RandomLabCliOptions {
  readonly command: "campaign" | "smoke" | "reproduce";
  readonly seed?: string;
  readonly artifact?: string;
  readonly workflowCount?: number;
}

function positiveInteger(raw: string, option: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${option} must be a positive integer.`);
  return value;
}

export function parseRandomLabArgs(args: readonly string[]): RandomLabCliOptions {
  const command = args[0];
  if (command !== "campaign" && command !== "smoke" && command !== "reproduce") {
    throw new Error("Usage: random-test-lab <campaign|smoke|reproduce> [--seed VALUE] [--artifact PATH].");
  }
  const values = new Map<string, string>();
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index]!;
    if (!argument.startsWith("--")) throw new Error(`Unexpected positional argument "${argument}".`);
    const equals = argument.indexOf("=");
    if (equals >= 0) {
      values.set(argument.slice(2, equals), argument.slice(equals + 1));
      continue;
    }
    const next = args[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
    values.set(argument.slice(2), next);
    index += 1;
  }
  for (const key of values.keys()) {
    if (!["seed", "artifact", "workflow-count"].includes(key)) throw new Error(`Unknown option --${key}.`);
  }
  const artifact = values.get("artifact");
  if (command === "reproduce" && !artifact) throw new Error("--artifact is required for reproduce.");
  return {
    command,
    ...(values.get("seed") ? { seed: values.get("seed") } : {}),
    ...(artifact ? { artifact } : {}),
    ...(values.get("workflow-count")
      ? { workflowCount: positiveInteger(values.get("workflow-count")!, "--workflow-count") }
      : {})
  };
}

function validationFailure(definitions: FailureDefinitions): FailureObservation | undefined {
  const referenceableFlowIds = new Set(definitions.flows.map((flow) => flow.id));
  for (const flow of definitions.flows) {
    const result = validateFlowProfile(flow, { referenceableFlowIds });
    const codes = [
      ...result.connectorIssues,
      ...result.preRunErrors.map((issue) => issue.message),
      ...result.flowActivePathErrors.map((issue) => issue.code)
    ];
    if (codes.length > 0) {
      return { category: "validation", signature: `${flow.id}:${codes.join("|")}`, message: codes.join("; ") };
    }
  }
  return undefined;
}

function roundtripFailure(definitions: FailureDefinitions): FailureObservation | undefined {
  for (const flow of definitions.flows) {
    const document = toDesignerDocument(flow);
    const reloaded = toFlowProfile(document.nodes, document.edges, flow.id, flow.name, {
      description: flow.description,
      version: flow.version,
      createdAt: flow.createdAt,
      updatedAt: flow.updatedAt
    });
    const differences = diffSemantic(flow, reloaded);
    if (differences.length > 0) {
      const signature = `${flow.id}:${differences.map((difference) => difference.path).sort().join("|")}`;
      return { category: "roundtrip", signature, message: `${differences.length} semantic differences.` };
    }
  }
  return undefined;
}

function evaluateDefinitions(
  definitions: FailureDefinitions,
  category?: FailureObservation["category"]
): FailureObservation | undefined {
  if (!category || category === "validation") {
    const validation = validationFailure(definitions);
    if (validation) return validation;
  }
  if (!category || category === "roundtrip") return roundtripFailure(definitions);
  return undefined;
}

async function runCampaign(options: RandomLabCliOptions): Promise<void> {
  const seed = options.seed ?? `random-lab-${new Date().toISOString().slice(0, 10)}`;
  const workflowCount = options.workflowCount ?? (options.command === "smoke" ? 2 : 25);
  const constraints = resolveConstraints({
    seed,
    workflowCount,
    recorderFidelity: true,
    minNodesPerFlow: 4,
    maxNodesPerFlow: options.command === "smoke" ? 10 : 20
  });
  const coverage = new CoverageTracker();
  const generated = generateCampaign(new SeededRandom(seed), constraints, coverage);
  const definitions: FailureDefinitions = {
    workflows: generated.map((workflow) => workflow.profile),
    flows: generated.flatMap((workflow) => workflow.flows.map((flow) => flow.profile))
  };
  const failure = evaluateDefinitions(definitions);
  if (failure) {
    const written = await new FailureArtifactWriter().write({
      seed,
      failure,
      definitions,
      constraints,
      coverage: coverage.snapshot()
    });
    console.error(`Random Test Lab failed (${failure.category}). Artifact: ${written.artifactPath}`);
    console.error(`Reproduce: ${written.artifact.reproductionCommand}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Random Test Lab ${options.command} passed: ${definitions.workflows.length} workflows, ` +
      `${definitions.flows.length} flows, seed ${seed}.`
  );
}

async function runReproduction(options: RandomLabCliOptions): Promise<void> {
  const artifactPath = resolve(options.artifact!);
  const reproducer = new FailureReproducer();
  const result = await reproducer.reproduce(artifactPath, (definitions, artifact) =>
    evaluateDefinitions(definitions, artifact.failure.category)
  );
  const observed = result.observed ? `${result.observed.category}/${result.observed.signature ?? "no-signature"}` : "none";
  console.log(`Expected: ${result.expected.category}/${result.expected.signature ?? "no-signature"}`);
  console.log(`Observed: ${observed}`);
  console.log(result.reproduced ? "Failure reproduced exactly." : "Failure did not reproduce exactly.");
  if (!result.reproduced) process.exitCode = 1;
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseRandomLabArgs(args);
  if (options.command === "reproduce") await runReproduction(options);
  else await runCampaign(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
