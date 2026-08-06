import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LocatorElementFingerprint, LocatorFrameContext } from "@src/profiles/FlowProfile";

// ── Blueprint schema types ────────────────────────────────────────────────────

/**
 * A captured snapshot of relevant elements on a specific page, keyed by a normalized URL identity.
 * Blueprints are a SECOND recovery layer: when `recoverLocally()` cannot find a confident match
 * among the broad visible-element scan, the blueprint narrows the search using positional evidence
 * (document order, sibling index) and the element's identity fingerprint.
 *
 * Blueprints are privacy-preserving: all identity tokens are hashed via `hashFingerprint()` from
 * {@link locatorFingerprint} — the same pipeline every other locator identity uses.
 */
export interface PageBlueprint {
  schemaVersion: 1;
  /** Normalized page identity hash: SHA-256(origin + pathname + title-category + frame-chain-digest). */
  pageKey: string;
  /** Canonical URL (origin + pathname only — query/fragment stripped). */
  canonicalUrl: string;
  /** Frame identity digest for iframe-scoped targets; absent for main-frame targets. */
  frameKey?: string;
  /** ISO timestamp of capture. */
  capturedAtUtc: string;
  /** Canonical tag/role histogram for detecting page-variant drift without storing page text. */
  documentFingerprint: string;
  /** Captured element entries (capped at {@link MAX_BLUEPRINT_ELEMENTS}). */
  elements: ElementBlueprint[];
}

/** Cap on element count per blueprint. A 2000-element blueprint at ~200 bytes/entry ≈ 400KB. */
export const MAX_BLUEPRINT_ELEMENTS = 2_000;
/** Maximum serialized file size in bytes (safety limit). */
export const MAX_BLUEPRINT_FILE_SIZE = 512 * 1024;

/**
 * Positional + identity record for a single captured element inside a {@link PageBlueprint}.
 * The fingerprint uses the exact {@link LocatorElementFingerprint} shape so the existing
 * `similarity()` function works directly — no second scoring model.
 */
export interface ElementBlueprint {
  /** Unique per-blueprint element id, stored on the `StepLocator.blueprintId`. */
  blueprintId: string;

  // ── Positional evidence ───────────────────────────────────────────────────
  /** Zero-based document-order index (bounded TreeWalker walk). */
  documentOrder: number;
  /** Zero-based index among parent's children. */
  siblingIndex: number;
  /** Zero-based index among same-tag siblings. */
  sameTagIndex: number;

  // ── Structural evidence ───────────────────────────────────────────────────
  tag: string;
  role?: string;
  /** Reuse the same 3-level ancestry format as LocatorElementFingerprint.ancestry. */
  ancestry: string[];
  /** Hash of the frame chain context (empty string for main frame). */
  frameChainDigest?: string;
  /** Hash of the shadow chain context (empty string for non-shadow targets). */
  shadowChainDigest?: string;

  // ── Identity evidence ─────────────────────────────────────────────────────
  /**
   * Hashed identity fingerprint, computed with `hashFingerprint()` — the same pipeline the
   * guarded-positional system and `recoverLocally()` use. This is the primary matching signal.
   */
  fingerprint: LocatorElementFingerprint;

  // ── Locator reference ─────────────────────────────────────────────────────
  /** SHA-256 digest of the primary locator candidate (not the locator itself — privacy). */
  primaryLocatorDigest: string;
  /** Number of alternative candidates that existed at capture time. */
  alternativeCount: number;

  // ── Capture state ─────────────────────────────────────────────────────────
  /** Whether the element was visible at capture time. */
  visible: boolean;
  /** Whether the element was enabled at capture time. */
  enabled?: boolean;
  /** Viewport-relative bounding region (0..1 ratios, not pixels). */
  boundingRegion?: {
    relativeX: number;
    relativeY: number;
    relativeWidth: number;
    relativeHeight: number;
  };
}

// ── Page key computation ──────────────────────────────────────────────────────

/**
 * Compute a stable page identity key from a URL and page title.
 *
 * The key is: SHA-256( origin + pathname + title-category + frameChainDigest ).
 * Title-category = first 3 words, lowercased — enough to distinguish "Orders - Acme" from
 * "Customers - Acme" without leaking full page titles.
 */
