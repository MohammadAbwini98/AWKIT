import { applyLicenseRunGatePolicy } from "@src/licensing/RunGatePolicy";
import { LicenseStatus, OPERABLE_STATUSES } from "@src/licensing/LicenseTypes";
import { AuthorizationService } from "@src/security/authz/AuthorizationService";
import {
  ALL_PERMISSIONS,
  ROLE_IDS,
  effectivePermissions,
  type Permission
} from "@src/security/authz/Permissions";
import { SecurityError } from "@src/security/errors/ReasonCodes";
import type { SessionManager } from "@src/security/session/SessionManager";
import type { SecurityStore } from "@src/security/store/SecurityStore";
import type { UserRecord } from "@src/security/store/SecurityStoreSchema";
import { SeededRandom } from "@src/testing/random/SeededRandom";

export type LifecycleAuthState = "active-session" | "missing-session" | "expired-session" | "disabled-user";
export type LifecycleAuthzExpectation = "grant" | "deny";

export interface LifecycleScenario {
  readonly id: string;
  readonly authState: LifecycleAuthState;
  readonly authzExpectation: LifecycleAuthzExpectation;
  readonly roles: readonly string[];
  readonly permission: Permission;
  readonly licenseStatus: LicenseStatus;
  readonly licenseEnforcementEnabled: boolean;
}

export interface LifecycleScenarioResult {
  readonly scenario: LifecycleScenario;
  readonly expected: {
    readonly authorizationAllowed: boolean;
    readonly licenseAllowed: boolean;
    readonly runAllowed: boolean;
  };
  readonly actual: {
    readonly authorizationAllowed: boolean;
    readonly authorizationReason?: string;
    readonly licenseAllowed: boolean;
    readonly blockedByLicense: boolean;
    readonly runAllowed: boolean;
  };
  readonly invariantFailures: readonly string[];
}

const AUTH_STATES: readonly LifecycleAuthState[] = [
  "active-session",
  "missing-session",
  "expired-session",
  "disabled-user"
];
const AUTHZ_EXPECTATIONS: readonly LifecycleAuthzExpectation[] = ["grant", "deny"];
const LICENSE_STATUSES = Object.values(LicenseStatus);

function roleSubsets(): readonly string[][] {
  const subsets: string[][] = [];
  for (let mask = 0; mask < 1 << ROLE_IDS.length; mask += 1) {
    subsets.push(ROLE_IDS.filter((_, index) => (mask & (1 << index)) !== 0));
  }
  return subsets;
}

function permissionAssignment(
  random: SeededRandom,
  expectation: LifecycleAuthzExpectation
): { roles: readonly string[]; permission: Permission } {
  const candidates = roleSubsets()
    .map((roles) => {
      const permissions = effectivePermissions({ roles });
      const eligible =
        expectation === "grant"
          ? ALL_PERMISSIONS.filter((permission) => permissions.has(permission))
          : ALL_PERMISSIONS.filter((permission) => !permissions.has(permission));
      return { roles, eligible };
    })
    .filter((candidate) => candidate.eligible.length > 0);
  const selected = random.pick(candidates);
  const roles = random.bool(0.2) ? [...selected.roles, "UnknownRole"] : selected.roles;
  return { roles: random.shuffle(roles), permission: random.pick(selected.eligible) };
}

/**
 * Generate the complete auth × authz × license × enforcement matrix. Randomness changes the role
 * subset and permission used to exercise each cell, while the matrix itself never has coverage holes.
 */
export function generateLifecycleCampaign(seed: string): readonly LifecycleScenario[] {
  const root = new SeededRandom(seed);
  const scenarios: LifecycleScenario[] = [];
  for (const authState of AUTH_STATES) {
    for (const authzExpectation of AUTHZ_EXPECTATIONS) {
      for (const licenseStatus of LICENSE_STATUSES) {
        for (const licenseEnforcementEnabled of [false, true]) {
          const id = [
            authState,
            authzExpectation,
            licenseStatus,
            licenseEnforcementEnabled ? "enforced" : "advisory"
          ].join(":");
          const assignment = permissionAssignment(root.derive(id), authzExpectation);
          scenarios.push({
            id,
            authState,
            authzExpectation,
            roles: assignment.roles,
            permission: assignment.permission,
            licenseStatus,
            licenseEnforcementEnabled
          });
        }
      }
    }
  }
  return scenarios;
}

