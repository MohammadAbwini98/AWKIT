import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { arch, cpus, freemem, platform, totalmem } from "node:os";
import type { FlowProfile } from "../../profiles/FlowProfile";
import type { WorkflowProfile } from "../../profiles/WorkflowProfile";
import type { CoverageSnapshot } from "../random/CoverageTracker";
import type { ResolvedGenerationConstraints } from "../random/GenerationConstraints";
import { GENERATOR_VERSION } from "../random/GenerationConstraints";

export const FAILURE_ARTIFACT_SCHEMA_VERSION = 1;

export type FailureCategory =
  | "generation"
  | "validation"
  | "roundtrip"
  | "execution"
  | "invariant"
  | "labTimeout"
  | "unexpected";

export interface FailureObservation {
  readonly category: FailureCategory;
  /** Stable defect identity. Shrinking must retain it when present. */
  readonly signature?: string;
  readonly message?: string;
}

export interface FailureDefinitions {
  readonly workflows: readonly WorkflowProfile[];
  readonly flows: readonly FlowProfile[];
}

export interface FailureMachineSnapshot {
  readonly platform: NodeJS.Platform;
  readonly architecture: string;
  readonly cpuCount: number;
  readonly totalMemoryMb: number;
  readonly freeMemoryMb: number;
  readonly nodeVersion: string;
}

export interface FailureArtifact {
  readonly schemaVersion: typeof FAILURE_ARTIFACT_SCHEMA_VERSION;
  readonly artifactId: string;
  readonly createdAt: string;
  readonly seed: string;
  readonly generatorVersion: string;
  readonly failure: FailureObservation;
  readonly definitions: FailureDefinitions;
  readonly constraints: ResolvedGenerationConstraints;
  readonly coverage: CoverageSnapshot;
  readonly machine: FailureMachineSnapshot;
  readonly reproductionCommand: string;
}

export interface WriteFailureArtifactRequest {
  readonly seed: string;
  readonly failure: FailureObservation;
  readonly definitions: FailureDefinitions;
  readonly constraints: ResolvedGenerationConstraints;
  readonly coverage: CoverageSnapshot;
}

export interface FailureArtifactWriterOptions {
  readonly outputDirectory?: string;
  readonly now?: () => Date;
  readonly machineSnapshot?: () => FailureMachineSnapshot;
}

export interface WrittenFailureArtifact {
  readonly directory: string;
  readonly artifactPath: string;
  readonly artifact: FailureArtifact;
}

const SENSITIVE_KEY = /(?:password|passwd|secretValue|apiKey|accessToken|refreshToken|authorization|cookie)/i;
const SENSITIVE_QUERY_KEY = /(?:password|passwd|secret|token|api[_-]?key|authorization|cookie)/i;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function assertNoResolvedSecrets(value: unknown, path = "$", seen = new Set<object>()): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoResolvedSecrets(entry, `${path}[${index}]`, seen));
    return;
  }

  const record = value as Record<string, unknown>;
  if (record.type === "secret" && typeof record.value === "string" && record.value.length > 0) {
    throw new Error(`Refusing to persist a resolved secret at ${path}.value; store only secretName.`);
  }

  for (const [key, entry] of Object.entries(record)) {
    if (SENSITIVE_KEY.test(key) && typeof entry === "string" && entry.length > 0) {
      throw new Error(`Refusing to persist sensitive field ${path}.${key}.`);
    }
    if ((key === "url" || key === "baseUrl") && typeof entry === "string") {
      try {
        const url = new URL(entry);
        for (const queryKey of url.searchParams.keys()) {
          if (SENSITIVE_QUERY_KEY.test(queryKey)) {
            throw new Error(`Refusing to persist a sensitive URL query parameter at ${path}.${key}.`);
          }
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Refusing")) throw error;
      }
    }
    assertNoResolvedSecrets(entry, `${path}.${key}`, seen);
  }
}

function defaultMachineSnapshot(): FailureMachineSnapshot {
  return {
    platform: platform(),
    architecture: arch(),
    cpuCount: cpus().length,
    totalMemoryMb: Math.round(totalmem() / 1024 / 1024),
    freeMemoryMb: Math.round(freemem() / 1024 / 1024),
    nodeVersion: process.version
  };
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "failure";
}

async function createUniqueDirectory(root: string, preferredName: string): Promise<string> {
  await mkdir(root, { recursive: true });
  for (let suffix = 0; suffix < 10_000; suffix += 1) {
    const candidate = join(root, suffix === 0 ? preferredName : `${preferredName}-${suffix}`);
    try {
      await mkdir(candidate);
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error(`Unable to allocate a unique failure-artifact directory under ${root}.`);
}

async function writeJsonExclusive(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

export class FailureArtifactWriter {
  private readonly outputDirectory: string;
  private readonly now: () => Date;
  private readonly machineSnapshot: () => FailureMachineSnapshot;

  constructor(options: FailureArtifactWriterOptions = {}) {
    this.outputDirectory = resolve(options.outputDirectory ?? join(process.cwd(), "reports", "random-tests", "failures"));
    this.now = options.now ?? (() => new Date());
    this.machineSnapshot = options.machineSnapshot ?? defaultMachineSnapshot;
  }

  async write(request: WriteFailureArtifactRequest): Promise<WrittenFailureArtifact> {
    assertNoResolvedSecrets(request);
    const createdAt = this.now().toISOString();
    const preferredName = `${createdAt.replace(/[:.]/g, "-")}-${safeSegment(request.seed)}-${request.failure.category}`;
    const directory = await createUniqueDirectory(this.outputDirectory, preferredName);
    const artifactPath = join(directory, "failure.json");
    const artifactId = basename(directory);
    const relativeArtifact = join("reports", "random-tests", "failures", artifactId, "failure.json");
    const artifact: FailureArtifact = {
      schemaVersion: FAILURE_ARTIFACT_SCHEMA_VERSION,
      artifactId,
      createdAt,
      seed: request.seed,
      generatorVersion: GENERATOR_VERSION,
      failure: clone(request.failure),
      definitions: clone(request.definitions),
      constraints: clone(request.constraints),
      coverage: clone(request.coverage),
      machine: clone(this.machineSnapshot()),
      reproductionCommand: `npm run test:random:reproduce -- --artifact "${relativeArtifact}"`
    };

    await writeJsonExclusive(join(directory, "original-definitions.json"), artifact.definitions);
    await writeJsonExclusive(join(directory, "constraints.json"), artifact.constraints);
    await writeJsonExclusive(join(directory, "coverage.json"), artifact.coverage);
    await writeJsonExclusive(join(directory, "machine.json"), artifact.machine);
    await writeJsonExclusive(artifactPath, artifact);
    return { directory, artifactPath, artifact };
  }
}
