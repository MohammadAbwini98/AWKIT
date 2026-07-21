/**
 * Flow validation runtime service (Stage 2c): owns the Legacy Compatibility grant store, the
 * inventory scan, and the suggested-fix migration ceremony (backup → apply → report → undo).
 *
 * Deliberately **electron-free** — dependencies (paths, stores, run history) are injected — so
 * `scripts/verify-legacy-compat.mts` drives the real service against temp folders via `tsx`.
 * `validation.ipc.ts` wires the real app dependencies.
 *
 * What this service will never do (owner decision 2): apply a fix without an explicit request,
 * modify a flow on open, delete nodes/connectors, or guess. Every mutation goes through
 * `applySafeFixes`' deterministic schema-migration set, writes an untouched backup FIRST, records
 * a migration report, and can be undone while the flow remains unedited.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import type { WorkflowProfile } from "@src/profiles/WorkflowProfile";
import { isWorkflowFlowNode } from "@src/profiles/WorkflowProfile";
import { validateFlowDefinition, validateFlowSet, errorsOf } from "@src/validation/FlowValidator";
import {
  FLOW_VALIDATOR_VERSION,
  LEGACY_COMPATIBILITY_WINDOW_DAYS,
  classifyForInventory,
  planGrants,
  type CompatibilityGrant,
  type FlowContentDigest,
  type InventoryEntry
} from "@src/validation/LegacyCompatibility";
import { applySafeFixes, availableSafeFixes, type AppliedFix } from "@src/validation/SafeFixApplier";
import { JsonProfileStore, type ProfileStore } from "@src/storage/ProfileStore";
import { sha256FlowDigest } from "./contentDigest";

export interface InventoryScanRecord {
  id: string;
  at: string;
  validatorVersion: number;
  /** Digest algorithm this scan's grants are bound with. */
  digestAlgorithm: "sha256";
  counts: Record<string, number>;
  grantsIssued: number;
  grantsRevokedRepaired: number;
  /** Pre-hardening grants retired because their digest format is no longer trusted. */
  grantsRetiredLegacyDigest: number;
  entries: InventoryEntry[];
}

export interface MigrationRecord {
  id: string;
  flowId: string;
  at: string;
  validatorVersion: number;
  backupPath: string;
  beforeHash: string;
  afterHash: string;
  fixes: AppliedFix[];
  skipped: { issue: string; reason: string }[];
  beforeErrorCount: number;
  afterErrorCount: number;
  undoneAt?: string;
}

export interface FlowValidationServiceDeps {
  /** Root folder for validation metadata (grants, scans, migrations, backups). */
  validationRoot: string;
  flowStore: ProfileStore<FlowProfile>;
  workflowStore: ProfileStore<WorkflowProfile>;
  /**
   * Recent successful runs as `{ scenarioId, endedAt }` rows, newest-first. Optional — without it
   * the `possible-validator-defect` classification simply never triggers (unknown ≠ no).
   */
  recentSuccessfulRuns?: () => { scenarioId?: string; endedAt?: string }[];
  /** Injectable clock for tests. */
  now?: () => string;
  /** Override the content digest (tests only — production always uses SHA-256). */
  digestFor?: FlowContentDigest;
}

