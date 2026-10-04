import type { Frame } from "playwright";

import type { LocatorElementFingerprint } from "@src/profiles/FlowProfile";

import { createFingerprintHasher } from "../locatorFingerprint";
import { SNAPSHOT_PRUNED_CAP } from "../recoverySnapshot";
import { DOM_INTELLIGENCE_LIMITS } from "./DomIntelligenceProvider";
import { DOM_SNAPSHOT_SERIALIZER_BODY } from "./pageScripts";

/**
 * One bounded DOM snapshot of a resolved frame (plan E6): sanitized HTML for a provider, with every
 * visible element indexed into `frame.locator("body *")`, plus AWKIT's own pruned fingerprints of the
 * same elements for the proof. One `evaluateAll`, one round trip.
 */

export interface DomSnapshot {
  refused?: undefined;
  html: string;
  truncated: boolean;
  elements: number;
  visible: number;
  /** Hashed fingerprints of visible elements sharing the expected tag or role, by `body *` index. */
  candidates: Array<{ index: number; fingerprint: LocatorElementFingerprint }>;
  /** More pruned elements than the cap: a margin over this set would prove nothing. */
  candidatesTruncated: boolean;
  hiddenDropped: number;
  title: string;
  ms: number;
}

export interface RefusedDomSnapshot {
  refused: "protected-login";
  ms: number;
}

export interface DomSnapshotOptions {
  mode: "recover" | "normalize";
  /** The recorded identity's tag and role; omit to skip the fingerprint pass (normalization). */
  expected?: Pick<LocatorElementFingerprint, "tag" | "role">;
  maxBytes?: number;
  /** L12.17: a Super User's opted-in diagnosis of an allowed protected page. Sensitive inputs are still dropped. */
  allowProtectedDocument?: boolean;
}

interface RawSnapshot {
  refused?: "protected-login";
  html: string;
  truncated: boolean;
  elements: number;
  visible: number;
  kept: Array<{ i: number; f: LocatorElementFingerprint }>;
  keptTruncated: boolean;
  hiddenDropped: number;
  title: string;
}

interface SerializerArg {
  mode: "recover" | "normalize";
  tag?: string;
  role: string;
  cap: number;
  maxBytes: number;
  allowProtected: boolean;
}

type Serializer = (elements: Element[], arg: SerializerArg) => RawSnapshot;
let serializer: Serializer | undefined;

export async function captureDomSnapshot(frame: Frame, options: DomSnapshotOptions): Promise<DomSnapshot | RefusedDomSnapshot> {
  const started = performance.now();
  serializer ??= new Function("elements", "arg", DOM_SNAPSHOT_SERIALIZER_BODY) as Serializer;
  const raw = await frame.locator("body *").evaluateAll(serializer, {
    mode: options.mode,
    tag: options.expected?.tag,
    role: options.expected?.role ?? "",
    cap: SNAPSHOT_PRUNED_CAP,
    maxBytes: Math.min(options.maxBytes ?? DOM_INTELLIGENCE_LIMITS.maxHtmlBytes, DOM_INTELLIGENCE_LIMITS.maxHtmlBytes),
    allowProtected: options.allowProtectedDocument === true
  });
  if (raw.refused) return { refused: raw.refused, ms: performance.now() - started };
  const hash = createFingerprintHasher();
  return {
    html: raw.html,
    truncated: raw.truncated,
    elements: raw.elements,
    visible: raw.visible,
    candidates: raw.kept.map(({ i, f }) => ({ index: i, fingerprint: hash(f) })),
    candidatesTruncated: raw.keptTruncated,
    hiddenDropped: raw.hiddenDropped,
    title: raw.title,
    ms: performance.now() - started
  };
}

/** Race `work` against a deadline; the loser is ignored, never awaited past it. */
export function withDeadline<T>(work: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), Math.max(0, ms));
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
