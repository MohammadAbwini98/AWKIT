/**
 * VisualBaselineStore (Phase N, N6.3 / awkit-vra.15.3). Plan: docs/plans/ai-upgrade-v5/N6-visual-assertions.md,
 * VA-5, VA-6, VA-13, VA-14, C1-C3, ratified 2026-10-22.
 *
 * WHAT IS STORED. Per app mode, per resolved flows folder, per flow: one signed index per step and one
 * signed record per approval. A record keeps the conditions, the CSS box and state, the image size, the
 * approval metadata and ONE equality commitment:
 *
 *   HMAC-SHA256(K_commit, enc("awkit-n6-commit-v1", flowId, stepId, stepContentDigest, conditionsKey,
 *                             epoch, width, height, contentDigest))
 *
 * where `enc` prefixes every field with its 4-byte big-endian length. Never an image, crop, grid, dHash
 * or the raw content digest. Equality is decided by the N6.2 policy over the commitments, not here.
 *
 * KEYS (C1, VA-14). One random 256-bit master key per app mode, protected by the injected
 * `VisualKeyProtector` (in the app: Electron `safeStorage` behind the existing availability capability)
 * and kept in a PRIVATE key file under `visual-baselines/<mode>/keys/`, never in the general secret
 * store, so neither `secrets:*` nor a flow's secret names can reach it. `K_mac` and `K_commit` are HKDF
 * derivations with separate labels. An unsigned key-state marker records the key generation; a missing
 * key with a marker present is "key lost" and is never regenerated silently: only `resetUnchecked`
 * (behind permission, fresh re-authentication and audit at the integration boundary, N6.5) makes a new key.
 *
 * COORDINATION. Approval, token creation, sweep and reset run in the flows folder's lane and under its
 * cross-process lock, the same critical section as every flow write, so an approval can never land after
 * a write that made it stale. Lookups only read.
 *
 * Stated limits (VA-14): code running as the same Windows user can unwrap the key and forge, replay or
 * roll back records, restore a whole folder consistently, restore an old epoch token before the sweep,
 * delete the key-state marker or move the clock. The MAC protects against other users, other machines,
 * copied files and corruption, not against that.
 */

import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import type { FlowProfile } from "../../profiles/FlowProfile";
import { CrossProcessLockError } from "../../storage/crossProcessLock";
import type { VisualGrantStatus } from "./visualAssertionContract";
import { canonicalJson, visualStepContentDigest } from "./stepContentDigest";
import { VisualBaselineLayout, createExclusive, listDirectory, sha256Hex, writeAtomically, type VisualBaselineAppMode } from "./visualBaselineLayout";

export const VISUAL_BASELINE_STORE_VERSION = 1;

/** The N6.2 conditions key fields, in the policy's order (`verify:visual-baseline-store` pins the equality). */
export const VISUAL_BASELINE_CONDITION_KEYS = [
  "renderMode",
  "browserVersion",
  "appVersion",
  "osBuild",
  "devicePixelRatio",
  "cssWidth",
  "cssHeight",
  "colorScheme",
  "forcedColors",
  "reducedMotion",
  "locale",
  "timeZone",
  "frameDepth",
  "isMainFrame",
  "capturePolicy",
  "fingerprintVersion",
  "assertionPolicyVersion"
] as const;

export type VisualBaselineConditionKey = (typeof VISUAL_BASELINE_CONDITION_KEYS)[number];
export type VisualBaselineConditions = Record<VisualBaselineConditionKey, string | number | boolean>;

export interface VisualBaselineGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  clipped: boolean;
  hover: boolean;
  focus: boolean;
}

/** The app's key protection. Production: Electron `safeStorage`. There is no plaintext implementation. */
export interface VisualKeyProtector {
  isAvailable(): boolean;
  protect(plain: Buffer): Buffer;
  unprotect(cipher: Buffer): Buffer;
}

export type VisualKeyUnavailableReason = "encryption-unavailable" | "key-lost" | "key-unreadable" | "key-mismatch" | "marker-unreadable";

export type VisualKeyState =
  | { state: "available"; generation: number }
  | { state: "first-use" }
  | { state: "unavailable"; reason: VisualKeyUnavailableReason };

/** What a lookup found. Structurally the N6.2 `VisualAssertionBaseline` input, plus a diagnostic reason. */
export type VisualBaselineLookup =
  | { status: "absent" }
  | { status: "other-conditions" }
  | { status: "binding-changed" }
  | { status: "unreadable"; reason: string }
  | { status: "integrity-unavailable"; reason: VisualKeyUnavailableReason | "first-use" }
  | { status: "present"; conditions: VisualBaselineConditions; geometry: VisualBaselineGeometry; commitment: string };

export interface VisualBaselineCommitmentParts {
  flowId: string;
  stepId: string;
  stepContentDigest: string;
  conditions: VisualBaselineConditions;
  epoch: string;
  /** Image size in device pixels. */
  width: number;
  height: number;
  /** The N1 `contentDigest` (`sha256:<hex>`): used once, never stored. */
  contentDigest: string;
}

export interface VisualBaselineApprovalRequest extends VisualBaselineCommitmentParts {
  geometry: VisualBaselineGeometry;
  /** The candidate's binding, fixed at capture (VA-13). */
  boundEpoch: string;
  boundKeyGeneration: number;
  approver: string;
  runUser: string;
  runId: string;
  appVersion: string;
}

