/**
 * Phase L L2 strategy chooser: promote the user's preferred strategy (role and name, text, or test id)
 * to primary when the page proved it globally unique and non-positional for the element. Otherwise the
 * adaptive choice stands and the quality warning says so. Guarded-positional and container-scoped
 * captures carry no evidence, so a preference can never displace them.
 */
import type { LocatorCandidate } from "@src/profiles/FlowProfile";
import type { LocatorRecordingMode, RecordedActionLocator, RecordedPreferenceCandidate } from "./RecorderTypes";

export type PreferredLocatorStrategy = Exclude<LocatorRecordingMode, "default" | "xpath">;

const LABEL: Readonly<Record<PreferredLocatorStrategy, string>> = { role: "role and name", text: "text", testId: "test id" };
const MAX_ALTERNATIVES = 3;

const candidateOf = (source: LocatorCandidate): LocatorCandidate => ({
  strategy: source.strategy,
  value: source.value,
  ...(source.name ? { name: source.name } : {}),
  ...(source.exact ? { exact: true } : {})
});

export function applyPreferredLocatorStrategy(
  locator: RecordedActionLocator,
  evidence: RecordedPreferenceCandidate[] | undefined,
  preferred: PreferredLocatorStrategy
): void {
  if (locator.strategy === preferred) return;
  const promoted = evidence?.find((candidate) => candidate.strategy === preferred);
  if (!promoted) {
    if (locator.quality && !locator.quality.warning) {
      locator.quality = { ...locator.quality, warning: `No unique ${LABEL[preferred]} locator for this element; the adaptive choice was kept.` };
    }
    return;
  }

  const previous = candidateOf(locator as LocatorCandidate);
  const next = candidateOf(promoted);
  const same = (candidate: LocatorCandidate) =>
    candidate.strategy === next.strategy && candidate.value === next.value && (candidate.name ?? "") === (next.name ?? "");
  locator.strategy = next.strategy;
  locator.value = next.value;
  if (next.name) locator.name = next.name;
  else delete locator.name;
  if (next.exact) locator.exact = true;
  else delete locator.exact;
  // The adaptive primary becomes the first runtime fallback.
  locator.alternatives = [previous, ...(locator.alternatives ?? []).filter((candidate) => !same(candidate))].slice(0, MAX_ALTERNATIVES);
  if (locator.quality) {
    const { warning: _warning, disambiguation: _disambiguation, ...quality } = locator.quality;
    locator.quality = {
      ...quality,
      strategy: next.strategy,
      isUnique: true,
      matchCount: 1,
      ...(typeof promoted.visibleMatchCount === "number" ? { visibleMatchCount: promoted.visibleMatchCount } : {}),
      confidence: "high"
    };
  }
  if (locator.identity) locator.identity = { ...locator.identity, primary: next };
}
