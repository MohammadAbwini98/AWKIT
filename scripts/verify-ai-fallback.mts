/**
 * verify:ai-fallback — Phase L L1 acceptance "the app works unchanged with no runtime or model".
 *
 * Two halves:
 *  1. Degraded modes. Disabled, no runtime, no model, an invalid model, an open circuit, and
 *     throwing providers each come back as a result code with ZERO host calls; nothing throws.
 *  2. Structure. The synchronous run path makes zero model calls because no module under the runner,
 *     recorder, orchestrator, instance or session trees can even import `src/ai`; and the renderer
 *     cannot run a prompt because it cannot import the service, the host protocol, the prompt builder
 *     or the fake. Import specifiers are RESOLVED, not string-matched, so `../ai/` from a nested
 *     runner file is judged by where it actually points.
 *
 * What makes it fail: a degraded mode that reaches the host or throws; any import of `src/ai` from
 * the execution tree; any renderer import of the inference machinery. The scans assert how many files
 * they read, so an emptied scan cannot pass.
 *
 * Run: npm run verify:ai-fallback
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import type { AiAdmissionView } from "@src/ai/AiAdmission";
import { AiService, type AiJobRequest, type AiModelResolution, type AiServiceSettings } from "@src/ai/AiService";
import { FakeAiHostTransport } from "@src/ai/FakeAiHostTransport";

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

const keepAlive = setInterval(() => undefined, 1_000);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const REPO = resolve(".");
const ROOT = resolve("ai-fake-models");
const IDLE: AiAdmissionView = { activeRuns: 0, queuedRuns: 0, pressureState: "healthy", dispatchBlocked: false, activeWeight: 0, weightedBudget: 4, freeMemoryMb: 8_000 };

function job(requestId: string): AiJobRequest {
  return {
    requestId,
    feature: "validationExplanation",
    priority: "interactive",
    prompt: { instructions: "Explain the validation issue.", fields: [{ name: "issue", text: "Missing start node" }], maxDataChars: 1_000 },
    schema: { type: "object", properties: { text: { type: "string", maxLength: 200 } }, required: ["text"], additionalProperties: false },
    maxOutputTokens: 64,
    timeoutMs: 1_000
  };
}

function service(options: {
  transport?: FakeAiHostTransport | null;
  model?: () => Promise<AiModelResolution>;
  settings?: () => Promise<AiServiceSettings>;
  admission?: () => AiAdmissionView;
}) {
  return new AiService({
    transport: () => (options.transport === undefined ? null : options.transport),
    model: options.model ?? (async () => ({ ok: true, modelId: "m", modelPath: join(ROOT, "m.gguf"), contextTokens: 4096 })),
    settings: options.settings ?? (async () => ({ enabled: true, yieldDuringRuns: true, idleUnloadMs: 0, minFreeMemoryMb: 0 })),
    admission: options.admission ?? (() => IDLE),
    threads: 2,
    limits: { yieldCheckMs: 5, admissionRetryMs: 10 }
  });
}

console.log("Degraded modes return a code and never touch the host:\n");
{
  const cases: Array<{ label: string; build: (fake: FakeAiHostTransport) => AiService; want: string; state: string }> = [
    {
      label: "the master switch off",
      build: (fake) => service({ transport: fake, settings: async () => ({ enabled: false, yieldDuringRuns: true, idleUnloadMs: 0, minFreeMemoryMb: 0 }) }),
      want: "DISABLED/DISABLED",
      state: "DISABLED"
    },
    { label: "no runtime in this build", build: () => service({ transport: null }), want: "UNAVAILABLE/RUNTIME_MISSING", state: "RUNTIME_MISSING" },
    {
      label: "no model pack",
      build: (fake) => service({ transport: fake, model: async () => ({ ok: false, reason: "MODEL_MISSING" }) }),
      want: "UNAVAILABLE/MODEL_MISSING",
      state: "MODEL_MISSING"
    },
    {
      label: "an invalid model pack",
      build: (fake) => service({ transport: fake, model: async () => ({ ok: false, reason: "MODEL_INVALID" }) }),
      want: "UNAVAILABLE/MODEL_INVALID",
      state: "MODEL_INVALID"
    },
    {
      label: "a model resolver that throws",
      build: (fake) =>
        service({
          transport: fake,
          model: async () => {
            throw new Error("registry unreadable");
          }
        }),
      want: "UNAVAILABLE/MODEL_INVALID",
      state: "MODEL_INVALID"
    }
  ];
  for (const { label, build, want, state } of cases) {
    const fake = new FakeAiHostTransport({ modelRoot: ROOT });
    const ai = build(fake);
    let threw = false;
    let outcome;
    try {
      outcome = await ai.submit(job("f1"));
    } catch {
      threw = true;
    }
    const got = outcome && outcome.status === "rejected" ? `${outcome.code}/${outcome.reason}` : JSON.stringify(outcome);
    check(`${label}: submit does not throw`, !threw);
    check(`${label}: the outcome is ${want}`, got === want, got);
    check(`${label}: zero host calls`, fake.requests.length === 0, fake.requestTypes().join(","));
    const status = (await ai.status()).state;
    check(`${label}: status is unavailable(${state})`, status.kind === "unavailable" && status.reason === state, JSON.stringify(status));
    await ai.shutdown();
  }

  const crashed = new FakeAiHostTransport({ modelRoot: ROOT });
  crashed.crash();
  crashed.crash();
  crashed.crash();
  const open = service({ transport: crashed });
  const openOutcome = await open.submit(job("f2"));
  check("an open circuit is refused with CIRCUIT_OPEN", openOutcome.status === "rejected" && openOutcome.reason === "CIRCUIT_OPEN");
  check("an open circuit makes zero host calls", crashed.requests.length === 0);
  await open.shutdown();

  const throwingSettings = service({
    transport: new FakeAiHostTransport({ modelRoot: ROOT }),
    settings: async () => {
      throw new Error("settings unreadable");
    }
  });
  const settingsOutcome = await throwingSettings.submit(job("f3")).catch(() => "threw");
  check("a settings provider that throws becomes UNAVAILABLE, not an exception", typeof settingsOutcome === "object" && settingsOutcome.status === "rejected");
  check("and status reads as disabled", (await throwingSettings.status()).state.kind === "unavailable");
  await throwingSettings.shutdown();

  const blind = new FakeAiHostTransport({ modelRoot: ROOT });
  const heldBlind = service({
    transport: blind,
    admission: () => {
      throw new Error("engine view unavailable");
    }
  });
  const pending = heldBlind.submit(job("f4"));
  await sleep(40);
  check("an unreadable engine view holds inference instead of guessing", blind.inferRequests().length === 0 && (await heldBlind.status()).holdReason === "DISPATCH_BLOCKED");
  await heldBlind.shutdown();
  check("the held job is released as SHUTDOWN", (await pending).status === "rejected");

  let enabled = true;
  let busy = true;
  const switching = new FakeAiHostTransport({ modelRoot: ROOT });
  const switched = service({
    transport: switching,
    settings: async () => ({ enabled, yieldDuringRuns: true, idleUnloadMs: 0, minFreeMemoryMb: 0 }),
    admission: () => ({ ...IDLE, activeRuns: busy ? 1 : 0 })
  });
  const queued = switched.submit(job("f5"));
  await sleep(20);
  enabled = false;
  busy = false;
  switched.notifyAdmissionChanged();
  const queuedOutcome = await queued;
  check("turning the switch off rejects queued work as DISABLED", queuedOutcome.status === "rejected" && queuedOutcome.code === "DISABLED");
  check("and it never reached the host", switching.inferRequests().length === 0);
  await switched.shutdown();
}

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(path)));
    else if (/\.(?:ts|tsx|mts|cts|js|mjs)$/.test(entry.name)) out.push(path);
  }
  return out;
}

/** Resolve every import/require specifier in a file to a repo-relative target (aliases included). */
async function importTargets(file: string): Promise<string[]> {
  const text = await readFile(file, "utf8");
  const targets: string[] = [];
  for (const match of text.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm)) {
    const specifier = match[1];
    let absolute: string | null = null;
    if (specifier.startsWith("@src/")) absolute = join(REPO, "src", specifier.slice(5));
    else if (specifier.startsWith(".")) absolute = resolve(dirname(file), specifier);
    if (absolute) targets.push(relative(REPO, absolute).replace(/\\/g, "/"));
  }
  return targets;
}