export type VisualBaselineApprovalRefusal =
  | "invalid-request"
  | "coordination-unavailable"
  | "integrity-unavailable"
  | "stale-key-generation"
  | "stale-epoch"
  | "flow-missing"
  | "step-missing"
  | "stale-content";

export type VisualBaselineApprovalResult =
  | { ok: true; approvalId: string; generation: number; keyGeneration: number; replacedUnreadable: boolean }
  | { ok: false; refusal: VisualBaselineApprovalRefusal };

/** VA-12: a grant binds this calibration suite; a new suite version invalidates every grant. */
export const VISUAL_CALIBRATION_SUITE_VERSION = "awkit-n6-calibration-v1";
export const VISUAL_GRANT_VALIDITY_MS = 30 * 24 * 60 * 60 * 1000;

/** One qualification cell (VA-12): render mode by device pixel ratio. */
export interface VisualGrantCell {
  renderMode: "headed" | "headless";
  devicePixelRatio: number;
}

/** The environment a grant is bound to; any change invalidates it. */
export interface VisualGrantEnvironment {
  browserVersion: string;
  appVersion: string;
  osBuild: string;
  capturePolicy: string;
  fingerprintVersion: string;
  assertionPolicyVersion: number;
  calibrationSuiteVersion: string;
}

export type { VisualGrantStatus } from "./visualAssertionContract";

export interface VisualBaselineStoreOptions {
  layout: VisualBaselineLayout;
  appMode: VisualBaselineAppMode;
  protector: VisualKeyProtector;
  /** The current flow, read inside the critical section to re-check a candidate's staleness. */
  readFlow: (flowId: string) => Promise<FlowProfile | null>;
  /** Clock for approval metadata only; never used for any decision. */
  now?: () => Date;
}

interface DerivedKeys {
  generation: number;
  mac: Buffer;
  commit: Buffer;
}

interface IndexEntry {
  stepContentDigest: string;
  conditionsKey: string;
  approvalId: string;
  generation: number;
}

interface IndexFile {
  version: 1;
  kind: "index";
  mode: VisualBaselineAppMode;
  folderKey: string;
  flowId: string;
  stepId: string;
  epoch: string;
  keyGeneration: number;
  generation: number;
  entries: IndexEntry[];
  mac: string;
}

interface RecordFile {
  version: 1;
  kind: "record";
  mode: VisualBaselineAppMode;
  folderKey: string;
  flowId: string;
  stepId: string;
  stepContentDigest: string;
  conditionsKey: string;
  epoch: string;
  keyGeneration: number;
  generation: number;
  approvalId: string;
  conditions: VisualBaselineConditions;
  geometry: VisualBaselineGeometry;
  imageWidth: number;
  imageHeight: number;
  commitment: string;
  approval: { approver: string; runUser: string; runId: string; approvedAt: string; appVersion: string };
  mac: string;
}

const HEX64 = /^[0-9a-f]{64}$/;
const HEX32 = /^[0-9a-f]{32}$/;
const CONTENT_DIGEST = /^sha256:[0-9a-f]{64}$/;
const MAX_ID_LENGTH = 1024;
const HKDF_SALT = Buffer.from("awkit-n6-visual-baselines-v1", "utf8");

/** Length-prefixed canonical encoding: every field is `uint32be(byteLength) ‖ utf8`. No boundary is ambiguous. */
export function encodeFields(fields: readonly (string | number | boolean)[]): Buffer {
  const parts: Buffer[] = [];
  for (const field of fields) {
    if (typeof field === "number" && !Number.isFinite(field)) throw new Error("non-finite field");
    const bytes = Buffer.from(String(field), "utf8");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    parts.push(length, bytes);
  }
  return Buffer.concat(parts);
}

export function visualConditionsKey(conditions: VisualBaselineConditions): string {
  return sha256Hex(encodeFields(["awkit-n6-conditions-v1", ...VISUAL_BASELINE_CONDITION_KEYS.map((key) => conditions[key])]).toString("base64"));
}

const validId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH;
const validCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function validConditions(value: unknown): value is VisualBaselineConditions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== VISUAL_BASELINE_CONDITION_KEYS.length) return false;
  return VISUAL_BASELINE_CONDITION_KEYS.every((key) => {
    const field = record[key];
    return (typeof field === "string" && field.length > 0 && field.length <= 256) || (typeof field === "number" && Number.isFinite(field)) || typeof field === "boolean";
  });
}

export function validGeometry(value: unknown): value is VisualBaselineGeometry {
  if (!value || typeof value !== "object") return false;
  const g = value as VisualBaselineGeometry;
  return (
    [g.x, g.y, g.width, g.height].every((n) => typeof n === "number" && Number.isFinite(n)) &&
    g.width > 0 &&
    g.height > 0 &&
    typeof g.clipped === "boolean" &&
    typeof g.hover === "boolean" &&
    typeof g.focus === "boolean"
  );
}

function sameHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length || !/^[0-9a-f]*$/.test(a) || !/^[0-9a-f]*$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

async function readJson(path: string): Promise<{ kind: "missing" } | { kind: "corrupt" } | { kind: "value"; value: unknown }> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { kind: "missing" } : { kind: "corrupt" };
  }
  try {
    return { kind: "value", value: JSON.parse(raw) as unknown };
  } catch {
    return { kind: "corrupt" };
  }
}

