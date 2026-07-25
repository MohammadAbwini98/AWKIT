/**
 * Semantic-specific redaction (plan §9.2).
 *
 * **Why this is not just `SecretMasker`.** The existing `SecretMasker.maskText` normalizes exactly
 * three things: `key=value` query-style assignments, `Bearer …` headers, and literal values that
 * were explicitly registered for a run. That is correct for its job (masking run logs, where the
 * shapes are known) but it is NOT a general sanitizer — `token-SECRET`, a JSON `"token": "…"` pair,
 * a URL query string, and a raw connection string all pass straight through it.
 *
 * So this module COMPOSES `SecretMasker` (to inherit registered run secrets, which no pattern can
 * infer) and adds the semantic-specific rules on top. The ordering inside `redactText` matters and
 * is commented at each step.
 *
 * **This is still a mitigation, not a guarantee.** Pattern-based redaction can only remove what it
 * recognises. The structural control is `SemanticProjection`'s allowlist, which decides what is
 * ever read; redaction is the second layer, and `SemanticPolicyValidator` independently re-scans
 * the result as the third. If you find yourself wanting to add a pattern here so that some new
 * field can be indexed, add the exclusion to the projection allowlist instead.
 *
 * Framework-agnostic: no Electron, no filesystem.
 */

import { SecretMasker } from "../reports/SecretMasker";

export const REDACTED = "[redacted]";

export interface SemanticRedactionPolicy {
  /** Replace email addresses. Default true. */
  redactEmails?: boolean;
  /** Replace digit runs at or above this length (account/card/order numbers). Default 6. */
  minNumericIdentifierLength?: number;
  /** Extra user-defined sensitive terms, matched case-insensitively as whole words. */
  customSensitiveTerms?: readonly string[];
  /** Hard cap applied after redaction. Default 8000. */
  maxContentLength?: number;
}

const DEFAULT_POLICY: Required<Omit<SemanticRedactionPolicy, "customSensitiveTerms">> & {
  customSensitiveTerms: readonly string[];
} = {
  redactEmails: true,
  minNumericIdentifierLength: 6,
  customSensitiveTerms: [],
  maxContentLength: 8000
};

/** Keys whose VALUE is sensitive whatever the surrounding syntax. */
const SENSITIVE_KEY = "(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|auth|cookie|session|credential|client[_-]?secret|private[_-]?key|otp|mfa|pin)";

/**
 * Ordered redaction rules.
 *
 * Order is significant: structured forms (JSON pairs, connection strings, URLs) are handled BEFORE
 * the loose `key<sep>value` rule, because the loose rule would otherwise consume part of a
 * structured match and leave a mangled remainder that later rules no longer recognise.
 */
