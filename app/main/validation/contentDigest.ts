/**
 * The trusted boundary that computes Legacy Compatibility content digests.
 *
 * A grant changes **execution eligibility**, so its binding to a flow's content must be
 * collision-resistant: with a non-cryptographic hash, a crafted flow could be made to collide with
 * a granted one and inherit its exemption. The digest is therefore SHA-256.
 *
 * It lives here, not in `src/validation/`, because `src/` is framework-agnostic and may not import
 * Node built-ins (`src/AGENTS.md`) — `node:crypto` is only available on this side. The *canonical
 * form* being digested stays pure and deterministic in `LegacyCompatibility.canonicalFlowContent`,
 * so the exact bytes are defined once and shared by every caller.
 */
import { createHash } from "node:crypto";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import { DIGEST_PREFIX, canonicalFlowContent, type FlowContentDigest } from "@src/validation/LegacyCompatibility";

/**
 * `sha256:<64 lowercase hex>` over the flow's canonical executable content
 * (`{version, nodes, edges}`). The algorithm prefix makes stored records self-identifying, so a
 * future upgrade can retire an older format instead of silently misreading it.
 */
export const sha256FlowDigest: FlowContentDigest = (profile: FlowProfile): string =>
  `${DIGEST_PREFIX}${createHash("sha256").update(canonicalFlowContent(profile), "utf8").digest("hex")}`;