export class VisualBaselineStore {
  readonly layout: VisualBaselineLayout;
  readonly appMode: VisualBaselineAppMode;
  private readonly protector: VisualKeyProtector;
  private readonly readFlow: (flowId: string) => Promise<FlowProfile | null>;
  private readonly now: () => Date;

  constructor(options: VisualBaselineStoreOptions) {
    if (options.appMode !== "packaged" && options.appMode !== "dev") throw new Error("visual baseline store needs an app mode");
    this.layout = options.layout;
    this.appMode = options.appMode;
    this.protector = options.protector;
    this.readFlow = options.readFlow;
    this.now = options.now ?? (() => new Date());
  }

  // ── Paths ──────────────────────────────────────────────────────────────────────────────────

  private keysDirectory(): string {
    return join(this.layout.modeRoot(this.appMode), "keys");
  }

  private keyPath(): string {
    return join(this.keysDirectory(), "master-key.json");
  }

  private markerPath(): string {
    return join(this.keysDirectory(), "key-state.json");
  }

  private async indexPath(flowId: string, stepId: string): Promise<string> {
    return join(await this.layout.flowDirectory(this.appMode, flowId), `${this.layout.stepKey(stepId)}.index.json`);
  }

  private async recordPath(flowId: string, stepId: string, approvalId: string): Promise<string> {
    return join(await this.layout.flowDirectory(this.appMode, flowId), `${this.layout.stepKey(stepId)}.${approvalId}.record.json`);
  }

  // ── Keys ───────────────────────────────────────────────────────────────────────────────────

  protected deriveKeys(master: Buffer, generation: number): DerivedKeys {
    const derive = (label: string): Buffer => Buffer.from(hkdfSync("sha256", master, HKDF_SALT, Buffer.from(label, "utf8"), 32));
    return { generation, mac: derive("awkit-n6-mac-v1"), commit: derive("awkit-n6-commit-v1") };
  }

  private keyCheck(keys: DerivedKeys, mode: string, generation: number): string {
    return createHmac("sha256", keys.mac).update(encodeFields(["awkit-n6-key-check-v1", mode, generation])).digest("hex");
  }

  /** Read the key state without writing anything. */
  protected async loadKeys(): Promise<{ state: "available"; keys: DerivedKeys; markerPresent: boolean } | { state: "first-use" } | { state: "unavailable"; reason: VisualKeyUnavailableReason }> {
    if (!this.protector.isAvailable()) return { state: "unavailable", reason: "encryption-unavailable" };
    const marker = await readJson(this.markerPath());
    const key = await readJson(this.keyPath());
    if (marker.kind === "corrupt") return { state: "unavailable", reason: "marker-unreadable" };
    let markerGeneration: number | null = null;
    if (marker.kind === "value") {
      const m = marker.value as { version?: unknown; mode?: unknown; generation?: unknown };
      if (m.version !== 1 || m.mode !== this.appMode || !validCount(m.generation) || m.generation < 1) return { state: "unavailable", reason: "marker-unreadable" };
      markerGeneration = m.generation;
    }
    if (key.kind === "missing") return markerGeneration === null ? { state: "first-use" } : { state: "unavailable", reason: "key-lost" };
    if (key.kind === "corrupt") return { state: "unavailable", reason: "key-unreadable" };
    const k = key.value as { version?: unknown; mode?: unknown; generation?: unknown; protectedKey?: unknown; check?: unknown };
    if (k.version !== 1 || typeof k.protectedKey !== "string" || typeof k.check !== "string" || !validCount(k.generation)) return { state: "unavailable", reason: "key-unreadable" };
    if (k.mode !== this.appMode) return { state: "unavailable", reason: "key-mismatch" };
    let master: Buffer;
    try {
      master = this.protector.unprotect(Buffer.from(k.protectedKey, "base64"));
    } catch {
      return { state: "unavailable", reason: "key-unreadable" };
    }
    if (master.length !== 32) return { state: "unavailable", reason: "key-unreadable" };
    const keys = this.deriveKeys(master, k.generation);
    if (!sameHex(this.keyCheck(keys, this.appMode, k.generation), k.check)) return { state: "unavailable", reason: "key-mismatch" };
    if (markerGeneration !== null && markerGeneration !== k.generation) return { state: "unavailable", reason: "key-mismatch" };
    return { state: "available", keys, markerPresent: markerGeneration !== null };
  }

  async keyState(): Promise<VisualKeyState> {
    const loaded = await this.loadKeys();
    return loaded.state === "available" ? { state: "available", generation: loaded.keys.generation } : loaded.state === "first-use" ? { state: "first-use" } : loaded;
  }

  /** The key generation a candidate binds at capture: 0 before the first key exists, null when unavailable. */
  async keyGeneration(): Promise<number | null> {
    const loaded = await this.loadKeys();
    return loaded.state === "available" ? loaded.keys.generation : loaded.state === "first-use" ? 0 : null;
  }

  /** Create the first key (generation `generation`). Inside the critical section; a concurrent same-mode creator wins cleanly. */
  private async createKey(generation: number): Promise<void> {
    await this.layout.assertHeld();
    await mkdir(this.keysDirectory(), { recursive: true });
    const master = randomBytes(32);
    const keys = this.deriveKeys(master, generation);
    const file = {
      version: 1,
      mode: this.appMode,
      generation,
      protectedKey: this.protector.protect(master).toString("base64"),
      check: this.keyCheck(keys, this.appMode, generation)
    };
    master.fill(0);
    await createExclusive(this.keyPath(), JSON.stringify(file));
    await writeAtomically(this.markerPath(), JSON.stringify({ version: 1, mode: this.appMode, generation }));
  }

