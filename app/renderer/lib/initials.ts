/**
 * Teams-style avatar initials — a single shared, DOM-free utility (so it is unit-verifiable under `tsx`).
 *
 * Rules (see Phase 3 of the admin/licensing package):
 * - Trim and collapse whitespace; ignore empty tokens.
 * - Unicode-aware grapheme segmentation (Intl.Segmenter), so combining marks and Arabic behave.
 * - ≥2 meaningful words → first grapheme of the first word + first grapheme of the last word.
 * - 1 word → its first two graphemes.
 * - single grapheme → that grapheme.
 * - Uppercase with the applicable locale where safe (scripts without case, e.g. Arabic, are unchanged).
 * - Skip pure-punctuation/symbol graphemes so punctuation never becomes an initial.
 * - Never derive initials from passwords, internal ids, tokens, or secrets — callers pass display text only.
 */

/** Segment a string into user-perceived characters (graphemes), with a spread fallback. */
function graphemes(input: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Segmenter) {
    const seg = new Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(seg.segment(input), (s) => s.segment);
  }
  return Array.from(input);
}

/** True when a grapheme is only punctuation/symbol/whitespace and so cannot be an initial. */
function isSkippable(grapheme: string): boolean {
  return /^[\s\p{P}\p{S}]+$/u.test(grapheme);
}

/** The first meaningful (non-punctuation) grapheme of a word, or "" when the word has none. */
function firstMeaningful(word: string): string {
  for (const g of graphemes(word)) {
    if (!isSkippable(g)) return g;
  }
  return "";
}

function upper(value: string, locale?: string): string {
  return locale ? value.toLocaleUpperCase(locale) : value.toLocaleUpperCase();
}

/** Split into meaningful words: collapse whitespace, drop tokens that are only punctuation. */
function meaningfulWords(name: string): string[] {
  return name
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0 && firstMeaningful(word) !== "");
}

/**
 * Compute the initials for a display name. Returns "" only when no meaningful character exists, so
 * callers can fall through to username / email / a generic glyph.
 */
export function initialsFromName(name: string, locale?: string): string {
  const words = meaningfulWords(name);
  if (words.length === 0) return "";

  if (words.length >= 2) {
    const first = firstMeaningful(words[0]);
    const last = firstMeaningful(words[words.length - 1]);
    return upper(first + last, locale);
  }

  // Exactly one meaningful word: use its first two meaningful graphemes (or one if that's all there is).
  const only = graphemes(words[0]).filter((g) => !isSkippable(g));
  if (only.length === 0) return "";
  if (only.length === 1) return upper(only[0], locale);
  return upper(only[0] + only[1], locale);
}

export interface AvatarIdentity {
  displayName?: string | null;
  username?: string | null;
  email?: string | null;
}

/**
 * Resolve initials from the best available identity field, in priority order:
 * display name → username → the safe local-part of an email. Falls back to "?" when nothing is usable.
 */
export function initialsFromIdentity(identity: AvatarIdentity, locale?: string): string {
  const fromDisplay = identity.displayName ? initialsFromName(identity.displayName, locale) : "";
  if (fromDisplay) return fromDisplay;

  const fromUsername = identity.username ? initialsFromName(identity.username, locale) : "";
  if (fromUsername) return fromUsername;

  if (identity.email) {
    const localPart = identity.email.split("@")[0] ?? "";
    // Treat separators in the local part as word breaks so "sarah.khalil" → "SK".
    const fromEmail = initialsFromName(localPart.replace(/[._-]+/g, " "), locale);
    if (fromEmail) return fromEmail;
  }

  return "?";
}

/**
 * Deterministic palette index for an identity, so the same user always gets the same avatar background
 * (never a new random colour each launch). Uses a stable FNV-1a hash over the most identifying field.
 */
export function avatarPaletteIndex(identity: AvatarIdentity, paletteSize: number): number {
  const key = (identity.username || identity.displayName || identity.email || "").trim().toLowerCase();
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return paletteSize > 0 ? (hash >>> 0) % paletteSize : 0;
}
