/**
 * Deterministic regression for the browser-storage assertion (`awkit-7o5n`).
 *
 * Before this capability `assertionType` was visible|text|value|count|url|attribute, so nothing in
 * the product could read `localStorage` or `sessionStorage` at all. WDU AI Playground challenge 20
 * ("localStorage Session") exists precisely because the visible UI can claim a session the store
 * does not hold — check [C1]/[C2] are that exact shape, and they are the reason a text assertion is
 * not a substitute.
 *
 * Runs against the local `mock-site/storage-lab` scenario: `StepExecutor` for the focused
 * comparisons, and the real `PlaywrightRunner` for the end-to-end flow, so "the Runner executes it"
 * is measured rather than assumed. No network beyond 127.0.0.1.
 *
 * WHAT REGRESSION MAKES THIS FAIL: removing or weakening the `storage` branch in
 * `executeAssertion`, collapsing the absent-key sentinel back to `""`, ignoring `storageArea`, or
 * dropping `storageArea`/`storageKey` from the Flow Designer mapping.
 *
 * MUTATION CONTRACT (measured, not asserted). Against 32 checks:
 *   - remove the `storage` branch entirely (the capability as it stood before) ... 13 fail
 *   - collapse the absent-key sentinel to `""` ................................... 7 fail
 *   - ignore `storageArea` and always read localStorage .......................... 1 fail
 * The third is deliberately narrow: only [D1] can see it, which is why [D2]/[D3] assert the
 * opposite direction as well — a single check proving an area selector would be thin evidence.
 *
 * Run with: npx tsx scripts/verify-storage-assertions.mts
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { ValueResolver } from "@src/runner/ValueResolver";
import { StepExecutor } from "@src/runner/StepExecutor";
import { MemoryRunnerLogger } from "@src/runner/RunnerResult";
import { PlaywrightRunner } from "@src/runner/PlaywrightRunner";
import { JsonProfileStore } from "@src/storage/ProfileStore";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";
import type { InstanceConfig } from "@src/instances/InstanceConfig";
import type { FlowProfile, FlowStep } from "@src/profiles/FlowProfile";
import type { ScenarioProfile } from "@src/profiles/ScenarioProfile";
import { toFlowStep, fromFlowStep } from "../app/renderer/components/workflow/flowProfileMapping";

const PORT = 4423;
const BASE = `http://127.0.0.1:${PORT}`;
const LAB = `${BASE}/storage-lab`;

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

async function makeContext(flowId = "f"): Promise<InstanceExecutionContext> {
  const dir = await mkdtemp(join(tmpdir(), "awkit-storage-"));
  return {
    executionId: "e",
    instanceId: "i",
    scenarioId: "s",
    flowId,
    instanceOrderNumber: 1,
    totalInstances: 1,
    runtimeInputs: {},
    instanceInputs: {},
    flowOutputs: {},
    paths: {
      downloads: join(dir, "d"),
      screenshots: join(dir, "s"),
      logs: join(dir, "l"),
      reports: join(dir, "r"),
      sessions: join(dir, "se")
    }
  };
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch(LAB)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Mock site did not start");
}

/** A storage assertion step. `area` omitted exercises the documented `local` default. */
function assertStorage(
  id: string,
  key: string,
  expected: string,
  options: { area?: "local" | "session"; op?: "equals" | "contains" } = {}
): FlowStep {
  return {
    id,
    type: "assertText",
    name: id,
    config: {
      assertionType: "storage",
      storageKey: key,
      ...(options.area ? { storageArea: options.area } : {}),
      comparisonOperator: options.op ?? "equals",
      expectedValue: expected
    }
  };
}

const linear = (id: string, steps: FlowStep[]): FlowProfile => {
  const nodes: FlowStep[] = [{ id: "start", type: "start", name: "start" }, ...steps, { id: "end", type: "end", name: "end" }];
  const ids = nodes.map((n) => n.id);
  return {
    id,
    name: id,
    version: 1,
    nodes,
    edges: ids.slice(0, -1).map((source, i) => ({ id: `${id}-e${i}`, source, target: ids[i + 1], type: "success" as const }))
  };
};