  // ── MACs and commitments ───────────────────────────────────────────────────────────────────

  protected mac(keys: DerivedKeys, fields: readonly (string | number | boolean)[]): string {
    return createHmac("sha256", keys.mac).update(encodeFields(fields)).digest("hex");
  }

  protected commitmentFields(parts: VisualBaselineCommitmentParts): (string | number)[] {
    return [
      "awkit-n6-commit-v1",
      parts.flowId,
      parts.stepId,
      parts.stepContentDigest,
      visualConditionsKey(parts.conditions),
      parts.epoch,
      parts.width,
      parts.height,
      parts.contentDigest
    ];
  }

  private commitmentWith(keys: DerivedKeys, parts: VisualBaselineCommitmentParts): string {
    return createHmac("sha256", keys.commit).update(encodeFields(this.commitmentFields(parts))).digest("hex");
  }

  private validParts(parts: VisualBaselineCommitmentParts): boolean {
    return (
      validId(parts.flowId) &&
      validId(parts.stepId) &&
      HEX64.test(parts.stepContentDigest) &&
      validConditions(parts.conditions) &&
      HEX32.test(parts.epoch) &&
      validCount(parts.width) &&
      parts.width > 0 &&
      validCount(parts.height) &&
      parts.height > 0 &&
      CONTENT_DIGEST.test(parts.contentDigest)
    );
  }

  /** The current capture's commitment, for the N6.2 policy. Needs the key; computes nothing it stores. */
  async commitmentFor(parts: VisualBaselineCommitmentParts): Promise<{ ok: true; commitment: string } | { ok: false; status: "integrity-unavailable" | "invalid" }> {
    if (!this.validParts(parts)) return { ok: false, status: "invalid" };
    const loaded = await this.loadKeys();
    if (loaded.state !== "available") return { ok: false, status: "integrity-unavailable" };
    return { ok: true, commitment: this.commitmentWith(loaded.keys, parts) };
  }

  protected indexMacFields(index: Omit<IndexFile, "mac">): (string | number)[] {
    return ["awkit-n6-index-v1", index.mode, index.folderKey, index.flowId, index.stepId, index.epoch, index.keyGeneration, index.generation, canonicalJson(index.entries)];
  }

  protected recordMacFields(record: Omit<RecordFile, "mac">): (string | number)[] {
    return [
      "awkit-n6-record-v1",
      record.mode,
      record.folderKey,
      record.flowId,
      record.stepId,
      record.stepContentDigest,
      record.conditionsKey,
      record.epoch,
      record.keyGeneration,
      record.generation,
      record.approvalId,
      canonicalJson(record.conditions),
      canonicalJson(record.geometry),
      record.imageWidth,
      record.imageHeight,
      record.commitment,
      canonicalJson(record.approval)
    ];
  }

  // ── Reading ────────────────────────────────────────────────────────────────────────────────

  /** A signed index that verifies and belongs exactly here, or why not. */
  protected async readIndex(keys: DerivedKeys, flowId: string, stepId: string): Promise<{ kind: "missing" } | { kind: "invalid"; reason: string } | { kind: "index"; index: IndexFile }> {
    const read = await readJson(await this.indexPath(flowId, stepId));
    if (read.kind === "missing") return { kind: "missing" };
    if (read.kind === "corrupt") return { kind: "invalid", reason: "index-corrupt" };
    const index = read.value as IndexFile;
    if (
      !index ||
      index.version !== 1 ||
      index.kind !== "index" ||
      typeof index.mac !== "string" ||
      !Array.isArray(index.entries) ||
      !validCount(index.generation) ||
      !validCount(index.keyGeneration) ||
      typeof index.epoch !== "string" ||
      index.entries.some((e) => !e || !HEX64.test(e.stepContentDigest) || !HEX64.test(e.conditionsKey) || !HEX32.test(e.approvalId) || !validCount(e.generation))
    ) {
      return { kind: "invalid", reason: "index-corrupt" };
    }
    const { mac, ...unsigned } = index;
    if (!sameHex(this.mac(keys, this.indexMacFields(unsigned)), mac)) return { kind: "invalid", reason: "index-integrity-failed" };
    if (index.mode !== this.appMode || index.folderKey !== (await this.layout.folderKey()) || index.flowId !== flowId || index.stepId !== stepId) {
      return { kind: "invalid", reason: "index-moved" };
    }
    if (index.keyGeneration !== keys.generation) return { kind: "invalid", reason: "index-key-generation" };
    return { kind: "index", index };
  }