export function computePageKey(url: string, pageTitle: string, frameChainDigest = ""): string {
  let origin = "";
  let pathname = "/";
  try {
    const parsed = new URL(url);
    origin = parsed.origin;
    pathname = parsed.pathname;
  } catch {
    origin = url;
  }
  const titleCategory = (pageTitle || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .split(" ")
    .slice(0, 3)
    .join(" ");
  const raw = `${origin}\0${pathname}\0${titleCategory}\0${frameChainDigest}`;
  return createHash("sha256").update(raw).digest("hex");
}

/** Stable, privacy-safe identity for the recorded outer-to-inner frame chain. */
export function computeFrameKey(frameChain: LocatorFrameContext[] | undefined): string {
  if (!frameChain?.length) return "";
  const normalized = frameChain.map((segment) => ({
    selector: segment.selector,
    index: segment.index ?? null,
    name: segment.name ?? "",
    title: segment.title ?? "",
    url: segment.url ?? ""
  }));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex").slice(0, 20);
}

/**
 * Compare two canonical tag/role histograms. A small inserted banner or wrapper is tolerated, while
 * a materially different same-URL page variant fails closed. Legacy opaque hashes only match exactly.
 */
export function documentFingerprintSimilarity(captured: string, current: string): number {
  if (captured === current) return 1;
  const parse = (value: string): Map<string, number> | undefined => {
    if (!value || !value.includes("=")) return undefined;
    const result = new Map<string, number>();
    for (const part of value.split("|")) {
      const separator = part.lastIndexOf("=");
      const key = part.slice(0, separator);
      const count = Number(part.slice(separator + 1));
      if (!key || !Number.isFinite(count) || count < 0) return undefined;
      result.set(key, count);
    }
    return result;
  };
  const left = parse(captured);
  const right = parse(current);
  if (!left || !right) return 0;
  const keys = new Set([...left.keys(), ...right.keys()]);
  let overlap = 0;
  let leftTotal = 0;
  let rightTotal = 0;
  for (const key of keys) {
    const leftCount = left.get(key) ?? 0;
    const rightCount = right.get(key) ?? 0;
    overlap += Math.min(leftCount, rightCount);
    leftTotal += leftCount;
    rightTotal += rightCount;
  }
  return overlap / Math.max(leftTotal, rightTotal, 1);
}

export function documentFingerprintMatches(captured: string, current: string): boolean {
  return documentFingerprintSimilarity(captured, current) >= 0.85;
}

/**
 * Compute a structural fingerprint of the page for page-variant detection.
 * Uses a tag/role histogram so minor DOM changes don't invalidate the blueprint,
 * but a fundamentally different page layout does.
 */
export function computeDocumentFingerprint(elements: Array<{ tag: string; role?: string }>): string {
  const histogram = new Map<string, number>();
  for (const el of elements) {
    const key = el.role ? `${el.tag}:${el.role}` : el.tag;
    histogram.set(key, (histogram.get(key) ?? 0) + 1);
  }
  const sorted = [...histogram.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex").slice(0, 20);
}

// ── Blueprint store interface ─────────────────────────────────────────────────

export interface LocatorBlueprintStore {
  get(pageKey: string): Promise<PageBlueprint | undefined>;
  put(blueprint: PageBlueprint): Promise<void>;
  list(limit?: number): Promise<PageBlueprint[]>;
}

// ── File-based blueprint store ────────────────────────────────────────────────

/** Durable, offline-only blueprint storage. One hashed file per page key. */
export class FileLocatorBlueprintStore implements LocatorBlueprintStore {
  constructor(private readonly folder: string) {}

  async get(pageKey: string): Promise<PageBlueprint | undefined> {
    try {
      const filePath = this.pathFor(pageKey);
      const fileInfo = await stat(filePath).catch(() => undefined);
      if (!fileInfo || fileInfo.size > MAX_BLUEPRINT_FILE_SIZE) return undefined;
      const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<PageBlueprint>;
      if (
        parsed.schemaVersion !== 1 ||
        parsed.pageKey !== pageKey ||
        !Array.isArray(parsed.elements) ||
        typeof parsed.canonicalUrl !== "string"
      ) {
        return undefined;
      }
      return parsed as PageBlueprint;
    } catch {
      return undefined;
    }
  }

  async put(blueprint: PageBlueprint): Promise<void> {
    await mkdir(this.folder, { recursive: true });
    const serialized = `${JSON.stringify(blueprint, null, 2)}\n`;
    if (serialized.length > MAX_BLUEPRINT_FILE_SIZE) {
      throw new Error(
        `Blueprint for page "${blueprint.canonicalUrl}" exceeds the ${MAX_BLUEPRINT_FILE_SIZE}-byte limit ` +
          `(${serialized.length} bytes, ${blueprint.elements.length} elements). Reduce the element count.`
      );
    }
    const target = this.pathFor(blueprint.pageKey);
    const temp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    await writeFile(temp, serialized, "utf8");
    try {
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async list(limit = 500): Promise<PageBlueprint[]> {
    let names: string[];
    try {
      names = await readdir(this.folder);
    } catch {
      return [];
    }
    const blueprints: PageBlueprint[] = [];
    for (const name of names) {
      if (blueprints.length >= limit) break;
      if (!name.endsWith(".json")) continue;
      try {
        const filePath = join(this.folder, name);
        const fileInfo = await stat(filePath).catch(() => undefined);
        if (!fileInfo || fileInfo.size > MAX_BLUEPRINT_FILE_SIZE) continue;
        const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<PageBlueprint>;
        if (
          parsed.schemaVersion !== 1 ||
          typeof parsed.pageKey !== "string" ||
          !Array.isArray(parsed.elements) ||
          typeof parsed.canonicalUrl !== "string"
        ) {
          continue;
        }
        blueprints.push(parsed as PageBlueprint);
      } catch {
        continue;
      }
    }
    return blueprints;
  }

  private pathFor(pageKey: string): string {
    const digest = createHash("sha256").update(pageKey).digest("hex");
    return join(this.folder, `${digest}.json`);
  }
}