const RULES: ReadonlyArray<{ pattern: RegExp; replace: string; note: string }> = [
  // 1. Whole URLs first — a URL can carry credentials in userinfo, query AND fragment, and later
  //    rules would only catch one of the three.
  {
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi,
    replace: REDACTED,
    note: "url"
  },
  // 2. Authorization SCHEMES before the generic key/value rule.
  //
  //    Ordering hazard, found by test: `Authorization: Basic <base64>` matches the structured
  //    key/value rule too (`authorization` is a sensitive key, and `Basic` is a plausible value),
  //    which consumed `Authorization: Basic` and left the base64 payload exposed. The scheme rule is
  //    the more specific match and must win. Anything left over (`Authorization: [redacted]`) is
  //    still caught by rule 4 afterwards.
  {
    pattern: /\b(?:Bearer|Basic|Digest|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    replace: REDACTED,
    note: "auth scheme"
  },
  // 3. JWTs, which carry claims even when unlabelled. Before the generic blob rule so the more
  //    specific classification wins.
  {
    pattern: /\beyJ[A-Za-z0-9._-]{10,}/g,
    replace: REDACTED,
    note: "jwt"
  },
  // 4. JSON / YAML style: "token": "value"  |  token: value
  {
    pattern: new RegExp(`("?)\\b${SENSITIVE_KEY}\\1\\s*[:=]\\s*"?[^"\\s,;}{&]+"?`, "gi"),
    replace: REDACTED,
    note: "structured key/value"
  },
  // 5. Connection-string password segments (Oracle/JDBC/ODBC shapes).
  {
    pattern: /\b(?:password|pwd)\s*=\s*[^;,\s]+/gi,
    replace: REDACTED,
    note: "connection string"
  },
  // 6. The hyphen/underscore/space-delimited form that SecretMasker misses entirely
  //    (`token-SECRET`, `api_key SECRET`).
  {
    pattern: new RegExp(`\\b${SENSITIVE_KEY}[-_ ][A-Za-z0-9._~+/=-]{4,}`, "gi"),
    replace: REDACTED,
    note: "delimited secret"
  },
  {
    pattern: /\b[A-Za-z0-9+/]{40,}={0,2}\b/g,
    replace: REDACTED,
    note: "long opaque blob"
  },
  // 7. Windows/UNC/POSIX absolute paths — Phase 0 found vendor errors embed absolute paths, and a
  //    path discloses the username.
  {
    pattern: /\b[A-Za-z]:\\[^\s"'<>|]+/g,
    replace: REDACTED,
    note: "windows path"
  },
  { pattern: /\\\\[^\s"'<>|]+/g, replace: REDACTED, note: "unc path" },
  { pattern: /(?:^|\s)\/(?:home|users|var|etc|tmp|opt)\/[^\s"'<>|]+/gi, replace: ` ${REDACTED}`, note: "posix path" }
];

export class SemanticRedactor {
  private readonly policy: typeof DEFAULT_POLICY;
  private readonly masker: SecretMasker;

  constructor(policy: SemanticRedactionPolicy = {}, masker: SecretMasker = new SecretMasker()) {
    this.policy = { ...DEFAULT_POLICY, ...policy, customSensitiveTerms: policy.customSensitiveTerms ?? [] };
    this.masker = masker;
  }

  /**
   * Redact free text.
   *
   * `SecretMasker` runs FIRST so that values registered for the current run (which no pattern could
   * infer — they are arbitrary strings the user supplied) are removed before the generic rules
   * reshape the surrounding text and potentially break the literal match.
   */
  redactText(input: string): string {
    if (!input) return "";

    let text = this.masker.maskText(input);

    for (const rule of RULES) {
      text = text.replace(rule.pattern, rule.replace);
    }

    for (const term of this.policy.customSensitiveTerms) {
      if (!term.trim()) continue;
      text = text.replace(new RegExp(escapeRegExp(term), "gi"), REDACTED);
    }

    if (this.policy.redactEmails) {
      text = text.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, REDACTED);
    }

    // Long digit runs last: earlier rules may legitimately contain digits, and running this first
    // would shred a token before its own rule could classify it.
    const minDigits = Math.max(1, this.policy.minNumericIdentifierLength);
    text = text.replace(new RegExp(`\\b\\d{${minDigits},}\\b`, "g"), REDACTED);

    // Collapse runs of adjacent redactions so a heavily-masked line stays readable.
    text = text.replace(new RegExp(`(?:${escapeRegExp(REDACTED)}[\\s,;:-]*){2,}`, "g"), `${REDACTED} `);

    return text.replace(/[ \t]{2,}/g, " ").trim().slice(0, this.policy.maxContentLength);
  }

  /** Redact every string in a projected record, recursing through arrays and nested objects. */
  redactRecord(record: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      out[key] = this.redactValue(value);
    }
    return out;
  }

  private redactValue(value: unknown): unknown {
    if (typeof value === "string") return this.redactText(value);
    if (Array.isArray(value)) return value.map((v) => this.redactValue(v));
    if (value && typeof value === "object") return this.redactRecord(value as Record<string, unknown>);
    return value;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
