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

/** Resolve a repo-relative import target to the source file it actually names, if any. */
const moduleFileCache = new Map<string, string | null>();
async function resolveModule(target: string): Promise<string | null> {
  const cached = moduleFileCache.get(target);
  if (cached !== undefined) return cached;
  let found: string | null = null;
  for (const suffix of [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", "/index.ts", "/index.tsx"]) {
    const candidate = `${target}${suffix}`;
    try {
      await readFile(join(REPO, candidate), "utf8");
      found = candidate;
      break;
    } catch {
      // Not this extension.
    }
  }
  moduleFileCache.set(target, found);
  return found;
}

/**
 * The modules that actually speak to the model: the service that owns the transport, the prompt
 * builder, the wire protocol, the fake, and the main-process host manager. Everything else under
 * `src/ai` is pure — the locator plan compiler and the pending-upgrade record are data and policy,
 * and L3 has the runner compile and persist against them deliberately.
 */
const MODEL_BEARING = [
  "src/ai/AiService",
  "src/ai/AiPromptBuilder",
  "src/ai/FakeAiHostTransport",
  "src/ai/contracts/AiHostProtocol",
  "app/main/ai",
];
const isModelBearing = (target: string): boolean =>
  MODEL_BEARING.some((m) => target === m || target.startsWith(`${m}/`) || target.startsWith(`${m}.`));

console.log("\nThe execution tree cannot reach the model:\n");
{
  const trees = ["src/runner", "src/recorder", "src/orchestrator", "src/instances", "src/session"];
  const files = (await Promise.all(trees.map((tree) => sourceFiles(join(REPO, tree))))).flat();
  check("the execution tree was actually scanned", files.length >= 100, String(files.length));

  let imports = 0;
  for (const file of files) imports += (await importTargets(file)).length;
  // Floor measured at 336 resolved imports on 2026-09-19; a large drop means the scan stopped seeing them.
  check("its imports were resolved", imports >= 300, String(imports));

  // Reachability, not adjacency. A one-hop "does it import src/ai" ban is blind to a model reached
  // through an intermediate module, and it also condemns the pure plan/pending-upgrade modules the
  // runner legitimately depends on. Walk the whole closure instead and judge only the real thing.
  const start = files.map((f) => relative(REPO, f).replace(/\\/g, "/"));
  const seen = new Set<string>(start);
  const cameFrom = new Map<string, string>();
  const queue = [...start];
  const offenders: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const target of await importTargets(join(REPO, current))) {
      if (isModelBearing(target)) {
        const chain = [current];
        for (let at = current; cameFrom.has(at); ) {
          at = cameFrom.get(at) as string;
          chain.unshift(at);
        }
        offenders.push(`${chain.join(" -> ")} -> ${target}`);
        continue;
      }
      const resolved = await resolveModule(target);
      if (!resolved || seen.has(resolved)) continue;
      seen.add(resolved);
      cameFrom.set(resolved, current);
      queue.push(resolved);
    }
  }
  // Floor measured at 162 modules from 122 files on 2026-09-20. It must stay wider than the trees it
  // started from, or the walk collapsed to its own seed and proves nothing.
  check(
    "the closure was actually walked",
    seen.size >= 150 && seen.size > files.length,
    `${seen.size} modules from ${files.length} files`
  );
  check("no module the execution tree can reach, at any depth, reaches the model", offenders.length === 0, offenders.join("; "));
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

  // The bridge is the renderer's only way in. It must exist (so this is not vacuous) and must offer
  // no channel shaped like prompting, loading, spawning or naming a file.
  const preload = await readFile(join(REPO, "app/main/preload.ts"), "utf8");
  const aiChannels = [...preload.matchAll(/invoke\("(ai:[A-Za-z]+)"/g)].map((m) => m[1]);
  check("the preload exposes an ai namespace to inspect", aiChannels.length >= 5, aiChannels.join(","));
  const shaped = aiChannels.filter((channel) => /infer|prompt|submit|complete|chat|generate|load(?!Model)|spawn|exec|path|file/i.test(channel));
  check("no ai channel can run a prompt, spawn a process or name a file", shaped.length === 0, shaped.join(","));
  // An exact roster, so a new channel has to be admitted here deliberately rather than inherited.
  // `request` and `state` are structured, and neither is trusted: `ai:promoteUpgrade` runs
  // `sanitizePromotionRequest` behind AI_USE plus WORKFLOW_EDIT, and `ai:setEditorState` runs
  // `sanitizeFlowEditorState` behind WORKFLOW_EDIT and can only ever make promotion stricter.
  // L4b: `ai:explainValidation` takes a request id and a flow profile, which main runs through
  // `sanitizeAuthoringAssistRequest` and the real FlowValidator and never turns into prompt text;
  // `ai:cancelAssist` takes a request id that main scopes to the asking window. L6:
  // `ai:summarizeFragment` names a stored fragment through `sanitizeFragmentSummaryRequest`; main
  // reads the fragment itself and sends step types and input keys only. L5b: `ai:analyzeFailure`
  // names a stored run and instance through `sanitizeFailureAnalysisRequest`; main reads the report.
  const argumentsTaken = [...preload.matchAll(/(ai:[A-Za-z]+)", ([a-zA-Z]+)\)/g)].map((m) => `${m[1]}(${m[2]})`);
  // Without this the .every() below passes on an empty list the moment the pattern stops matching.
  check("the bridge's arguments were actually read", argumentsTaken.length === 11, argumentsTaken.join(","));
  check(
    "only settings, a feature id, an audit page, an action id, a flow id, a promotion, editor state and named assist jobs cross the bridge",
    argumentsTaken.every((call) =>
      /^ai:(updateSettings\(patch\)|restoreFeature\(feature\)|listAudit\(page\)|revert\(actionId\)|listUpgrades\(flowId\)|promoteUpgrade\(request\)|setEditorState\(state\)|explainValidation\(request\)|summarizeFragment\(request\)|analyzeFailure\(request\)|cancelAssist\(requestId\))$/.test(call)
    ),
    argumentsTaken.join(",")
  );
}

clearInterval(keepAlive);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
