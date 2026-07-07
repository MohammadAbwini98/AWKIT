/**
 * Artifact stress verification (Phase 4E — deterministic, no browsers).
 * Run with: npm run verify:stress:artifacts
 *
 * Proves under pressure: many concurrent instances writing JSONL run logs and end-of-run
 * state artifacts at the same time produce complete, valid, line-atomic files that are never
 * mixed between runs, and secrets stay masked even under concurrent writes.
 *
 * Tunables: AWKIT_STRESS_INSTANCES (25), AWKIT_STRESS_TIMEOUT_MS (120000).
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunLogger } from "@src/runner/artifacts/RunLogger";
import { writeRunStateArtifacts } from "@src/runner/artifacts/RunStateArtifacts";

const STRESS_INSTANCES = envInt("AWKIT_STRESS_INSTANCES", 25);
const STRESS_TIMEOUT_MS = envInt("AWKIT_STRESS_TIMEOUT_MS", 120_000);
const EVENTS_PER_INSTANCE = 50;

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

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function main(): Promise<void> {
  console.log(`Artifact stress verification (${STRESS_INSTANCES} instances × ${EVENTS_PER_INSTANCE} events)`);
  const root = await mkdtemp(join(tmpdir(), "awkit-stress-artifacts-"));

  console.log("\nPart A — concurrent JSONL run logs: complete, valid, never mixed");
  const instanceIds = Array.from({ length: STRESS_INSTANCES }, (_, index) => `stress-run-i${index}`);
  const loggers = new Map(instanceIds.map((id) => [id, new RunLogger(join(root, "logs", `${id}.jsonl`))]));

  await Promise.all(
    instanceIds.map(async (id) => {
      const logger = loggers.get(id)!;
      for (let event = 0; event < EVENTS_PER_INSTANCE; event += 1) {
        logger.log({
          runId: id,
          nodeId: `node-${event}`,
          event: "stepCompleted",
          message: `step ${event} of ${id} password=super-secret-${event}`,
          data: { index: event, owner: id }
        });
        if (event % 10 === 0) await new Promise((resolve) => setImmediate(resolve));
      }
      await logger.flush();
    })
  );

  let completeFiles = 0;
  let validLines = 0;
  let invalidLines = 0;
  let mixedLines = 0;
  let unmaskedSecrets = 0;
  for (const id of instanceIds) {
    const content = await readFile(join(root, "logs", `${id}.jsonl`), "utf8").catch(() => "");
    const lines = content.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length === EVENTS_PER_INSTANCE) completeFiles += 1;
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as { runId?: string; message?: string; data?: { owner?: string } };
        validLines += 1;
        if (parsed.runId !== id || (parsed.data?.owner && parsed.data.owner !== id)) mixedLines += 1;
        if (parsed.message?.includes("super-secret")) unmaskedSecrets += 1;
      } catch {
        invalidLines += 1;
      }
    }
  }
  check(`every log file is complete (${completeFiles}/${STRESS_INSTANCES} files with ${EVENTS_PER_INSTANCE} lines)`, completeFiles === STRESS_INSTANCES);
  check(`every line is valid JSON (${validLines} valid, ${invalidLines} invalid)`, invalidLines === 0 && validLines === STRESS_INSTANCES * EVENTS_PER_INSTANCE);
  check("no lines mixed between runs", mixedLines === 0, `mixed=${mixedLines}`);
  check("secrets masked in every line under concurrency", unmaskedSecrets === 0, `unmasked=${unmaskedSecrets}`);

  console.log("\nPart B — concurrent end-of-run state artifacts");
  const writeErrors: string[] = [];
  await Promise.all(
    instanceIds.map(async (id) => {
      const error = await writeRunStateArtifacts(join(root, "state", id), {
        runId: `exec-${id}`,
        instanceId: id,
        scenarioId: "stress-workflow",
        flowRunStatus: "completed",
        transitions: [
          { from: "pending", to: "running", at: new Date().toISOString() },
          { from: "running", to: "completed", at: new Date().toISOString() }
        ] as never,
        nodeAttempts: Array.from({ length: 10 }, (_, attempt) => ({
          attemptId: `${id}-a${attempt}`,
          nodeId: `node-${attempt}`,
          tryNumber: 1,
          status: "completed"
        })) as never
      });
      if (error) writeErrors.push(`${id}: ${error}`);
    })
  );
  check("every instance's state artifacts wrote without error", writeErrors.length === 0, writeErrors.slice(0, 3).join("; "));

  let stateValid = 0;
  let stateMixed = 0;
  for (const id of instanceIds) {
    try {
      const state = JSON.parse(await readFile(join(root, "state", id, "flow-state.json"), "utf8")) as { instanceId?: string };
      const attempts = JSON.parse(await readFile(join(root, "state", id, "node-attempts.json"), "utf8")) as Array<{ attemptId?: string }>;
      stateValid += 1;
      if (state.instanceId !== id || attempts.some((attempt) => !attempt.attemptId?.startsWith(id))) stateMixed += 1;
    } catch {
      // counted by stateValid shortfall
    }
  }
  check(`state files parse for every instance (${stateValid}/${STRESS_INSTANCES})`, stateValid === STRESS_INSTANCES);
  check("state files never mixed between instances", stateMixed === 0, `mixed=${stateMixed}`);

  await rm(root, { recursive: true, force: true });
  console.log(`\nResult: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

const timeout = setTimeout(() => {
  console.error(`✗ Stress run exceeded AWKIT_STRESS_TIMEOUT_MS (${STRESS_TIMEOUT_MS}ms).`);
  process.exit(1);
}, STRESS_TIMEOUT_MS);
timeout.unref();

main().catch((error) => {
  console.error(`✗ Unhandled failure: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
