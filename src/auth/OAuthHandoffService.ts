/**
 * OAuth / protected-login handoff capabilities. This is foundation-only: it never fabricates
 * tokens, never reports a fake OAuth success, and never transfers UI cookies into Playwright.
 * OAuth is only "available" when a project provides real OAuth configuration via env.
 */
export interface ProtectedLoginCapabilities {
  oauthConfigured: boolean;
  loadSessionSupported: boolean;
  testSessionSupported: boolean;
  reasons: {
    oauth: string;
    savedSession: string;
    testSession: string;
  };
}

export class OAuthHandoffService {
  /** Capabilities reported to the handoff UI so unsupported options are disabled with a reason. */
  getCapabilities(): ProtectedLoginCapabilities {
    const oauthConfigured = Boolean(process.env.WFS_OAUTH_CLIENT_ID && process.env.WFS_OAUTH_AUTH_URL);
    return {
      oauthConfigured,
      // Load Session (reusing a saved storageState in a new run) is not implemented yet.
      loadSessionSupported: false,
      // No configured backend-generated/mock test session source exists.
      testSessionSupported: false,
      reasons: {
        oauth: oauthConfigured ? "" : "OAuth is not configured for this project.",
        savedSession: "Load Session is not implemented yet.",
        testSession: "No configured test session is available."
      }
    };
  }

  /**
   * Build a provider-approved OAuth authorize URL to open in the SYSTEM browser — only when OAuth
   * is configured. Returns null otherwise (the caller shows "OAuth is not configured"). This is for
   * API/provider-approved auth, not for copying Google UI cookies into the automation browser.
   */
  getAuthorizeUrl(provider: string): string | null {
    const caps = this.getCapabilities();
    if (!caps.oauthConfigured) return null;
    const base = process.env.WFS_OAUTH_AUTH_URL as string;
    const clientId = process.env.WFS_OAUTH_CLIENT_ID as string;
    const redirect = process.env.WFS_OAUTH_REDIRECT_URI ?? "";
    try {
      const url = new URL(base);
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", process.env.WFS_OAUTH_SCOPE ?? "openid email profile");
      if (redirect) url.searchParams.set("redirect_uri", redirect);
      return url.toString();
    } catch {
      return null;
    }
  }
}

export const oauthHandoffService = new OAuthHandoffService();