function userFor(scenario: LifecycleScenario): UserRecord {
  const now = "2026-07-29T00:00:00.000Z";
  return {
    id: "lifecycle-user",
    username: "lifecycle-user",
    usernameNorm: "lifecycle-user",
    displayName: "Lifecycle User",
    status: scenario.authState === "disabled-user" ? "disabled" : "active",
    passwordSecret: "",
    passwordAlgo: "test-only",
    mustChangePassword: false,
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: now,
    passwordChangedAt: now,
    isProtectedSuperUser: false,
    roles: [...scenario.roles],
    createdAt: now,
    createdBy: "random-test-lab",
    updatedAt: now,
    updatedBy: "random-test-lab"
  };
}

async function evaluateAuthorization(
  scenario: LifecycleScenario
): Promise<{ allowed: boolean; reason?: string }> {
  const user = userFor(scenario);
  // Every store method `AuthorizationService.effectivePermissions` reaches for must exist here.
  // `listCustomRoles` / `getUserPermissionOverrides` arrived with RBAC v2 (2026-07-29); because this
  // stub is cast through `unknown`, their absence type-checked cleanly and instead surfaced at run
  // time as a TypeError, which the campaign recorded as an "UNKNOWN" authorization denial — i.e. the
  // suite failed for a harness reason while looking like a product failure. The cast is the hazard:
  // when AuthorizationService grows another store call, add it here too.
  const store = {
    getUserById: (userId: string) => (userId === user.id ? user : undefined),
    listCustomRoles: () => [],
    getUserPermissionOverrides: () => ({ grants: [], denies: [] })
  } as unknown as SecurityStore;
  const sessions = {
    validate: async () =>
      scenario.authState === "active-session" || scenario.authState === "disabled-user"
        ? { valid: true as const, userId: user.id }
        : { valid: false as const, reason: "SESSION_EXPIRED" }
  } as unknown as SessionManager;
  const authorization = new AuthorizationService(store, sessions);
  try {
    await authorization.requirePermission("lifecycle-session", scenario.permission);
    return { allowed: true };
  } catch (error) {
    return {
      allowed: false,
      ...(error instanceof SecurityError ? { reason: error.reason } : { reason: "UNKNOWN" })
    };
  }
}

export async function evaluateLifecycleScenario(
  scenario: LifecycleScenario
): Promise<LifecycleScenarioResult> {
  const expectedAuthorizationAllowed =
    scenario.authState === "active-session" && scenario.authzExpectation === "grant";
  const authorization = await evaluateAuthorization(scenario);
  // No grace is supplied: the campaign's cells assert the licensed/unlicensed table itself. The
  // migration window has its own deterministic scenario (verify:licensing) so it can never quietly
  // widen the expectation here.
  const license = applyLicenseRunGatePolicy(
    { status: scenario.licenseStatus, operable: OPERABLE_STATUSES.has(scenario.licenseStatus) },
    scenario.licenseEnforcementEnabled
  );
  const expectedLicenseAllowed =
    !scenario.licenseEnforcementEnabled || OPERABLE_STATUSES.has(scenario.licenseStatus);
  const expectedRunAllowed = expectedAuthorizationAllowed && expectedLicenseAllowed;
  const actualRunAllowed = authorization.allowed && license.allowed;
  const invariantFailures: string[] = [];
  if (authorization.allowed !== expectedAuthorizationAllowed) {
    invariantFailures.push("authorization decision did not match the generated auth/authz cell");
  }
  if (license.allowed !== expectedLicenseAllowed) {
    invariantFailures.push("license decision did not match the generated license/enforcement cell");
  }
  if (actualRunAllowed !== expectedRunAllowed) {
    invariantFailures.push("combined run decision did not fail closed across both gates");
  }
  return {
    scenario,
    expected: {
      authorizationAllowed: expectedAuthorizationAllowed,
      licenseAllowed: expectedLicenseAllowed,
      runAllowed: expectedRunAllowed
    },
    actual: {
      authorizationAllowed: authorization.allowed,
      ...(authorization.reason ? { authorizationReason: authorization.reason } : {}),
      licenseAllowed: license.allowed,
      blockedByLicense: license.blockedByLicense,
      runAllowed: actualRunAllowed
    },
    invariantFailures
  };
}

export async function runLifecycleCampaign(seed: string): Promise<readonly LifecycleScenarioResult[]> {
  return Promise.all(generateLifecycleCampaign(seed).map((scenario) => evaluateLifecycleScenario(scenario)));
}
