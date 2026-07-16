const secretKeyPattern = /(password|passwd|pwd|secret|token|api[_-]?key|authorization|cookie|session)/i;

/**
 * Literal secret values (from the encrypted secret store, audit §15) registered at run start so any
 * exact occurrence is scrubbed from logs/diagnostics regardless of surrounding key/pattern. Process-
 * lifetime only; values live in memory already and registering them is purely protective.
 */
const registeredSecretValues = new Set<string>();

/** Register decrypted secret values for literal masking. Values shorter than 4 chars are ignored
 *  (too likely to appear incidentally and over-mask). */
export function registerSecretValues(values: string[]): void {
  for (const value of values) {
    if (typeof value === "string" && value.length >= 4) registeredSecretValues.add(value);
  }
}

function scrubRegistered(text: string): string {
  if (!registeredSecretValues.size) return text;
  let out = text;
  for (const secret of registeredSecretValues) {
    if (out.includes(secret)) out = out.split(secret).join("[masked]");
  }
  return out;
}

export class SecretMasker {
  maskValue(key: string, value: unknown): unknown {
    if (secretKeyPattern.test(key)) return "[masked]";
    if (typeof value === "string" && registeredSecretValues.has(value)) return "[masked]";
    if (typeof value === "string" && this.looksLikeSecret(value)) return "[masked]";
    return value;
  }

  maskText(text: string): string {
    return scrubRegistered(text)
      .replace(/(password|passwd|pwd|secret|token|api[_-]?key)=([^&\s]+)/gi, "$1=[masked]")
      .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/g, "$1[masked]");
  }

  maskRecord<T extends Record<string, unknown>>(record: T): T {
    return Object.entries(record).reduce<Record<string, unknown>>((masked, [key, value]) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        masked[key] = this.maskRecord(value as Record<string, unknown>);
      } else {
        masked[key] = this.maskValue(key, value);
      }
      return masked;
    }, {}) as T;
  }

  private looksLikeSecret(value: string): boolean {
    return value.length > 24 && /[A-Za-z]/.test(value) && /\d/.test(value) && /[._~+/=-]/.test(value);
  }
}
