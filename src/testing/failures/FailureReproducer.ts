import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { GENERATOR_VERSION } from "../random/GenerationConstraints";
import {
  FAILURE_ARTIFACT_SCHEMA_VERSION,
  type FailureArtifact,
  type FailureDefinitions,
  type FailureObservation
} from "./FailureArtifactWriter";

export type FailureEvaluator = (
  definitions: FailureDefinitions,
  artifact: FailureArtifact
) => FailureObservation | undefined | Promise<FailureObservation | undefined>;

export interface FailureReproductionResult {
  readonly artifactPath: string;
  readonly reproduced: boolean;
  readonly expected: FailureObservation;
  readonly observed?: FailureObservation;
}

export function isSameFailure(expected: FailureObservation, observed: FailureObservation | undefined): boolean {
  if (!observed || observed.category !== expected.category) return false;
  return expected.signature === undefined || observed.signature === expected.signature;
}

function assertArtifact(value: unknown): asserts value is FailureArtifact {
  if (!value || typeof value !== "object") throw new Error("Failure artifact must be a JSON object.");
  const artifact = value as Partial<FailureArtifact>;
  if (artifact.schemaVersion !== FAILURE_ARTIFACT_SCHEMA_VERSION) {
    throw new Error(`Unsupported failure-artifact schema: ${String(artifact.schemaVersion)}.`);
  }
  if (artifact.generatorVersion !== GENERATOR_VERSION) {
    throw new Error(
      `Generator version mismatch: artifact=${String(artifact.generatorVersion)}, current=${GENERATOR_VERSION}.`
    );
  }
  if (!artifact.seed || !artifact.failure || !artifact.definitions || !artifact.constraints || !artifact.coverage) {
    throw new Error("Failure artifact is missing required reproduction fields.");
  }
}

export class FailureReproducer {
  async load(artifactPath: string): Promise<FailureArtifact> {
    const absolutePath = resolve(artifactPath);
    const artifact: unknown = JSON.parse(await readFile(absolutePath, "utf8"));
    assertArtifact(artifact);
    return structuredClone(artifact);
  }

  async reproduce(artifactPath: string, evaluator: FailureEvaluator): Promise<FailureReproductionResult> {
    const absolutePath = resolve(artifactPath);
    const artifact = await this.load(absolutePath);
    const observed = await evaluator(structuredClone(artifact.definitions), structuredClone(artifact));
    return {
      artifactPath: absolutePath,
      reproduced: isSameFailure(artifact.failure, observed),
      expected: structuredClone(artifact.failure),
      ...(observed ? { observed: structuredClone(observed) } : {})
    };
  }
}
