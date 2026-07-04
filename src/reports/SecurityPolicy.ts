const blockedPatterns = [
  /bypass\s+(captcha|mfa|2fa|bot)/i,
  /disable\s+(captcha|mfa|2fa|bot)/i,
  /fake\s+account/i,
  /\bspam\b/i,
  /\bexploit\b/i,
  /unauthorized/i,
  /ignore\s+(rate\s+limit|restriction)/i
];

export interface SecurityPolicyIssue {
  severity: "error" | "warning";
  message: string;
}

export class SecurityPolicy {
  validateText(text: string): SecurityPolicyIssue[] {
    return blockedPatterns
      .filter((pattern) => pattern.test(text))
      .map(() => ({
        severity: "error" as const,
        message: "Automation must not bypass CAPTCHA/MFA, restrictions, bot detection, or authorization controls."
      }));
  }
}
