/**
 * verify:run-report-compatibility — a run admitted under Legacy Compatibility says so (awkit-vbj).
 *
 * What regression makes this fail?
 *   - the execution report stops carrying `legacyCompatibility`, so a run that only executed because
 *     a flow holds a grant reports `passed` indistinguishably from one that passed the validator
 *     outright (the reported defect: a clean-machine run's reports/*.json contained no `legacy`,
 *     `compatib` or `grant` token at all);
 *   - the block starts appearing on ordinary runs, which would make the attribution meaningless;
 *   - the grant deadline stops being snapshotted, so a report re-read after the grant lapses can no
 *     longer say what was true at admission;
 *   - the chain from the run gate through the run profile to the report is broken at any link.
 *
 * Pure: builds reports through the real `ReportService` with fixture instances. No browser, no
 * Electron, no filesystem run. The wiring that a unit cannot see — admission snapshotting the grant,
 * the profile carrying it, the engine passing it — is covered by source guards at the end.
 *
 * Run: npx tsx scripts/verify-run-report-compatibility.mts
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ReportService } from "@src/reports/ReportService";
import type { InstanceReport } from "@src/reports/ExecutionReport";
import type { ScenarioProfile } from "@src/profiles/ScenarioProfile";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

const scenario = { id: "wf-1", name: "Nightly regression" } as ScenarioProfile;
const instances: InstanceReport[] = [
  { instanceId: "i-1", status: "passed", durationMs: 1200, screenshots: [], downloadedFiles: [] }
];
const baseOptions = {
  executionId: "exec-1",
  runMode: "concurrent" as const,
  maxConcurrentInstances: 1,
  startedAt: "2026-08-03T10:00:00.000Z",
  endedAt: "2026-08-03T10:00:05.000Z",
  runtimeInputs: {}
};

const service = new ReportService(resolve(ROOT, "test-artifacts", "unused-report-dir"));

console.log("A run admitted under a grant is attributed:");
{
  const report = service.createConcurrentRunReport(scenario, instances, {
    ...baseOptions,
    legacyCompatibility: {
      flows: [{ flowId: "flow-offpath", flowName: "Legacy off-path flow", expiresAt: "2026-09-01T00:00:00.000Z" }]
    }
  });
  check("the report still reports the run outcome", report.status === "passed");
  check("the report carries a legacyCompatibility block", !!report.legacyCompatibility, JSON.stringify(report.legacyCompatibility));
  check("it names the admitted flow", report.legacyCompatibility?.flows[0]?.flowId === "flow-offpath");
  check("it carries the flow name a human can read", report.legacyCompatibility?.flows[0]?.flowName === "Legacy off-path flow");
  check(
    "it carries the grant deadline the exemption is buying time against",
    report.legacyCompatibility?.flows[0]?.expiresAt === "2026-09-01T00:00:00.000Z"
  );

  // The reported defect was a TOKEN SCAN over the serialized report, so assert at that level too:
  // a field that exists but does not survive serialization would fix nothing.
  const serialized = JSON.stringify(report);
  check("the serialized report contains a 'compatib' token", /compatib/i.test(serialized));
  check("the serialized report contains a 'legacy' token", /legacy/i.test(serialized));
  check("the serialized report names the flow id", serialized.includes("flow-offpath"));
}

console.log("\nAn ordinary run is NOT attributed (the block's presence is the signal):");
{
  const report = service.createConcurrentRunReport(scenario, instances, baseOptions);
  check("no legacyCompatibility block", report.legacyCompatibility === undefined, JSON.stringify(report.legacyCompatibility));
  const serialized = JSON.stringify(report);
  check("the serialized report has no 'compatib' token", !/compatib/i.test(serialized));
  check("the serialized report has no 'legacy' token", !/legacy/i.test(serialized));
  check("an ordinary run still reports normally", report.status === "passed" && report.executionId === "exec-1");
}

console.log("\nAn empty grant list is not an attribution:");
{
  const report = service.createConcurrentRunReport(scenario, instances, { ...baseOptions, legacyCompatibility: { flows: [] } });
  check(
    "an empty flows list is omitted rather than written as an empty block",
    report.legacyCompatibility === undefined,
    JSON.stringify(report.legacyCompatibility)
  );
}

console.log("\nMultiple admitted flows are all named:");
{
  const report = service.createConcurrentRunReport(scenario, instances, {
    ...baseOptions,
    legacyCompatibility: {
      flows: [
        { flowId: "flow-a", expiresAt: "2026-09-01T00:00:00.000Z" },
        { flowId: "flow-b", expiresAt: "2026-09-02T00:00:00.000Z" }
      ]
    }
  });
  check("both flows are present", report.legacyCompatibility?.flows.length === 2, `${report.legacyCompatibility?.flows.length}`);
  check(
    "each keeps its own deadline",
    report.legacyCompatibility?.flows[0]?.expiresAt !== report.legacyCompatibility?.flows[1]?.expiresAt
  );
}

console.log("\nThe chain from admission to report is wired (source guards):");
{
  const ipcSource = readFileSync(resolve(ROOT, "app/main/ipc/execution.ipc.ts"), "utf8");
  const engineSource = readFileSync(resolve(ROOT, "src/runner/ExecutionEngine.ts"), "utf8");
  const profileSource = readFileSync(resolve(ROOT, "src/instances/ConcurrentRunProfile.ts"), "utf8");
  check("the source guard actually read the run gate", ipcSource.includes("recordRunUnderCompatibility") && ipcSource.length > 5000);

  check("the run profile can carry the attribution", profileSource.includes("legacyCompatibility"));
  check("the engine passes it into the report", /legacyCompatibility:\s*profile\.legacyCompatibility/.test(engineSource));
  // Specific to the attribution snapshot: `grantsMap()` is also called elsewhere in this file, and
  // an unqualified match was satisfied by that unrelated call — a guard passing for the wrong reason.
  check(
    "admission snapshots the grants for the attribution",
    /grantSnapshot\s*=\s*await\s+\w+\.grantsMap\(\)/.test(ipcSource)
  );
  check("admission puts the attribution on the run profile", /legacyCompatibility\s*\}\s*:\s*\{\}\)/.test(ipcSource));

  // Ordering: the snapshot must be taken at admission, not re-derived later. `grantsMap()` is read
  // in the same request that records the run, before the profile is constructed.
  const grantsAt = ipcSource.search(/grantSnapshot\s*=\s*await\s+\w+\.grantsMap\(\)/);
  const profileAt = ipcSource.indexOf("const profile: ConcurrentRunProfile");
  check("the grant snapshot is taken before the run profile is built", grantsAt > 0 && profileAt > grantsAt, `grants@${grantsAt} profile@${profileAt}`);
}

console.log("\nThe attribution ALSO reaches the durable store the Run Detail drawer actually reads (awkit-5dn):");
{
  // awkit-5dn: the JSON report carries legacyCompatibility (proven above), but RunDetailDrawer.tsx
  // reads window.playwrightFlowStudio.telemetry.runDetail, served from the durable SQLite store, not
  // the report file. Prior to this bead the run gate's snapshot never reached that store, so an
  // operator reading the drawer could not tell a run was admitted under a grant. These guards prove
  // the SEPARATE wiring the report-level checks above cannot see.
  const engineSource = readFileSync(resolve(ROOT, "src/runner/ExecutionEngine.ts"), "utf8");
  const schemaSource = readFileSync(resolve(ROOT, "src/runner/store/RuntimeStoreSchema.ts"), "utf8");
  const sqliteStoreSource = readFileSync(resolve(ROOT, "src/runner/store/SqliteRuntimeStore.ts"), "utf8");
  const drawerSource = readFileSync(resolve(ROOT, "app/renderer/components/reports/RunDetailDrawer.tsx"), "utf8");

  check("the durable schema has a migration for the attribution column", /legacyCompatibilityJson/.test(schemaSource));
  check(
    "the engine reads the SAME profile.legacyCompatibility the report uses, at dispatch, not re-derived later",
    /this\.runContexts\.get\(instance\.executionId\)\?\.profile\.legacyCompatibility/.test(engineSource)
  );
  check(
    "the engine's upsertRun call is conditioned on that snapshot actually being present",
    /legacyCompatibility\s*\?\s*\{\s*legacyCompatibilityJson:\s*JSON\.stringify\(legacyCompatibility\)\s*\}\s*:\s*\{\}/.test(engineSource)
  );
  check(
    "the SQL write actually binds the column (not just declares it) — mutation-tested manually by nulling the bind and confirming the telemetry round-trip check fails",
    /legacyCompatibilityJson,\s*updatedAt\)/.test(sqliteStoreSource) && /merged\.legacyCompatibilityJson\s*\?\?\s*null,/.test(sqliteStoreSource)
  );
  check("the drawer parses the durable row's JSON snapshot rather than trusting it blindly", /JSON\.parse\(json\)/.test(drawerSource));
  check("the drawer renders the attribution using the same Legacy Compatibility marker style as Flow Library", /pill-legacy/.test(drawerSource));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
