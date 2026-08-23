/**
 * Deterministic regression for the assertion node's comparison types (`awkit-1ugn`).
 *
 * Focused on the `attribute` assertion, which did not exist before: `assertionType` was
 * visible|text|value|count|url, so an element's ATTRIBUTE could not be asserted at all. WDU AI
 * Playground challenge 21 ("Attribute vs Visual State") exists precisely because a control's
 * visible text can update correctly while `aria-pressed` does not — a text assertion passes
 * straight over that defect, which is what checks [A3]/[A4] below pin down.
 *
 * Runs `StepExecutor` against `page.setContent` fixtures — no mock-site or network needed.
 *
 * MUTATION CONTRACT (measured, not asserted): disabling the `attribute` branch in
 * `executeAssertion` fails 5 of these 12 — [A1], [A2b], [B2], [C1] and [C2]. The survivors are
 * instructive rather than weak: [A2], [B1] and [A4] still fail-as-expected because comparing
 * innerText to an attribute value ALSO mismatches, and [A3], [B3], [D1], [D2] never read an
 * attribute at runtime at all. That is why [A2b] and [B2] assert the exact reported value —
 * they are what separates "failed for the right reason" from "failed anyway".
 *
 * Run with: npx tsx scripts/verify-assertions.mts
 */
import { chromium } from "playwright";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { ValueResolver } from "@src/runner/ValueResolver";
import { StepExecutor } from "@src/runner/StepExecutor";
import { MemoryRunnerLogger } from "@src/runner/RunnerResult";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";
import type { FlowStep } from "@src/profiles/FlowProfile";
import { toFlowStep, fromFlowStep } from "../app/renderer/components/workflow/flowProfileMapping";
import { registerSecretValues } from "@src/reports/SecretMasker";

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

async function makeContext(): Promise<InstanceExecutionContext> {
  const dir = await mkdtemp(join(tmpdir(), "awkit-assert-"));
  return {
    executionId: "e", instanceId: "i", scenarioId: "s", flowId: "f",
    instanceOrderNumber: 1, totalInstances: 1, runtimeInputs: {}, instanceInputs: {}, flowOutputs: {},
    paths: { downloads: join(dir, "d"), screenshots: join(dir, "s"), logs: join(dir, "l"), reports: join(dir, "r"), sessions: join(dir, "se") }
  };
}

