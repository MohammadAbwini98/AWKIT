/**
 * Validation IPC (Stage 2c): Legacy Compatibility status, the inventory scan, and the
 * suggested-fix migration ceremony.
 *
 * Read channels are ungated (the renderer already reads flows). Every channel that WRITES —
 * running a scan, applying fixes, undoing a migration — requires `WORKFLOW_EDIT`, because each
 * mutates stored flows or the compatibility record that governs whether they may run.
 */
import { ipcMain } from "electron";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import { validateFlowDefinition } from "@src/validation/FlowValidator";
import { effectiveVerdict, type CompatibilityGrant } from "@src/validation/LegacyCompatibility";
import { sha256FlowDigest } from "../validation/contentDigest";
import { availableSafeFixes } from "@src/validation/SafeFixApplier";
import { Permission } from "@src/security/authz/Permissions";
import { assertSenderPermission } from "../security/sessionContext";
import { createFlowProfileStore } from "../profileStores";
import { getFlowValidationService, } from "../validation";
import { FLOW_VALIDATION_META } from "../validation/flowValidationService";

/** Everything a surface needs to render one flow's validation state. All derived, never stored. */
export interface FlowValidationStatusDto {
  flowId: string;
  issues: ReturnType<typeof validateFlowDefinition>["issues"];
  errorCount: number;
  warningCount: number;
  blockingCount: number;
  /** Derived: would the run gate accept this flow right now? */
  runnable: boolean;
  /** True when a valid grant is actively tolerating off-path errors. */
  underCompatibility: boolean;
  standing: ReturnType<typeof effectiveVerdict>["standing"];
  compatibilityExpiresAt?: string;
  toleratedCount: number;
  safeFixCount: number;
}

export function registerValidationIpc(): void {
  const flowStore = createFlowProfileStore();

  const statusFor = async (flows: FlowProfile[], grants: Map<string, CompatibilityGrant>): Promise<FlowValidationStatusDto[]> => {
    const referenceableFlowIds = new Set(flows.map((flow) => flow.id));
    const now = new Date().toISOString();
    return flows.map((flow) => {
      const report = validateFlowDefinition(flow, { referenceableFlowIds });
      const grant = grants.get(flow.id);
      const verdict = effectiveVerdict(report, grant, sha256FlowDigest(flow), now);
      const dto: FlowValidationStatusDto = {
        flowId: flow.id,
        issues: report.issues,
        errorCount: report.issues.filter((issue) => issue.severity === "error").length,
        warningCount: report.issues.filter((issue) => issue.severity === "warning").length,
        blockingCount: verdict.blockingIssues.length,
        runnable: !verdict.blocked,
        underCompatibility: verdict.underCompatibility,
        standing: verdict.standing,
        toleratedCount: verdict.toleratedIssues.length,
        safeFixCount: availableSafeFixes(report.issues).length
      };
      if (verdict.underCompatibility && grant) dto.compatibilityExpiresAt = grant.expiresAt;
      return dto;
    });
  };

  /** Derived status for every saved flow — the Flow Library's source of truth. */
  ipcMain.handle("validation:statusAll", async () => {
    const service = getFlowValidationService();
    return statusFor(await flowStore.list(), await service.grantsMap());
  });

  /** Derived status for one flow — the designer's validate-on-load banner. */
  ipcMain.handle("validation:status", async (_, flowId: string) => {
    const service = getFlowValidationService();
    const flows = await flowStore.list();
    const flow = flows.find((candidate) => candidate.id === flowId);
    if (!flow) return null;
    return (await statusFor([flow], await service.grantsMap()))[0] ?? null;
  });

  ipcMain.handle("validation:meta", async () => FLOW_VALIDATION_META);
  ipcMain.handle("validation:grants", async () => getFlowValidationService().grants());
  ipcMain.handle("validation:latestScan", async () => getFlowValidationService().latestScan());

  ipcMain.handle("validation:runInventoryScan", async (event) => {
    await assertSenderPermission(event, Permission.WORKFLOW_EDIT);
    return getFlowValidationService().runInventoryScan();
  });

  /** Change preview — reports what "Fix all safe issues" WOULD do. Writes nothing. */
  ipcMain.handle("validation:previewSafeFixes", async (_, flowId: string) => getFlowValidationService().previewSafeFixes(flowId));

  /**
   * Apply the previewed fixes. The renderer must have shown the preview and taken an explicit
   * confirmation first; this handler still writes the untouched backup and migration report itself,
   * so the audit trail exists regardless of which caller invoked it.
   */
  ipcMain.handle("validation:applySafeFixes", async (event, flowId: string) => {
    await assertSenderPermission(event, Permission.WORKFLOW_EDIT);
    return getFlowValidationService().applySafeFixesToFlow(flowId);
  });

  ipcMain.handle("validation:undoMigration", async (event, flowId: string, migrationId: string) => {
    await assertSenderPermission(event, Permission.WORKFLOW_EDIT);
    return getFlowValidationService().undoMigration(flowId, migrationId);
  });

  ipcMain.handle("validation:migrations", async (_, flowId: string) => getFlowValidationService().migrationsForFlow(flowId));
}
