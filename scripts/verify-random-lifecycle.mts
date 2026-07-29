import {
  evaluateLifecycleScenario,
  generateLifecycleCampaign,
  runLifecycleCampaign
} from "../src/testing/lifecycle/LifecycleCampaign";
import { LicenseStatus, OPERABLE_STATUSES } from "../src/licensing/LicenseTypes";
import { effectivePermissions } from "../src/security/authz/Permissions";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}`);
  }
}

const seed = "phase-8-lifecycle-verification";
const scenarios = generateLifecycleCampaign(seed);
const repeated = generateLifecycleCampaign(seed);
const alternate = generateLifecycleCampaign(`${seed}-alternate`);
const results = await runLifecycleCampaign(seed);
const statuses = Object.values(LicenseStatus);
const expectedCount = 4 * 2 * statuses.length * 2;

check("campaign is byte-deterministic for the same seed", JSON.stringify(scenarios) === JSON.stringify(repeated));
check("a different seed changes randomized role/permission assignments", JSON.stringify(scenarios) !== JSON.stringify(alternate));
check(`complete matrix contains ${expectedCount} scenarios`, scenarios.length === expectedCount);
check(
  "every auth × authz × license × enforcement cell appears exactly once",
  new Set(
    scenarios.map((scenario) =>
      [scenario.authState, scenario.authzExpectation, scenario.licenseStatus, scenario.licenseEnforcementEnabled].join("|")
    )
  ).size === expectedCount
);
check("every license status participates", statuses.every((status) => scenarios.some((scenario) => scenario.licenseStatus === status)));
check("role assignment is genuinely varied", new Set(scenarios.map((scenario) => [...scenario.roles].sort().join(","))).size >= 8);
check(
  "generated grant/deny labels match the real role-permission registry",
  scenarios.every((scenario) => {
    const granted = effectivePermissions({ roles: scenario.roles }).has(scenario.permission);
    return granted === (scenario.authzExpectation === "grant");
  })
);
check("every scenario was evaluated", results.length === scenarios.length);
check("all actual decisions match their generated matrix cells", results.every((result) => result.invariantFailures.length === 0));
check(
  "missing, expired, and disabled authentication states always fail closed",
  results.filter((result) => result.scenario.authState !== "active-session").every((result) => !result.actual.runAllowed)
);
check(
  "advisory licensing never blocks an otherwise-authorized run",
  results
    .filter(
      (result) =>
        !result.scenario.licenseEnforcementEnabled &&
        result.scenario.authState === "active-session" &&
        result.scenario.authzExpectation === "grant"
    )
    .every((result) => result.actual.runAllowed && !result.actual.blockedByLicense)
);
check(
  "enforced licensing allows only operable statuses after auth/authz pass",
  results
    .filter(
      (result) =>
        result.scenario.licenseEnforcementEnabled &&
        result.scenario.authState === "active-session" &&
        result.scenario.authzExpectation === "grant"
    )
    .every(
      (result) =>
        result.actual.runAllowed === OPERABLE_STATUSES.has(result.scenario.licenseStatus) &&
        result.actual.blockedByLicense === !OPERABLE_STATUSES.has(result.scenario.licenseStatus)
    )
);

const validScenario = scenarios.find(
  (scenario) => scenario.authState === "active-session" && scenario.authzExpectation === "grant"
)!;
const tampered = await evaluateLifecycleScenario({ ...validScenario, roles: [] });
check("a corrupted generated expectation is surfaced as an invariant failure", tampered.invariantFailures.length > 0);

console.log(`\nrandom lifecycle: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