async function main(): Promise<void> {
  const server = spawn(process.execPath, ["mock-site/server.mjs"], {
    env: { ...process.env, MOCK_SITE_PORT: String(PORT) },
    stdio: "ignore"
  });
  await waitForServer();

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const ctx = await makeContext();
  const exec = new StepExecutor(page, new LocatorFactory(page), new ValueResolver(ctx), ctx, undefined, new MemoryRunnerLogger());

  const run = async (step: FlowStep): Promise<{ status: string; error?: string }> => {
    const r = await exec.execute(step);
    return { status: r.status, error: r.error };
  };
  const clickLab = (testId: string): Promise<unknown> => page.getByTestId(testId).click();

  try {
    await page.goto(LAB, { waitUntil: "domcontentloaded" });
    await clickLab("storage-reset-all");

    // ── [A] the value is read, and it is read from the right area ─────────────────────────────
    console.log("\n[A] reading a stored value");
    await clickLab("storage-signin");
    check(
      "[A1] a key holding the expected value passes",
      (await run(assertStorage("a1", "awkit-session", "lab-operator", { op: "contains" }))).status === "passed"
    );
    const wrong = await run(assertStorage("a2", "awkit-session", "someone-else", { op: "contains" }));
    check("[A2] a key holding a DIFFERENT value fails", wrong.status === "failed", wrong.status);
    check("[A3] ...and the failure quotes what was actually stored", /lab-operator/.test(wrong.error ?? ""), wrong.error);
    check(
      "[A4] the default area is localStorage (no storageArea configured)",
      (await run(assertStorage("a4", "awkit-session", "lab-operator", { op: "contains" }))).status === "passed"
    );

    // ── [B] absent is not empty ───────────────────────────────────────────────────────────────
    console.log("\n[B] absent key vs empty value");
    const missing = await run(assertStorage("b1", "awkit-never-written", ""));
    check("[B1] an ABSENT key does not satisfy an empty expected value", missing.status === "failed", missing.status);
    check("[B2] ...and reports it as (absent), not as an empty string", /\(absent\)/.test(missing.error ?? ""), missing.error);
    await clickLab("storage-write-empty");
    check("[B3] a key genuinely holding '' does satisfy an empty expected value", (await run(assertStorage("b3", "awkit-empty", ""))).status === "passed");
    await clickLab("storage-remove-empty");
    const removed = await run(assertStorage("b4", "awkit-empty", ""));
    check("[B4] removing that same key flips the identical assertion to a failure", removed.status === "failed", removed.status);
    check("[B5] ...reported as (absent)", /\(absent\)/.test(removed.error ?? ""), removed.error);

    // ── [C] the capability's whole reason to exist: the UI can lie ────────────────────────────
    console.log("\n[C] the UI can contradict the store");
    await clickLab("storage-signout");
    await clickLab("storage-fake-signin");
    const bannerText = await run({
      id: "c1",
      type: "assertText",
      name: "c1",
      locator: { strategy: "testId", value: "storage-status" },
      config: { assertionType: "text", comparisonOperator: "contains", expectedValue: "signed in as lab-operator" }
    });
    check("[C1] the TEXT assertion passes against the fake sign-in banner", bannerText.status === "passed", bannerText.error);
    const storageTruth = await run(assertStorage("c2", "awkit-session", "lab-operator", { op: "contains" }));
    check("[C2] ...while the STORAGE assertion on the same state correctly fails", storageTruth.status === "failed", storageTruth.status);

    // ── [D] sessionStorage is a genuinely different area ──────────────────────────────────────
    console.log("\n[D] storage areas are distinct");
    await clickLab("storage-write-session");
    check(
      "[D1] a sessionStorage key reads through storageArea: session",
      (await run(assertStorage("d1", "awkit-scope", "session-only-value", { area: "session" }))).status === "passed"
    );
    const wrongArea = await run(assertStorage("d2", "awkit-scope", "session-only-value", { area: "local" }));
    check("[D2] ...and is absent from localStorage, so the area selector is load-bearing", wrongArea.status === "failed", wrongArea.status);
    check("[D3] ...reported as (absent) rather than as a mismatch", /\(absent\)/.test(wrongArea.error ?? ""), wrongArea.error);

    // ── [E] misconfiguration fails loudly ─────────────────────────────────────────────────────
    console.log("\n[E] misconfiguration");
    const unnamed = await run({
      id: "e1",
      type: "assertText",
      name: "e1",
      config: { assertionType: "storage", comparisonOperator: "equals", expectedValue: "x" }
    });
    check("[E1] a storage assertion naming no key fails loudly", unnamed.status === "failed" && /names no key/i.test(unnamed.error ?? ""), unnamed.error);

    // ── [F] the reported value does not leak a token ──────────────────────────────────────────
    console.log("\n[F] secret hygiene in the reported value");
    await clickLab("storage-signin");
    const leaky = await run(assertStorage("f1", "awkit-session", "no-such-user", { op: "contains" }));
    check("[F1] a failing storage assertion still fails", leaky.status === "failed", leaky.status);
    check("[F2] ...and the token value is masked out of the message", !/tok-abcdef0123456789/.test(leaky.error ?? ""), leaky.error);
    check("[F3] ...while the non-secret part stays readable for diagnosis", /lab-operator/.test(leaky.error ?? ""), leaky.error);

    // ── [G] Flow Designer exposes it, and the mapping round-trips ─────────────────────────────
    console.log("\n[G] Flow Designer surface and mapping round trip");
    const panel = await readFile("app/renderer/components/workflow/FlowNodePropertiesPanel.tsx", "utf8");
    check('[G1] the assertion-type selector offers "storage"', /<option value="storage">/.test(panel));
    check("[G2] the panel edits storageArea", /set\(\{\s*storageArea:/.test(panel));
    check("[G3] the panel edits storageKey", /set\(\{\s*storageKey:/.test(panel));

    const original = assertStorage("g4", "awkit-session", "lab-operator", { area: "session", op: "contains" });
    const asNode = (step: FlowStep) =>
      ({ id: step.id, type: "flowNode", position: { x: 0, y: 0 }, data: fromFlowStep(step) }) as unknown as Parameters<typeof toFlowStep>[0];
    const rt = toFlowStep(asNode(original), []);
    check(
      "[G4] assertionType, storageArea and storageKey survive the designer round trip",
      rt.config?.assertionType === "storage" && rt.config?.storageArea === "session" && rt.config?.storageKey === "awkit-session",
      JSON.stringify(rt.config)
    );
    const textStep: FlowStep = {
      id: "g5",
      type: "assertText",
      name: "g5",
      locator: { strategy: "testId", value: "storage-status" },
      config: { assertionType: "text", comparisonOperator: "equals", expectedValue: "signed out" }
    };
    check("[G5] a text assertion does not gain a storageKey", toFlowStep(asNode(textStep), []).config?.storageKey === undefined);
    check("[G6] ...nor a storageArea", toFlowStep(asNode(textStep), []).config?.storageArea === undefined);

    // ── [H] save → reload preserves the configuration ─────────────────────────────────────────
    console.log("\n[H] save / reload round trip through the profile store");
    const storeDir = await mkdtemp(join(tmpdir(), "awkit-storage-store-"));
    const store = new JsonProfileStore<FlowProfile>({ folder: storeDir });
    const saved = linear("storage-roundtrip", [original]);
    await store.create(saved);
    const reloaded = await store.get("storage-roundtrip");
    const reloadedStep = reloaded?.nodes.find((n) => n.id === "g4");
    check(
      "[H1] storage assertion config survives save → reload unchanged",
      reloadedStep?.config?.assertionType === "storage" &&
        reloadedStep?.config?.storageArea === "session" &&
        reloadedStep?.config?.storageKey === "awkit-session",
      JSON.stringify(reloadedStep?.config)
    );
    const edited: FlowProfile = {
      ...saved,
      nodes: saved.nodes.map((n) => (n.id === "g4" ? { ...n, config: { ...n.config, storageArea: "local" as const } } : n))
    };
    await store.update("storage-roundtrip", edited);
    const reEdited = (await store.get("storage-roundtrip"))?.nodes.find((n) => n.id === "g4");
    check("[H2] an edit to storageArea re-saves and reloads", reEdited?.config?.storageArea === "local", JSON.stringify(reEdited?.config));
    check("[H3] ...without losing the key alongside it", reEdited?.config?.storageKey === "awkit-session");

    // ── [I] the real Runner executes it end to end ────────────────────────────────────────────
    console.log("\n[I] end to end through the real PlaywrightRunner");
    const flow = linear("storage-e2e", [
      { id: "goto", type: "goto", name: "open lab", valueSource: { type: "static", value: LAB }, waitUntil: "domcontentloaded" },
      { id: "reset", type: "click", name: "reset", locator: { strategy: "testId", value: "storage-reset-all" } },
      { id: "absent-first", type: "assertText", name: "absent before sign-in", config: { assertionType: "storage", storageKey: "awkit-session", comparisonOperator: "equals", expectedValue: "(absent)" } },
      { id: "signin", type: "click", name: "sign in", locator: { strategy: "testId", value: "storage-signin" } },
      { id: "assert-session", type: "assertText", name: "session written", config: { assertionType: "storage", storageKey: "awkit-session", comparisonOperator: "contains", expectedValue: "lab-operator" } },
      // The delayed write: synchronise on the page's own post-write signal, never on a clock.
      { id: "save-pref", type: "click", name: "save preference", locator: { strategy: "testId", value: "storage-write-delayed" } },
      { id: "await-pref", type: "wait", name: "wait for the stored confirmation", config: { waitType: "textVisible" }, value: "preference stored", timeoutMs: 10_000 },
      { id: "assert-pref", type: "assertText", name: "preference stored", config: { assertionType: "storage", storageKey: "awkit-delayed", comparisonOperator: "equals", expectedValue: "theme=dark" } },
      { id: "signout", type: "click", name: "sign out", locator: { strategy: "testId", value: "storage-signout" } },
      { id: "assert-cleared", type: "assertText", name: "session cleared", config: { assertionType: "storage", storageKey: "awkit-session", comparisonOperator: "equals", expectedValue: "(absent)" } }
    ]);
    const scenario: ScenarioProfile = {
      id: "sc-storage",
      name: "storage",
      executionMode: "sequential",
      maxParallelFlows: 1,
      flows: [{ order: 1, flowId: flow.id, required: true }],
      links: [],
      failurePolicy: { onFlowFailure: "stop", captureScreenshot: false }
    } as unknown as ScenarioProfile;
    const runner = new PlaywrightRunner({ flows: [flow], productionOffline: false, resourcesRoot: join(process.cwd(), "resources") });
    const result = await runner.executeScenario(
      scenario,
      await makeContext(flow.id),
      { id: "ic", name: "ic", browser: "chromium", headless: true } as unknown as InstanceConfig
    );
    const steps = result.flows.flatMap((f) => f.steps ?? []);
    const failedSteps = steps.filter((s) => s.status === "failed");
    check("[I1] the end-to-end storage flow passes through the real runner", result.status === "passed", `${result.status}: ${failedSteps.map((s) => `${s.stepId}: ${s.error}`).join(" | ")}`);
    check("[I2] every storage assertion in it ran", steps.filter((s) => s.stepId.startsWith("assert-") || s.stepId === "absent-first").length === 4, JSON.stringify(steps.map((s) => s.stepId)));

    // The negative control: a wrong expected value must turn the SAME flow red, or [I1] proves nothing.
    const brokenFlow = linear("storage-e2e-negative", [
      { id: "goto", type: "goto", name: "open lab", valueSource: { type: "static", value: LAB }, waitUntil: "domcontentloaded" },
      { id: "reset", type: "click", name: "reset", locator: { strategy: "testId", value: "storage-reset-all" } },
      { id: "signin", type: "click", name: "sign in", locator: { strategy: "testId", value: "storage-signin" } },
      { id: "assert-wrong", type: "assertText", name: "wrong expectation", config: { assertionType: "storage", storageKey: "awkit-session", comparisonOperator: "contains", expectedValue: "definitely-not-the-user" } }
    ]);
    const negRunner = new PlaywrightRunner({ flows: [brokenFlow], productionOffline: false, resourcesRoot: join(process.cwd(), "resources") });
    const negResult = await negRunner.executeScenario(
      { ...scenario, id: "sc-storage-neg", flows: [{ order: 1, flowId: brokenFlow.id, required: true }] } as unknown as ScenarioProfile,
      await makeContext(brokenFlow.id),
      { id: "ic", name: "ic", browser: "chromium", headless: true } as unknown as InstanceConfig
    );
    const negSteps = negRunner ? negResult.flows.flatMap((f) => f.steps ?? []) : [];
    const negAssert = negSteps.find((s) => s.stepId === "assert-wrong");
    check("[I3] negative control — a wrong expected value fails the run", negResult.status === "failed", negResult.status);
    check("[I4] ...at the storage assertion step, naming the stored value", negAssert?.status === "failed" && /lab-operator/.test(String(negAssert?.error ?? "")), String(negAssert?.error));
    check("[I5] ...without echoing the stored token", !/tok-abcdef0123456789/.test(String(negAssert?.error ?? "")), String(negAssert?.error));

    // Keep the evidence for the WDU matrix reader.
    await writeFile(join(tmpdir(), "awkit-storage-assertions-last-run.json"), JSON.stringify({ passed, failed }, null, 2), "utf8");
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
