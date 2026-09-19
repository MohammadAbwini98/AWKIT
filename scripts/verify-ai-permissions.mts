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

import { readFile } from "node:fs/promises";

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

console.log("\nEvery AI channel is gated in main, and the preload exposes exactly those channels:\n");
{
  // The expected gate per channel, restated here: [permissions asserted, requires re-authentication].
  const EXPECTED_CHANNELS: Record<string, [string[], boolean]> = {
    "ai:getStatus": [["AI_USE"], false],
    "ai:getSettings": [["AI_MANAGE"], false],
    "ai:updateSettings": [["AI_MANAGE"], true],
    "ai:restoreFeature": [["AI_MANAGE"], true],
    "ai:getDiagnostics": [["AI_AUDIT_VIEW"], false],
    "ai:listAudit": [["AI_AUDIT_VIEW"], false],
    "ai:revert": [["AI_AUDIT_VIEW", "WORKFLOW_EDIT"], false],
    // L3 §6: reading a flow's AI locator state needs the AI surface and sight of the flow; applying a
    // promotion writes a saved flow; declaring editor state is gated on the permission an editor has.
    "ai:listUpgrades": [["AI_USE", "WORKFLOW_VIEW"], false],
    "ai:promoteUpgrade": [["AI_USE", "WORKFLOW_EDIT"], false],
    "ai:setEditorState": [["WORKFLOW_EDIT"], false],
    "ai:importModelPack": [["AI_MANAGE"], true],
    "ai:removeModelPack": [["AI_MANAGE"], true]
  };
  const source = await readFile("app/main/ipc/ai.ipc.ts", "utf8");
  // One block per handler: from its `ipcMain.handle("ai:…"` to the next one.
  const blocks = source.split(/ipcMain\.handle\(/).slice(1).map((block) => ({ channel: /^"([^"]+)"/.exec(block)?.[1] ?? "", body: block }));
  const channels = blocks.map((b) => b.channel).sort();
  check("the handler file registers exactly the expected channels", channels.join() === Object.keys(EXPECTED_CHANNELS).sort().join(), channels.join());
  for (const { channel, body } of blocks) {
    const expected = EXPECTED_CHANNELS[channel];
    if (!expected) continue;
    const asserted = [...body.matchAll(/Permission\.([A-Z_]+)/g)].map((m) => m[1]).sort();
    check(`${channel} asserts ${expected[0].join(" + ")}`, asserted.join() === [...expected[0]].sort().join(), asserted.join());
    const sensitive = /authorize\(event, Permission\.[A-Z_]+, true\)/.test(body);
    check(`${channel} ${expected[1] ? "requires" : "does not require"} re-authentication`, sensitive === expected[1]);
    const gate = body.search(/assertSenderPermission|authorize\(/);
    const action = body.search(
      /aiStatusView|aiSettingsView|updateAiSettings|restoreAiFeature|aiDiagnosticsView|aiAuditView|revertAiActionFromAudit|flowLocatorUpgrades|promoteFlowLocatorUpgrade|setFlowEditorState|importAiModelPack|removeAiModelPack|showOpenDialog/
    );
    check(`${channel} authorizes before doing anything else`, gate >= 0 && action > gate, `gate@${gate} action@${action}`);
  }

  const preload = await readFile("app/main/preload.ts", "utf8");
  const aiBlock = /\n  ai: \{([^]*?)\n  \},/.exec(preload)?.[1] ?? "";
  const exposed = [...aiBlock.matchAll(/invoke\("(ai:[A-Za-z]+)"/g)].map((m) => m[1]).sort();
  check("the preload has an ai namespace to inspect", aiBlock.length > 0);
  check("the preload exposes exactly the gated channels", exposed.join() === Object.keys(EXPECTED_CHANNELS).sort().join(), exposed.join());
  const everyAiInvoke = [...preload.matchAll(/invoke\("(ai:[A-Za-z]+)"/g)].map((m) => m[1]);
  check("no ai channel is invoked outside that namespace", everyAiInvoke.length === exposed.length, everyAiInvoke.join());
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
