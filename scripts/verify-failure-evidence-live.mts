/**
 * Real file-output verifier — failure evidence on disk (SRS-BAO-001 FR-B2).
 *
 * Verifier class: **Real browser**. Launches real Chromium against a tiny local HTTP server, builds a
 * real `StepExecutor`, and calls `captureFailureEvidence` to prove the ACTUAL on-disk behaviour the
 * unit verifier (`verify:failure-evidence`) cannot: files are really written; filenames carry safe
 * encoded attempt/page identifiers; every path stays inside the evidence root; registered literal
 * secrets and query-string tokens are masked out of the DOM / a11y / meta files; a resolver failure
 * reports the ACTUAL captured page identity (never claims a popup when it was main); and a capture
 * against a dead page degrades to secondary-diagnostic notes without throwing.
 *
 * (The retry-then-success evidence-preservation contract is proven deterministically at the
 * FlowExecutor level in `verify:failure-evidence`.)
 *
 * Run: npx tsx scripts/verify-failure-evidence-live.mts
 */
import { chromium, type Browser, type Page } from "playwright";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { StepExecutor } from "@src/runner/StepExecutor";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { ValueResolver } from "@src/runner/ValueResolver";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";
import type { StepEvidenceRef } from "@src/runner/RunnerResult";
import type { FlowStep } from "@src/profiles/FlowProfile";
import { registerSecretValues } from "@src/reports/SecretMasker";
import { isPathInside } from "@src/utils/pathSafety";

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const LITERAL_SECRET = "SUPERSECRET_LITERAL_ABC123XYZ";
const URL_TOKEN = "TOKENSECRET999VALUE";
const URL_PASSWORD = "hunter2-long-password-value";

function contextFor(root: string, ids: { executionId: string; instanceId: string; flowId: string }): InstanceExecutionContext {
  return {
    executionId: ids.executionId,
    instanceId: ids.instanceId,
    scenarioId: "scenario-1",
    flowId: ids.flowId,
    instanceOrderNumber: 1,
    totalInstances: 1,
    runtimeInputs: {},
    instanceInputs: {},
    flowOutputs: {},
    paths: { downloads: root, screenshots: root, logs: root, reports: root }
  };
}

function executorFor(page: Page, context: InstanceExecutionContext): StepExecutor {
  return new StepExecutor(page, new LocatorFactory(page), new ValueResolver(context), context);
}

