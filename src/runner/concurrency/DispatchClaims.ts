/**
 * Resource claims an instance must hold while it runs, acquired at dispatch time and released
 * when the instance finishes. Semaphore capacities come from the lock manager's kind-prefix
 * table (`origin:*` → AWKIT_MAX_PER_ORIGIN, `account:*` → AWKIT_MAX_PER_ACCOUNT), so saturating
 * one origin/account only queues instances that target it — others dispatch normally.
 */
import type { FlowProfile } from "@src/profiles/FlowProfile";
import { resourceKey, type ResourceClaim } from "./ResourceKey";

export interface DispatchClaimInput {
  /** Instance browser config subset relevant to claims. */
  baseUrl?: string;
  envFile?: string;
  /** Flows in workflow order — used to derive the target origin from the first goto step. */
  flows?: Pick<FlowProfile, "nodes">[];
}

/** Extract the hostname the run will hit: explicit baseUrl first, else the first goto URL. */
export function deriveTargetOrigin(input: DispatchClaimInput): string | undefined {
  const candidates: string[] = [];
  if (input.baseUrl) candidates.push(input.baseUrl);
  for (const flow of input.flows ?? []) {
    for (const node of flow.nodes) {
      if (node.type === "goto" && (node.url || node.value)) {
        candidates.push((node.url ?? node.value)!);
        break;
      }
    }
    if (candidates.length > (input.baseUrl ? 1 : 0)) break;
  }
  for (const candidate of candidates) {
    try {
      return new URL(candidate).hostname.toLowerCase();
    } catch {
      // Dynamic/templated URLs (${...}) can't be claimed statically — skip.
    }
  }
  return undefined;
}

/**
 * Build the semaphore claims for one instance dispatch. Returns an empty list when nothing is
 * claimable (no derivable origin, no account key) — dispatch then relies on the global caps only.
 */
export function buildDispatchClaims(input: DispatchClaimInput): ResourceClaim[] {
  const claims: ResourceClaim[] = [];
  const origin = deriveTargetOrigin(input);
  if (origin) {
    claims.push({ key: resourceKey("origin", origin), mode: "semaphore", reason: "per-origin dispatch cap" });
  }
  if (input.envFile) {
    claims.push({ key: resourceKey("account", input.envFile), mode: "semaphore", reason: "per-account dispatch cap" });
  }
  return claims;
}