  protected async readRecord(keys: DerivedKeys, index: IndexFile, entry: IndexEntry): Promise<{ ok: true; record: RecordFile } | { ok: false; reason: string }> {
    const read = await readJson(await this.recordPath(index.flowId, index.stepId, entry.approvalId));
    if (read.kind === "missing") return { ok: false, reason: "record-missing" };
    if (read.kind === "corrupt") return { ok: false, reason: "record-corrupt" };
    const record = read.value as RecordFile;
    if (!record || record.version !== 1 || record.kind !== "record" || typeof record.mac !== "string" || !validConditions(record.conditions) || !validGeometry(record.geometry)) {
      return { ok: false, reason: "record-corrupt" };
    }
    const { mac, ...unsigned } = record;
    if (!sameHex(this.mac(keys, this.recordMacFields(unsigned)), mac)) return { ok: false, reason: "record-integrity-failed" };
    const bound =
      record.mode === index.mode &&
      record.folderKey === index.folderKey &&
      record.flowId === index.flowId &&
      record.stepId === index.stepId &&
      record.epoch === index.epoch &&
      record.keyGeneration === index.keyGeneration &&
      record.stepContentDigest === entry.stepContentDigest &&
      record.conditionsKey === entry.conditionsKey &&
      record.approvalId === entry.approvalId &&
      record.generation === entry.generation &&
      visualConditionsKey(record.conditions) === record.conditionsKey &&
      !record.geometry.clipped &&
      HEX64.test(record.commitment);
    return bound ? { ok: true, record } : { ok: false, reason: "record-replayed" };
  }

  /** What the store holds for this step and these conditions (read-only). */
  async lookup(request: { flowId: string; stepId: string; stepContentDigest: string; conditions: VisualBaselineConditions }): Promise<VisualBaselineLookup> {
    if (!validId(request.flowId) || !validId(request.stepId) || !HEX64.test(request.stepContentDigest) || !validConditions(request.conditions)) {
      return { status: "unreadable", reason: "invalid-request" };
    }
    const loaded = await this.loadKeys();
    if (loaded.state === "unavailable") return { status: "integrity-unavailable", reason: loaded.reason };
    const token = await this.layout.readToken(request.flowId);
    if (loaded.state === "first-use") {
      // No key was ever made: any signed file present cannot be verified.
      const files = await listDirectory(await this.layout.flowDirectory(this.appMode, request.flowId));
      return files.some((f) => f.startsWith(this.layout.stepKey(request.stepId))) ? { status: "unreadable", reason: "no-key" } : { status: "absent" };
    }
    if (!token) return { status: "absent" };
    const read = await this.readIndex(loaded.keys, request.flowId, request.stepId);
    if (read.kind === "missing") return { status: "absent" };
    if (read.kind === "invalid") return { status: "unreadable", reason: read.reason };
    const index = read.index;
    // A different epoch is a stale approval of a replaced flow: ignored, never revived, swept later.
    if (!sameHex(index.epoch, token)) return { status: "absent" };
    const conditionsKey = visualConditionsKey(request.conditions);
    const entry = index.entries.find((e) => e.stepContentDigest === request.stepContentDigest && e.conditionsKey === conditionsKey);
    if (!entry) {
      if (index.entries.some((e) => e.stepContentDigest === request.stepContentDigest)) return { status: "other-conditions" };
      return index.entries.length > 0 ? { status: "binding-changed" } : { status: "absent" };
    }
    const record = await this.readRecord(loaded.keys, index, entry);
    if (!record.ok) return { status: "unreadable", reason: record.reason };
    return { status: "present", conditions: record.record.conditions, geometry: record.record.geometry, commitment: record.record.commitment };
  }

  // ── Coordinated writes ─────────────────────────────────────────────────────────────────────

  /** The flow's epoch token, created when missing (C3). Coordinated, so concurrent processes agree on one. */
  ensureToken(flowId: string): Promise<string> {
    if (!validId(flowId)) return Promise.reject(new Error("invalid flow id"));
    return this.layout.coordinate(() => this.layout.ensureTokenUnlocked(flowId));
  }

  /**
   * Write an approval (VA-13). Inside the flows folder's critical section, re-checks the candidate's
   * binding against the CURRENT key generation, epoch token, flow and step content. No permission or
   * re-authentication is checked here: the caller (N6.5) must have done both and must audit.
   */
  approveUnchecked(request: VisualBaselineApprovalRequest): Promise<VisualBaselineApprovalResult> {
    if (
      !this.validParts(request) ||
      !validGeometry(request.geometry) ||
      request.geometry.clipped ||
      !HEX32.test(request.boundEpoch) ||
      !validCount(request.boundKeyGeneration) ||
      ![request.approver, request.runUser, request.runId, request.appVersion].every(validId)
    ) {
      return Promise.resolve({ ok: false, refusal: "invalid-request" });
    }
    return this.layout.coordinate(() => this.approveCoordinated(request)).catch((error: unknown): VisualBaselineApprovalResult => {
      if (error instanceof CrossProcessLockError && error.code === "lock-unsupported") return { ok: false, refusal: "coordination-unavailable" };
      throw error;
    });
  }