// A toggle whose TEXT always updates but whose aria-pressed is deliberately left stale — the exact
// shape of the challenge this capability was added for.
const FIXTURE = `
  <button id="honest" aria-pressed="true" data-kind="primary">Active</button>
  <button id="lying" aria-pressed="false">Active</button>
  <button id="noattr">Plain</button>
  <a id="link" href="/somewhere?x=1">Go</a>
  <input id="blank" value="" data-empty="">
`;

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const ctx = await makeContext();

  async function run(step: FlowStep): Promise<{ status: string; error?: string }> {
    await page.setContent(FIXTURE, { waitUntil: "load" });
    const exec = new StepExecutor(page, new LocatorFactory(page), new ValueResolver(ctx), ctx, undefined, new MemoryRunnerLogger());
    const r = await exec.execute(step);
    return { status: r.status, error: r.error };
  }

  const assertAttr = (id: string, target: string, attribute: string, expected: string, op: "equals" | "contains" = "equals"): FlowStep => ({
    id, type: "assertText", name: id,
    locator: { strategy: "id", value: target },
    config: { assertionType: "attribute", attributeName: attribute, comparisonOperator: op, expectedValue: expected }
  });

  console.log("\n[A] attribute assertion");
  check("[A1] a matching attribute passes", (await run(assertAttr("a1", "honest", "aria-pressed", "true"))).status === "passed");

  const mismatch = await run(assertAttr("a2", "lying", "aria-pressed", "true"));
  check("[A2] a mismatching attribute fails", mismatch.status === "failed", mismatch.status);
  check("[A2b] ...and the error quotes the value actually found", /"false"/.test(mismatch.error ?? ""), mismatch.error);

  // The heart of the challenge: same element, same visible text, opposite verdicts.
  const textOnLiar = await run({
    id: "a3", type: "assertText", name: "a3",
    locator: { strategy: "id", value: "lying" },
    config: { assertionType: "text", comparisonOperator: "equals", expectedValue: "Active" }
  });
  check("[A3] the TEXT assertion passes on the element with the stale attribute", textOnLiar.status === "passed", textOnLiar.error);
  check("[A4] ...while the ATTRIBUTE assertion on that same element fails", mismatch.status === "failed");

  console.log("\n[B] absent vs empty");
  const absent = await run(assertAttr("b1", "noattr", "aria-pressed", "", "equals"));
  check("[B1] an ABSENT attribute does not satisfy an empty expected value", absent.status === "failed", absent.status);
  check("[B2] ...and reports it as (absent), not as an empty string", /\(absent\)/.test(absent.error ?? ""), absent.error);
  check("[B3] a genuinely EMPTY attribute does satisfy an empty expected value", (await run(assertAttr("b4", "blank", "data-empty", ""))).status === "passed");

  console.log("\n[C] operators and misconfiguration");
  check("[C1] contains works against a longer attribute value", (await run(assertAttr("c1", "link", "href", "somewhere", "contains"))).status === "passed");
  const unnamed = await run({
    id: "c2", type: "assertText", name: "c2",
    locator: { strategy: "id", value: "honest" },
    config: { assertionType: "attribute", comparisonOperator: "equals", expectedValue: "true" }
  });
  check("[C2] an attribute assertion naming no attribute fails loudly", unnamed.status === "failed" && /names no attribute/i.test(unnamed.error ?? ""), unnamed.error);

  console.log("\n[D] designer round trip");
  const original = assertAttr("d1", "honest", "aria-pressed", "true");
  const asNode = (step: FlowStep) => ({ id: step.id, type: "flowNode", position: { x: 0, y: 0 }, data: fromFlowStep(step) }) as unknown as Parameters<typeof toFlowStep>[0];
  const rt = toFlowStep(asNode(original), []);
  check("[D1] assertionType and attributeName survive the round trip",
    rt.config?.assertionType === "attribute" && rt.config?.attributeName === "aria-pressed", JSON.stringify(rt.config));
  // A non-attribute assertion must NOT persist an attribute name — otherwise a type change leaves
  // dead config behind that a later reader could act on.
  const textStep: FlowStep = { id: "d2", type: "assertText", name: "d2", locator: { strategy: "id", value: "honest" }, config: { assertionType: "text", comparisonOperator: "equals", expectedValue: "Active" } };
  check("[D2] a text assertion does not gain an attributeName", toFlowStep(asNode(textStep), []).config?.attributeName === undefined);

  console.log("\n[E] secret-backed expectations never leak into failure messages (AWKIT-RUN-011)");
  {
    const SECRET = "S3cret-Token!"; // 13 chars: below the looksLikeSecret heuristic, so ONLY literal registration masks it.
    registerSecretValues([SECRET]);
    const secretCtx = { ...ctx, secrets: { API_TOKEN: SECRET } } as unknown as InstanceExecutionContext;
    await page.setContent(FIXTURE, { waitUntil: "load" });
    const secretExec = new StepExecutor(page, new LocatorFactory(page), new ValueResolver(secretCtx), secretCtx, undefined, new MemoryRunnerLogger());
    const result = await secretExec.execute({
      id: "e1", type: "assertText", name: "secret expectation",
      locator: { strategy: "id", value: "honest" },
      valueSource: { type: "secret", secretName: "API_TOKEN" },
      config: { assertionType: "text", comparisonOperator: "equals", expectedValue: "" }
    });
    check("[E1] a mismatching secret-backed assertion still fails", result.status === "failed", JSON.stringify(result));
    check("[E2] ...and the error does NOT contain the raw resolved secret", !(result.error ?? "").includes(SECRET), result.error);
    check("[E3] ...the expected side is masked in the report", /\[masked\]/.test(result.error ?? ""), result.error);
  }

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