async function main(): Promise<void> {
  console.log("Failure evidence — real file output (FR-B2)\n");
  registerSecretValues([LITERAL_SECRET]);

  const html = `<!doctype html><html><head><title>Login</title></head><body>
    <h1>Sign in</h1>
    <button aria-label="Login">Continue</button>
    <div id="leak">session literal: ${LITERAL_SECRET}</div>
  </body></html>`;
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const pageUrl = `http://127.0.0.1:${port}/page?token=${URL_TOKEN}&password=${URL_PASSWORD}`;

  let browser: Browser | undefined;
  const tmpRoots: string[] = [];
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(pageUrl, { waitUntil: "domcontentloaded" });

    // ── 1. Happy path: all four evidence files written, safely named, confined, and masked ──────────
    const root1 = await mkdtemp(join(tmpdir(), "awkit-evi-"));
    tmpRoots.push(root1);
    const exec1 = executorFor(page, contextFor(root1, { executionId: "exec-1", instanceId: "inst-1", flowId: "flow-1" }));
    const step1 = { id: "step-1", type: "click", name: "Click login" } as unknown as FlowStep;
    const refs1 = await exec1.captureFailureEvidence(step1, { attempt: 0 });

    const fileRefs = refs1.filter((r) => r.path);
    const kinds = new Set(fileRefs.map((r) => r.kind));
    check("screenshot + dom + a11y + meta files are all produced", ["screenshot", "dom", "a11y", "meta"].every((k) => kinds.has(k as StepEvidenceRef["kind"])), `kinds=${[...kinds].join(",")}`);
    check("every evidence file actually exists on disk", fileRefs.every((r) => r.path !== undefined && existsSync(r.path)));
    check("filenames encode the safe step id + attempt + page id", fileRefs.every((r) => basename(r.path ?? "").startsWith("step-1-a0-main-")), `eg=${basename(fileRefs[0]?.path ?? "")}`);
    check("every evidence path stays inside the evidence root", fileRefs.every((r) => isPathInside(root1, r.path ?? "")));

    const domRef = fileRefs.find((r) => r.kind === "dom");
    const domText = domRef ? await readFile(domRef.path!, "utf8") : "";
    check("the registered literal secret is masked out of the DOM file", domText.length > 0 && !domText.includes(LITERAL_SECRET) && domText.includes("[masked]"));

    const metaRef = fileRefs.find((r) => r.kind === "meta");
    const metaText = metaRef ? await readFile(metaRef.path!, "utf8") : "";
    check("query-string token + password are masked out of the meta file", metaText.length > 0 && !metaText.includes(URL_TOKEN) && !metaText.includes(URL_PASSWORD) && /token=\[masked\]/.test(metaText));

    const a11yRef = fileRefs.find((r) => r.kind === "a11y");
    const a11yText = a11yRef ? await readFile(a11yRef.path!, "utf8") : "";
    check("the a11y snapshot file is written and the literal secret is masked there too", a11yRef !== undefined && !a11yText.includes(LITERAL_SECRET));

    // ── 2. Hostile identifiers must stay confined and separator-free ────────────────────────────────
    const root2 = await mkdtemp(join(tmpdir(), "awkit-evi-"));
    tmpRoots.push(root2);
    const exec2 = executorFor(page, contextFor(root2, { executionId: "../../evil", instanceId: "..\\..\\evil", flowId: "../../../etc" }));
    const step2 = { id: "../../../step\\evil", type: "click", name: "x" } as unknown as FlowStep;
    const refs2 = (await exec2.captureFailureEvidence(step2, { attempt: 0 })).filter((r) => r.path);
    check("hostile execution/flow/step ids still resolve inside the evidence root", refs2.length > 0 && refs2.every((r) => isPathInside(root2, r.path ?? "")));
    check("hostile ids never produce a path-traversal filename", refs2.every((r) => { const b = basename(r.path ?? ""); return !b.includes("..") && !b.includes("/") && !b.includes("\\"); }));

    // ── 3. Page identity: an unavailable popup is labelled as the ACTUAL captured page ─────────────
    const root3 = await mkdtemp(join(tmpdir(), "awkit-evi-"));
    tmpRoots.push(root3);
    const exec3 = executorFor(page, contextFor(root3, { executionId: "exec-3", instanceId: "inst-3", flowId: "flow-3" }));
    const step3 = { id: "step-3", type: "click", name: "x", pageAlias: "popup-1" } as unknown as FlowStep;
    const refs3 = await exec3.captureFailureEvidence(step3, { attempt: 0 });
    const diag = refs3.find((r) => r.note && /unavailable/i.test(r.note));
    check("an unavailable popup alias is recorded as a secondary diagnostic", diag !== undefined && /popup-1/.test(diag?.note ?? ""));
    const files3 = refs3.filter((r) => r.path);
    check("evidence is labelled with the ACTUAL page (main), not the requested popup", files3.length > 0 && files3.every((r) => r.pageId === "main" && r.requestedPageId === "popup-1"));
    check("filenames use the captured page id (main), never the unavailable popup alias", files3.every((r) => { const b = basename(r.path ?? ""); return b.includes("-main-") && !b.includes("popup-1"); }));

    // ── 4. A capture against a dead page yields secondary diagnostics, never a throw ────────────────
    const deadPage = await browser.newPage();
    await deadPage.goto(pageUrl, { waitUntil: "domcontentloaded" });
    const root4 = await mkdtemp(join(tmpdir(), "awkit-evi-"));
    tmpRoots.push(root4);
    const exec4 = executorFor(deadPage, contextFor(root4, { executionId: "exec-4", instanceId: "inst-4", flowId: "flow-4" }));
    await deadPage.close();
    let threw = false;
    let refs4: StepEvidenceRef[] = [];
    try {
      refs4 = await exec4.captureFailureEvidence({ id: "step-4", type: "click", name: "x" } as unknown as FlowStep, { attempt: 0 });
    } catch {
      threw = true;
    }
    check("capturing against a closed page does not throw (B2.6)", threw === false);
    const liveDependent = refs4.filter((r) => r.kind === "screenshot" || r.kind === "dom" || r.kind === "a11y");
    check("a dead-page capture records secondary-diagnostic notes (no file) for every page-dependent capture (B2.5)", liveDependent.length === 3 && liveDependent.every((r) => r.path === undefined && (r.note?.length ?? 0) > 0));
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const root of tmpRoots) await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