  private async approveCoordinated(request: VisualBaselineApprovalRequest): Promise<VisualBaselineApprovalResult> {
    let loaded = await this.loadKeys();
    if (loaded.state === "unavailable") return { ok: false, refusal: "integrity-unavailable" };
    if (loaded.state === "first-use") {
      if (request.boundKeyGeneration !== 0) return { ok: false, refusal: "stale-key-generation" };
      await this.createKey(1);
      loaded = await this.loadKeys();
      if (loaded.state !== "available") return { ok: false, refusal: "integrity-unavailable" };
    } else if (request.boundKeyGeneration !== loaded.keys.generation && !(request.boundKeyGeneration === 0 && loaded.keys.generation === 1)) {
      // A candidate captured before any key existed (generation 0) stays valid when another approval or grant made the
      // FIRST key (generation 1): creating the first key invalidates nothing. Any later generation is a reset after
      // the capture, which makes it stale.
      return { ok: false, refusal: "stale-key-generation" };
    }
    const keys = loaded.keys;
    if (!loaded.markerPresent) {
      await this.layout.assertHeld();
      await writeAtomically(this.markerPath(), JSON.stringify({ version: 1, mode: this.appMode, generation: keys.generation }));
    }

    const token = await this.layout.readToken(request.flowId);
    if (!token || !sameHex(token, request.boundEpoch)) return { ok: false, refusal: "stale-epoch" };
    const current = await this.currentStepDigest(request.flowId, request.stepId, request.stepContentDigest);
    if (current === "flow-missing" || current === "step-missing") return { ok: false, refusal: current };
    if (current !== request.stepContentDigest) return { ok: false, refusal: "stale-content" };

    const folderKey = await this.layout.folderKey();
    const conditionsKey = visualConditionsKey(request.conditions);
    const existing = await this.readIndex(keys, request.flowId, request.stepId);
    const replacedUnreadable = existing.kind === "invalid";
    const previous = existing.kind === "index" && sameHex(existing.index.epoch, token) ? existing.index : null;
    const generation = (previous?.generation ?? (await this.unverifiedGeneration(request.flowId, request.stepId))) + 1;
    const approvalId = randomBytes(16).toString("hex");

    const unsignedRecord: Omit<RecordFile, "mac"> = {
      version: 1,
      kind: "record",
      mode: this.appMode,
      folderKey,
      flowId: request.flowId,
      stepId: request.stepId,
      stepContentDigest: request.stepContentDigest,
      conditionsKey,
      epoch: token,
      keyGeneration: keys.generation,
      generation,
      approvalId,
      conditions: { ...request.conditions },
      geometry: { ...request.geometry },
      imageWidth: request.width,
      imageHeight: request.height,
      commitment: this.commitmentWith(keys, { ...request, epoch: token }),
      approval: { approver: request.approver, runUser: request.runUser, runId: request.runId, approvedAt: this.now().toISOString(), appVersion: request.appVersion }
    };
    const entries: IndexEntry[] = [
      ...(previous?.entries ?? []).filter((e) => e.stepContentDigest === request.stepContentDigest && e.conditionsKey !== conditionsKey),
      { stepContentDigest: request.stepContentDigest, conditionsKey, approvalId, generation }
    ];
    const unsignedIndex: Omit<IndexFile, "mac"> = {
      version: 1,
      kind: "index",
      mode: this.appMode,
      folderKey,
      flowId: request.flowId,
      stepId: request.stepId,
      epoch: token,
      keyGeneration: keys.generation,
      generation,
      entries
    };

    const directory = await this.layout.flowDirectory(this.appMode, request.flowId);
    await mkdir(directory, { recursive: true });
    // Record first, then the index that references it: a crash in between leaves an unreferenced record (swept).
    await this.layout.assertHeld();
    await writeAtomically(await this.recordPath(request.flowId, request.stepId, approvalId), JSON.stringify(this.persistedRecord(keys, unsignedRecord)));
    await this.layout.assertHeld();
    await writeAtomically(await this.indexPath(request.flowId, request.stepId), JSON.stringify({ ...unsignedIndex, mac: this.mac(keys, this.indexMacFields(unsignedIndex)) }));
    await this.removeUnreferenced(request.flowId, request.stepId, new Set(entries.map((e) => e.approvalId)));
    await this.sweepFlowUnlocked(request.flowId, token);
    return { ok: true, approvalId, generation, keyGeneration: keys.generation, replacedUnreadable };
  }

  /**
   * The step's content digest as the flow stands NOW, read inside the critical section. `bound` is the
   * candidate's digest, passed only so a verifier variant can plant the "trust the candidate" defect.
   */
  protected async currentStepDigest(flowId: string, stepId: string, bound: string): Promise<string | "flow-missing" | "step-missing"> {
    void bound;
    const flow = await this.readFlow(flowId);
    if (!flow) return "flow-missing";
    const step = (Array.isArray(flow.nodes) ? flow.nodes : []).find((node) => node && node.id === stepId);
    if (!step) return "step-missing";
    return visualStepContentDigest(step as unknown as { id: string } & Record<string, unknown>);
  }

  /** The record as written. Overridable so verifiers can plant a store that persists more than it may. */
  protected persistedRecord(keys: DerivedKeys, unsigned: Omit<RecordFile, "mac">): RecordFile {
    return { ...unsigned, mac: this.mac(keys, this.recordMacFields(unsigned)) };
  }

  /** The generation an unreadable or stale index claimed, so a replacement stays above it. */
  private async unverifiedGeneration(flowId: string, stepId: string): Promise<number> {
    const read = await readJson(await this.indexPath(flowId, stepId));
    const value = read.kind === "value" ? (read.value as { generation?: unknown }).generation : undefined;
    return validCount(value) ? value : 0;
  }

  private async removeUnreferenced(flowId: string, stepId: string, keep: ReadonlySet<string>): Promise<void> {
    const directory = await this.layout.flowDirectory(this.appMode, flowId);
    const prefix = `${this.layout.stepKey(stepId)}.`;
    for (const entry of await listDirectory(directory)) {
      const match = /^[0-9a-f]{64}\.([0-9a-f]{32})\.record\.json$/.exec(entry);
      if (match && entry.startsWith(prefix) && !keep.has(match[1])) await rm(join(directory, entry), { force: true });
    }
  }

