/**
 * Phase N, N4.3 (awkit-vra.13.3, RV-3): the namespace key a Recorder-seeded visual reference is stored under in the
 * unchanged `VisualReferenceStore` (`visual-references/`). PURE: it imports nothing, so the Recorder's save path writes
 * and the runner (N4.6) reads the same key without either reaching anything else.
 *
 * Non-collision with the runner's own keys. A runner reference key is `LocatorFactory.scopeKey`, which always joins its
 * three parts with two NUL characters (U+0000). This key is a fixed prefix plus `JSON.stringify` of a string array, and
 * JSON escapes every character from U+0000 to U+001F, so it never contains a NUL whatever the ids hold: the two key
 * spaces are disjoint, and a recorded key never satisfies the replay-proof scope check (`replayProofScopeMatches`),
 * which needs exactly three NUL-separated parts. The JSON array also makes the key injective: distinct
 * (flow, step, binding) triples give distinct keys, with no separator an id could forge.
 *
 * The binding digest is the step's candidate digest (`stepCandidatesDigest`) when the reference was captured, so a
 * re-targeted step reads `missing` for its old reference instead of comparing against another element's evidence.
 */
export const RECORDED_VISUAL_REFERENCE_KEY_PREFIX = "awkit:recorded-visual-reference:v1:";

export function recordedVisualReferenceKey(flowId: string, stepId: string, bindingDigest: string): string {
  return RECORDED_VISUAL_REFERENCE_KEY_PREFIX + JSON.stringify([flowId, stepId, bindingDigest]);
}
