/** Query-string keys whose values are masked before a recorded URL is stored/shown. */
export const RECORDED_URL_SENSITIVE_QUERY_KEYS: ReadonlySet<string> = new Set([
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "code",
  "password",
  "secret",
  "session",
  "auth",
  "key",
  "api_key"
]);