  /** Delete this mode's files of a flow that belong to another epoch, or that no current index references. */
  private async sweepFlowUnlocked(flowId: string, token: string | null, budget = { remaining: Number.POSITIVE_INFINITY }): Promise<number> {
    const directory = await this.layout.flowDirectory(this.appMode, flowId);
    const files = await listDirectory(directory);
    const referenced = new Set<string>();
    let deleted = 0;
    for (const file of files.filter((f) => f.endsWith(".index.json"))) {
      const read = await readJson(join(directory, file));
      const epoch = read.kind === "value" ? (read.value as { epoch?: unknown }).epoch : undefined;
      const entries = read.kind === "value" ? (read.value as { entries?: unknown }).entries : undefined;
      if (token && typeof epoch === "string" && sameHex(epoch, token) && Array.isArray(entries)) {
        for (const e of entries as Array<{ approvalId?: unknown }>) if (typeof e?.approvalId === "string") referenced.add(e.approvalId);
      } else if (token && read.kind !== "corrupt") {
        // An index of another epoch is dead. A corrupt one is kept for `baseline-unreadable` until an approval replaces it.
        if (budget.remaining-- <= 0) return deleted;
        await rm(join(directory, file), { force: true });
        deleted += 1;
      }
    }
    for (const file of files) {
      const match = /^[0-9a-f]{64}\.([0-9a-f]{32})\.record\.json$/.exec(file);
      if (!match || referenced.has(match[1])) continue;
      if (budget.remaining-- <= 0) return deleted;
      await rm(join(directory, file), { force: true });
      deleted += 1;
    }
    return deleted;
  }

  /**
   * Start-up cleanup for this mode and flows folder: deletes files of another epoch and unreferenced
   * records, at most `maxFiles`. Coordinated. Indexes name their flow; a flow without a token keeps nothing.
   */
  sweep(options: { maxFiles?: number } = {}): Promise<{ deleted: number }> {
    return this.layout.coordinate(async () => {
      const budget = { remaining: options.maxFiles ?? 256 };
      const root = join(this.layout.modeRoot(this.appMode), await this.layout.folderKey());
      let deleted = 0;
      for (const flowDirectory of await listDirectory(root)) {
        if (budget.remaining <= 0) break;
        const files = await listDirectory(join(root, flowDirectory));
        if (files.length === 0) {
          await rm(join(root, flowDirectory), { recursive: true, force: true });
          continue;
        }
        const anyIndex = files.find((f) => f.endsWith(".index.json"));
        const peek = anyIndex ? await readJson(join(root, flowDirectory, anyIndex)) : null;
        const flowId = peek?.kind === "value" ? (peek.value as { flowId?: unknown }).flowId : undefined;
        if (typeof flowId !== "string" || this.layout.flowKey(flowId) !== flowDirectory) {
          // Nothing names this flow (only orphaned records, or tampered names): nothing here can ever verify.
          if (anyIndex && peek?.kind === "corrupt") continue;
          if (budget.remaining-- <= 0) break;
          await rm(join(root, flowDirectory), { recursive: true, force: true });
          deleted += 1;
          continue;
        }
        deleted += await this.sweepFlowUnlocked(flowId, await this.layout.readToken(flowId), budget);
        if ((await listDirectory(join(root, flowDirectory))).length === 0) await rm(join(root, flowDirectory), { recursive: true, force: true });
      }
      return { deleted };
    });
  }

  // ── Experimental enforcement grants (VA-12, VA-16; non-packaged acceptance build only) ────────

  private grantPath(cell: VisualGrantCell): string {
    return join(this.layout.modeRoot(this.appMode), "grants", `${sha256Hex(`awkit-n6-cell-v1\u0000${cell.renderMode}\u0000${cell.devicePixelRatio}`)}.json`);
  }

  protected grantMacFields(grant: { mode: string; cell: VisualGrantCell; environment: VisualGrantEnvironment; evidenceDigest: string; issuedAt: string; expiresAt: string; keyGeneration: number }): (string | number)[] {
    return [
      "awkit-n6-grant-v1",
      grant.mode,
      grant.cell.renderMode,
      grant.cell.devicePixelRatio,
      canonicalJson(grant.environment),
      grant.evidenceDigest,
      grant.issuedAt,
      grant.expiresAt,
      grant.keyGeneration
    ];
  }

  /**
   * Issue a signed grant for one qualified cell. Only the N6.6 calibration harness calls this, inside the
   * non-packaged acceptance build, after the cell met every VA-12 criterion; it never checks those criteria itself.
   * The packaged build issues nothing.
   */
  issueGrantUnchecked(issue: { cell: VisualGrantCell; environment: VisualGrantEnvironment; evidenceDigest: string; issuedAt: Date }): Promise<{ ok: true; expiresAt: string } | { ok: false; reason: string }> {
    if (this.appMode !== "dev") return Promise.resolve({ ok: false, reason: "packaged-build" });
    if (!HEX64.test(issue.evidenceDigest) || !(issue.issuedAt instanceof Date) || !Number.isFinite(issue.issuedAt.getTime())) {
      return Promise.resolve({ ok: false, reason: "invalid-request" });
    }
    return this.layout.coordinate(async () => {
      let loaded = await this.loadKeys();
      if (loaded.state === "first-use") {
        await this.createKey(1);
        loaded = await this.loadKeys();
      }
      if (loaded.state !== "available") return { ok: false as const, reason: "integrity-unavailable" };
      const unsigned = {
        version: 1,
        kind: "grant",
        mode: this.appMode,
        cell: { ...issue.cell },
        environment: { ...issue.environment },
        evidenceDigest: issue.evidenceDigest,
        issuedAt: issue.issuedAt.toISOString(),
        expiresAt: new Date(issue.issuedAt.getTime() + VISUAL_GRANT_VALIDITY_MS).toISOString(),
        keyGeneration: loaded.keys.generation
      };
      const path = this.grantPath(issue.cell);
      await mkdir(join(this.layout.modeRoot(this.appMode), "grants"), { recursive: true });
      await this.layout.assertHeld();
      await writeAtomically(path, JSON.stringify({ ...unsigned, mac: this.mac(loaded.keys, this.grantMacFields(unsigned)) }));
      return { ok: true as const, expiresAt: unsigned.expiresAt };
    });
  }