console.log("\nThe execution tree cannot reach the model:\n");
{
  const trees = ["src/runner", "src/recorder", "src/orchestrator", "src/instances", "src/session"];
  const files = (await Promise.all(trees.map((tree) => sourceFiles(join(REPO, tree))))).flat();
  check("the execution tree was actually scanned", files.length >= 100, String(files.length));
  const offenders: string[] = [];
  let imports = 0;
  for (const file of files) {
    for (const target of await importTargets(file)) {
      imports += 1;
      if (target === "src/ai" || target.startsWith("src/ai/")) offenders.push(`${relative(REPO, file)} -> ${target}`);
    }
  }
  // Floor measured at 336 resolved imports on 2026-09-19; a large drop means the scan stopped seeing them.
  check("its imports were resolved", imports >= 300, String(imports));
  check("no runner, recorder, orchestrator, instance or session module imports src/ai", offenders.length === 0, offenders.join("; "));
}

console.log("\nThe renderer cannot run a prompt:\n");
{
  const files = await sourceFiles(join(REPO, "app/renderer"));
  check("the renderer was actually scanned", files.length >= 50, String(files.length));
  const forbidden = ["src/ai/AiService", "src/ai/FakeAiHostTransport", "src/ai/AiPromptBuilder", "src/ai/contracts/AiHostProtocol"];
  const offenders: string[] = [];
  for (const file of files) {
    for (const target of await importTargets(file)) {
      if (forbidden.some((f) => target === f || target.startsWith(`${f}.`))) offenders.push(`${relative(REPO, file)} -> ${target}`);
    }
  }
  check("no renderer module imports the service, host protocol, prompt builder or fake", offenders.length === 0, offenders.join("; "));
}

clearInterval(keepAlive);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
