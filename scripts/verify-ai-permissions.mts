/**
 * verify:ai-permissions — Phase L L1.5 permission decisions (src/security/authz/Permissions.ts).
 *
 * Every built-in role is asserted in BOTH directions for every AI permission. `ADMINISTRATOR_PERMISSIONS`
 * is a denylist over `ALL_PERMISSIONS`, so a check that only asserts "Administrator has X" passes while a
 * Super-User-only permission silently leaks, and one that only asserts absence passes while a grant is
 * missing. The permission VALUES are pinned too: they are persisted in custom roles and user overrides,
 * so a rename would orphan stored grants.
 *
 * What makes it fail: any role gaining or losing an AI permission, AI management no longer requiring
 * re-authentication (or AI use starting to), or a renamed permission value.
 *
 * Run: npm run verify:ai-permissions
 */

import {
  ALL_PERMISSIONS,
  BUILTIN_ROLES,
  Permission,
  ROLE_IDS,
  SENSITIVE_PERMISSIONS,
  effectivePermissions,
  isPermission,
  type RoleId
} from "@src/security/authz/Permissions";

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

const AI_PERMISSIONS = [Permission.AI_USE, Permission.AI_MANAGE, Permission.AI_AUDIT_VIEW, Permission.RECORDER_ELEMENT_SPY];

// The owner decision (2026-09-19), restated independently of Permissions.ts.
const EXPECTED: Record<RoleId, readonly string[]> = {
  SuperUser: ["ai.use", "ai.manage", "ai.audit.view", "recorder.elementSpy"],
  Administrator: ["ai.use", "ai.manage", "ai.audit.view", "recorder.elementSpy"],
  Operator: ["ai.use", "recorder.elementSpy"],
  Viewer: [],
  Issuer: []
};

console.log("Permission values are pinned (persisted in roles and overrides):\n");
{
  check("ai.use", Permission.AI_USE === "ai.use");
  check("ai.manage", Permission.AI_MANAGE === "ai.manage");
  check("ai.audit.view", Permission.AI_AUDIT_VIEW === "ai.audit.view");
  check("recorder.elementSpy", Permission.RECORDER_ELEMENT_SPY === "recorder.elementSpy");
  check("all four are registered permissions", AI_PERMISSIONS.every((p) => isPermission(p) && ALL_PERMISSIONS.includes(p)));
}

console.log("\nEvery built-in role, both directions:\n");
{
  check("the five built-in roles are the ones asserted", ROLE_IDS.length === 5 && ROLE_IDS.every((r) => r in EXPECTED), ROLE_IDS.join(","));
  for (const role of ROLE_IDS) {
    const held = new Set<string>(BUILTIN_ROLES[role].permissions);
    for (const permission of AI_PERMISSIONS) {
      const want = EXPECTED[role].includes(permission);
      check(`${role} ${want ? "HAS" : "does NOT have"} ${permission}`, held.has(permission) === want);
    }
  }
  check("Issuer is still exactly its two issuing permissions", BUILTIN_ROLES.Issuer.permissions.length === 2);
}

console.log("\nRe-authentication:\n");
{
  check("AI management requires fresh re-auth", SENSITIVE_PERMISSIONS.has(Permission.AI_MANAGE));
  check("using AI does NOT (it would prompt on every suggestion)", !SENSITIVE_PERMISSIONS.has(Permission.AI_USE));
  check("reading the AI audit log does NOT", !SENSITIVE_PERMISSIONS.has(Permission.AI_AUDIT_VIEW));
  check("the Element Spy does NOT", !SENSITIVE_PERMISSIONS.has(Permission.RECORDER_ELEMENT_SPY));
}

console.log("\nEffective-permission computation:\n");
{
  const protectedSu = effectivePermissions({ roles: [], isProtectedSuperUser: true });
  check("the protected Super User holds every AI permission", AI_PERMISSIONS.every((p) => protectedSu.has(p)));
  const deniedAdmin = effectivePermissions({ roles: ["Administrator"], denies: [Permission.AI_MANAGE] });
  check("a direct deny removes AI management from an Administrator", !deniedAdmin.has(Permission.AI_MANAGE) && deniedAdmin.has(Permission.AI_USE));
  const viewerGrant = effectivePermissions({ roles: ["Viewer"], grants: [Permission.AI_USE, "ai.admin", "ai.*"] });
  check("a direct grant can give a Viewer AI use", viewerGrant.has(Permission.AI_USE));
  check("unknown AI-looking permission strings are ignored", !viewerGrant.has("ai.admin" as never) && !viewerGrant.has("ai.*" as never));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
