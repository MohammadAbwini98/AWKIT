const secretKeyPattern = /(password|passwd|pwd|secret|token|api[_-]?key|authorization|cookie|session)/i;

export class SecretMasker {
  maskValue(key: string, value: unknown): unknown {
    if (secretKeyPattern.test(key)) return "[masked]";
    if (typeof value === "string" && this.looksLikeSecret(value)) return "[masked]";
    return value;
  }

  maskText(text: string): string {
    return text
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