export class FlowValidationService {
  private readonly grantStore: JsonProfileStore<CompatibilityGrant>;
  private readonly scanStore: JsonProfileStore<InventoryScanRecord>;
  private readonly migrationStore: JsonProfileStore<MigrationRecord>;
  private readonly backupsDir: string;
  private readonly digestFor: FlowContentDigest;
  /**
   * Single-flight guard. Concurrent run requests all await the SAME scan rather than each starting
   * one: parallel scans would race on the grant store and could issue duplicate grants or clobber
   * each other's audit records. Cleared on settle so a failed scan can be retried.
   */
  private scanInFlight: Promise<InventoryScanRecord> | undefined;
  /** Serializes grant writes within this process, so audit counters cannot be lost to interleaving. */
  private grantWriteChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: FlowValidationServiceDeps) {
    this.grantStore = new JsonProfileStore<CompatibilityGrant>({ folder: join(deps.validationRoot, "legacy-grants") });
    this.scanStore = new JsonProfileStore<InventoryScanRecord>({ folder: join(deps.validationRoot, "inventory-scans") });
    this.migrationStore = new JsonProfileStore<MigrationRecord>({ folder: join(deps.validationRoot, "migrations") });
    this.backupsDir = join(deps.validationRoot, "backups");
    this.digestFor = deps.digestFor ?? sha256FlowDigest;
  }

  private nowIso(): string {
    return this.deps.now?.() ?? new Date().toISOString();
  }

  /** The digest function the run gate must use, so gate and scan always agree. */
  get contentDigest(): FlowContentDigest {
    return this.digestFor;
  }

  /** Run a grant-store mutation exclusively, FIFO. A failure rejects only its own caller. */
  private serializeGrantWrite<T>(task: () => Promise<T>): Promise<T> {
    const result = this.grantWriteChain.then(task, task);
    this.grantWriteChain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  /* ── Inventory scan & grants ─────────────────────────────────────────────── */

  /**
   * Run the inventory scan unless one already exists for the current validator version. The scan
   * is what "enables" enforcement for a validator version: it classifies every flow and issues
   * time-limited grants to the existing off-path-only ones, so tightening validation never
   * silently breaks a flow that was running yesterday.
   */
  async ensureInventoryScan(force = false): Promise<InventoryScanRecord> {
    if (!force) {
      const existing = (await this.scanStore.list())
        .filter((scan) => scan.validatorVersion === FLOW_VALIDATOR_VERSION)
        .sort((a, b) => b.at.localeCompare(a.at))[0];
      if (existing) return existing;
    }
    return this.runInventoryScan();
  }

  /**
   * Classify the library and issue grants. **Single-flight**: overlapping callers (e.g. several run
   * requests arriving together on first launch) await one scan instead of racing to write the same
   * grant records.
   */
  async runInventoryScan(): Promise<InventoryScanRecord> {
    if (this.scanInFlight) return this.scanInFlight;
    const run = this.performInventoryScan().finally(() => {
      this.scanInFlight = undefined;
    });
    this.scanInFlight = run;
    return run;
  }

  private async performInventoryScan(): Promise<InventoryScanRecord> {
    const now = this.nowIso();
    const flows = await this.deps.flowStore.list();
    const flowSet = validateFlowSet(flows);
    const successPredicate = await this.buildSuccessPredicate(flows);

    const entries = flows.map((flow) => {
      const report = flowSet.byFlowId.get(flow.id);
      if (!report) throw new Error(`No validation report for flow ${flow.id}`);
      return classifyForInventory(flow, report, this.digestFor(flow), { ranSuccessfullySinceLastEdit: successPredicate });
    });

    // Grant writes are serialized and re-read inside the lock, so a concurrent
    // `recordRunUnderCompatibility` cannot have its audit counter overwritten by this scan.
    const plan = await this.serializeGrantWrite(async () => {
      const existingGrants = new Map((await this.grantStore.list()).map((grant) => [grant.id, grant]));
      const planned = planGrants(entries, existingGrants, now);
      for (const grant of planned.issue) {
        // Defensive: `create` throws on an existing id, so never overwrite a record we did not plan for.
        if (!existingGrants.has(grant.id)) await this.grantStore.create(grant);
      }
      for (const revoked of [...planned.revokeRepaired, ...planned.revokeLegacyDigest]) {
        await this.grantStore.update(revoked.id, revoked);
      }
      return planned;
    });

    const counts: Record<string, number> = {};
    for (const entry of entries) counts[entry.classification] = (counts[entry.classification] ?? 0) + 1;

    const record: InventoryScanRecord = {
      id: await this.uniqueId(this.scanStore, `scan-v${FLOW_VALIDATOR_VERSION}-${now.replace(/[:.]/g, "-")}`),
      at: now,
      validatorVersion: FLOW_VALIDATOR_VERSION,
      digestAlgorithm: "sha256",
      counts,
      grantsIssued: plan.issue.length,
      grantsRevokedRepaired: plan.revokeRepaired.length,
      grantsRetiredLegacyDigest: plan.revokeLegacyDigest.length,
      entries
    };
    // The scan record is written LAST: if anything above failed, no record exists for this
    // validator version, so `ensureInventoryScan` retries on the next call instead of treating a
    // partial scan as complete.
    return this.scanStore.create(record);
  }

  async latestScan(): Promise<InventoryScanRecord | null> {
    const scans = await this.scanStore.list();
    return scans.sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
  }

  async grants(): Promise<CompatibilityGrant[]> {
    return this.grantStore.list();
  }

  async grantsMap(): Promise<Map<string, CompatibilityGrant>> {
    return new Map((await this.grantStore.list()).map((grant) => [grant.id, grant]));
  }

  /**
   * Audit a real (non-dry-run) execution that proceeded under a grant. Serialized with every other
   * grant write, and re-read inside the lock, so concurrent runs cannot lose an increment.
   */
  async recordRunUnderCompatibility(flowIds: readonly string[]): Promise<void> {
    const now = this.nowIso();
    await this.serializeGrantWrite(async () => {
      for (const flowId of flowIds) {
        const grant = await this.grantStore.get(flowId);
        if (!grant) continue;
        await this.grantStore.update(flowId, { ...grant, runsUnderCompatibility: grant.runsUnderCompatibility + 1, lastRunAt: now });
      }
    });
  }

  /**
   * `possible-validator-defect` predicate: did some workflow whose flow set (direct refs +
   * transitive `runFlow` closure) contains this flow complete a successful run AFTER the flow's
   * last content edit? Uses `updatedAt` as the edit marker; flows without one never qualify —
   * unknown must not manufacture defect reports.
   */
  private async buildSuccessPredicate(flows: FlowProfile[]): Promise<((flowId: string) => boolean) | undefined> {
    const runs = this.deps.recentSuccessfulRuns?.();
    if (!runs || runs.length === 0) return undefined;

    const workflows = await this.deps.workflowStore.list();
    const flowsById = new Map(flows.map((flow) => [flow.id, flow]));

    // workflow id → every flow id it can execute.
    const flowsOfWorkflow = new Map<string, Set<string>>();
    for (const workflow of workflows) {
      const set = new Set<string>();
      const queue = workflow.nodes.filter(isWorkflowFlowNode).map((node) => node.flowId);
      while (queue.length > 0) {
        const id = queue.shift() as string;
        if (set.has(id)) continue;
        set.add(id);
        const flow = flowsById.get(id);
        for (const step of flow?.nodes ?? []) {
          if (step.type !== "runFlow") continue;
          const target = step.flowId ?? step.config?.targetFlowId;
          if (typeof target === "string" && target.trim() !== "" && !set.has(target)) queue.push(target);
        }
      }
      flowsOfWorkflow.set(workflow.id, set);
    }

    // flow id → latest successful end time across workflows that include it.
    const lastSuccess = new Map<string, string>();
    for (const run of runs) {
      if (!run.scenarioId || !run.endedAt) continue;
      for (const flowId of flowsOfWorkflow.get(run.scenarioId) ?? []) {
        const current = lastSuccess.get(flowId);
        if (!current || run.endedAt > current) lastSuccess.set(flowId, run.endedAt);
      }
    }

    return (flowId: string) => {
      const flow = flowsById.get(flowId);
      const success = lastSuccess.get(flowId);
      if (!flow?.updatedAt || !success) return false;
      return success > flow.updatedAt;
    };
  }

  /* ── Suggested fixes: preview → backup → apply → report → undo ───────────── */

  /** Dry-run: what would "Fix all safe issues" change? Nothing is written. */
  async previewSafeFixes(flowId: string): Promise<{ fixes: AppliedFix[]; beforeErrorCount: number; afterErrorCount: number }> {
    const { flow, report } = await this.loadAndValidate(flowId);
    const result = applySafeFixes(flow, report.issues);
    const after = validateFlowDefinition(result.profile, await this.referenceContext());
    return { fixes: [...result.applied], beforeErrorCount: errorsOf(report).length, afterErrorCount: errorsOf(after).length };
  }

  /**
   * Apply every available safe fix to the STORED flow. Ceremony, in order: validate fresh, write
   * an untouched backup of the original, apply the deterministic fixes, save, record the migration
   * report, and revoke any Legacy Compatibility grant as "migrated" (the content changed).
   */
  async applySafeFixesToFlow(flowId: string): Promise<{ record: MigrationRecord; profile: FlowProfile }> {
    const now = this.nowIso();
    const { flow, report } = await this.loadAndValidate(flowId);
    if (availableSafeFixes(report.issues).length === 0) {
      throw new Error(`Flow ${flowId} has no safe fixes to apply.`);
    }

    // Ids must be unique even when two migrations land in the same millisecond — otherwise the
    // second would overwrite the first's BACKUP, which is the one artifact that must never be lost.
    const migrationId = await this.uniqueId(this.migrationStore, `${flowId}.${now.replace(/[:.]/g, "-")}`);

    await mkdir(this.backupsDir, { recursive: true });
    const backupPath = join(this.backupsDir, `${migrationId}.json`);
    await writeFile(backupPath, `${JSON.stringify(flow, null, 2)}\n`, "utf8");

    const result = applySafeFixes(flow, report.issues);
    const saved = await this.deps.flowStore.update(flowId, { ...result.profile, updatedAt: now });
    const after = validateFlowDefinition(saved, await this.referenceContext());

    const grant = await this.grantStore.get(flowId);
    if (grant && !grant.revokedAt) {
      await this.grantStore.update(flowId, { ...grant, revokedAt: now, revokedReason: "migrated" });
    }

    const record = await this.migrationStore.create({
      id: migrationId,
      flowId,
      at: now,
      validatorVersion: FLOW_VALIDATOR_VERSION,
      backupPath,
      beforeHash: this.digestFor(flow),
      afterHash: this.digestFor(saved),
      fixes: [...result.applied],
      skipped: [...result.skipped],
      beforeErrorCount: errorsOf(report).length,
      afterErrorCount: errorsOf(after).length
    });

    return { record, profile: saved };
  }

  /**
   * Restore the pre-migration backup — allowed only while the stored flow still matches the
   * migration's post-fix content, so an undo can never destroy edits made afterwards.
   */
  async undoMigration(flowId: string, migrationId: string): Promise<{ profile: FlowProfile }> {
    const record = await this.migrationStore.get(migrationId);
    if (!record || record.flowId !== flowId) throw new Error(`No migration ${migrationId} for flow ${flowId}.`);
    if (record.undoneAt) throw new Error(`Migration ${migrationId} was already undone.`);

    const current = await this.deps.flowStore.get(flowId);
    if (!current) throw new Error(`Flow ${flowId} no longer exists.`);
    if (this.digestFor(current) !== record.afterHash) {
      throw new Error(`Flow ${flowId} was edited after this migration — undo would destroy those changes. Restore manually from ${record.backupPath} if intended.`);
    }

    const backup = JSON.parse(await readFile(record.backupPath, "utf8")) as FlowProfile;
    const restored = await this.deps.flowStore.update(flowId, backup);
    await this.migrationStore.update(migrationId, { ...record, undoneAt: this.nowIso() });
    return { profile: restored };
  }

  async migrationsForFlow(flowId: string): Promise<MigrationRecord[]> {
    return (await this.migrationStore.list()).filter((record) => record.flowId === flowId).sort((a, b) => b.at.localeCompare(a.at));
  }

  /* ── helpers ─────────────────────────────────────────────────────────────── */

  /**
   * `base`, with a numeric discriminator when that id is already taken — ids must be unique beyond
   * clock resolution, or a same-millisecond second write would overwrite the first record (and,
   * for migrations, its BACKUP, the one artifact that must never be lost).
   */
  private async uniqueId<T extends { id: string }>(store: JsonProfileStore<T>, base: string): Promise<string> {
    const taken = new Set((await store.list()).map((record) => record.id));
    if (!taken.has(base)) return base;
    let suffix = 2;
    while (taken.has(`${base}-${suffix}`)) suffix += 1;
    return `${base}-${suffix}`;
  }

  private async referenceContext(): Promise<{ referenceableFlowIds: Set<string> }> {
    const flows = await this.deps.flowStore.list();
    return { referenceableFlowIds: new Set(flows.map((flow) => flow.id)) };
  }

  private async loadAndValidate(flowId: string): Promise<{ flow: FlowProfile; report: ReturnType<typeof validateFlowDefinition> }> {
    const flow = await this.deps.flowStore.get(flowId);
    if (!flow) throw new Error(`Flow not found: ${flowId}`);
    const report = validateFlowDefinition(flow, await this.referenceContext());
    return { flow, report };
  }
}

export const FLOW_VALIDATION_META = {
  validatorVersion: FLOW_VALIDATOR_VERSION,
  windowDays: LEGACY_COMPATIBILITY_WINDOW_DAYS
} as const;