  /**
   * The cell's grant for THIS environment. The packaged build never reads a grant (VA-16): it answers `missing`
   * without touching the disk. Unreadable, tampered, rebound or key-rotated grants are `invalidated`; a clock set
   * before the issue time is `invalidated` too.
   */
  async grantStatus(cell: VisualGrantCell, environment: VisualGrantEnvironment, now: Date = this.now()): Promise<VisualGrantStatus> {
    if (this.appMode !== "dev") return "missing";
    const read = await readJson(this.grantPath(cell));
    if (read.kind === "missing") return "missing";
    if (read.kind === "corrupt") return "invalidated";
    const loaded = await this.loadKeys();
    if (loaded.state !== "available") return "invalidated";
    const grant = read.value as { version?: unknown; kind?: unknown; mode?: unknown; cell?: VisualGrantCell; environment?: VisualGrantEnvironment; evidenceDigest?: unknown; issuedAt?: unknown; expiresAt?: unknown; keyGeneration?: unknown; mac?: unknown };
    if (
      grant.version !== 1 ||
      grant.kind !== "grant" ||
      typeof grant.mac !== "string" ||
      typeof grant.issuedAt !== "string" ||
      typeof grant.expiresAt !== "string" ||
      typeof grant.evidenceDigest !== "string" ||
      !validCount(grant.keyGeneration) ||
      !grant.cell ||
      !grant.environment
    ) {
      return "invalidated";
    }
    const unsigned = {
      mode: String(grant.mode),
      cell: grant.cell,
      environment: grant.environment,
      evidenceDigest: grant.evidenceDigest,
      issuedAt: grant.issuedAt,
      expiresAt: grant.expiresAt,
      keyGeneration: grant.keyGeneration
    };
    if (!sameHex(this.mac(loaded.keys, this.grantMacFields(unsigned)), grant.mac)) return "invalidated";
    if (
      grant.mode !== this.appMode ||
      grant.keyGeneration !== loaded.keys.generation ||
      grant.cell.renderMode !== cell.renderMode ||
      grant.cell.devicePixelRatio !== cell.devicePixelRatio ||
      canonicalJson(grant.environment) !== canonicalJson(environment)
    ) {
      return "invalidated";
    }
    const issued = Date.parse(grant.issuedAt);
    const expires = Date.parse(grant.expiresAt);
    if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires - issued !== VISUAL_GRANT_VALIDITY_MS) return "invalidated";
    if (now.getTime() < issued) return "invalidated";
    if (now.getTime() >= expires) return "expired";
    return "valid";
  }

  /**
   * Reset visual baselines for this app mode (VA-14): delete every signed file and the key, create a new
   * key with the next generation. Unchecked: the caller (N6.5) enforces permission, fresh
   * re-authentication and audit. Candidates bound to the old generation become stale.
   */
  resetUnchecked(): Promise<{ generation: number }> {
    return this.layout.coordinate(async () => {
      if (!this.protector.isAvailable()) throw new Error("visual baseline reset needs the OS keystore");
      const marker = await readJson(this.markerPath());
      const key = await readJson(this.keyPath());
      const generationOf = (read: Awaited<ReturnType<typeof readJson>>): number => {
        const value = read.kind === "value" ? (read.value as { generation?: unknown }).generation : undefined;
        return validCount(value) ? value : 0;
      };
      // At least 2: generation 1 is reserved for the FIRST key, which a capture bound to 0 may still use. A reset is
      // never that first key, so a pre-reset capture (bound to 0) is stale after it in every process (N6.8 QC finding 2).
      const generation = Math.max(generationOf(marker), generationOf(key), 1) + 1;
      // Crash-safe order (N6.8 security round 2, N3): the marker records the new generation FIRST, then everything
      // else in the mode (the old key included) goes, then the new key. A crash between the steps leaves key-mismatch
      // or key-lost (fail closed, recovered by another reset), never a first-use state that would mint generation 1.
      await this.layout.assertHeld();
      await mkdir(this.keysDirectory(), { recursive: true });
      await writeAtomically(this.markerPath(), JSON.stringify({ version: 1, mode: this.appMode, generation }));
      const modeRoot = this.layout.modeRoot(this.appMode);
      for (const entry of await readdir(modeRoot)) {
        if (entry !== "keys") await rm(join(modeRoot, entry), { recursive: true, force: true });
      }
      for (const entry of await readdir(this.keysDirectory())) {
        if (join(this.keysDirectory(), entry) !== this.markerPath()) await rm(join(this.keysDirectory(), entry), { recursive: true, force: true });
      }
      await this.createKey(generation);
      return { generation };
    });
  }
}
