/**
 * The step content digest that binds a visual-baseline approval to its step (Phase N, N6.3; plan VA-5).
 *
 * SHA-256 over the canonical JSON of the step EXCLUDING fields that do not change what is asserted:
 * `mode` (observe/enforce; promoting a step keeps its approval), the display `name` and `description`,
 * and the canvas `position`. Every other field, including the locator and its alternatives, page alias
 * and frame chain, is covered, so any targeting change is `binding-changed`. Conservative by design:
 * a change to a field that does not affect the image (a timeout, say) also purges the approval.
 *
 * N6.4 must compute the digest it binds candidates to with this same function.
 */

import { createHash } from "node:crypto";

export const VISUAL_STEP_DIGEST_EXCLUDED_FIELDS: readonly string[] = ["mode", "name", "description", "position"];

/** Canonical JSON: object keys sorted, `undefined` members dropped, arrays in order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? "null" : canonicalJson(item))).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

/** `<64 lowercase hex>` content digest of one flow step. */
export function visualStepContentDigest(step: { id: string } & Record<string, unknown>): string {
  const covered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(step)) {
    if (!VISUAL_STEP_DIGEST_EXCLUDED_FIELDS.includes(key)) covered[key] = value;
  }
  return createHash("sha256").update(`awkit-n6-step-content-v1\u0000${canonicalJson(covered)}`, "utf8").digest("hex");
}
