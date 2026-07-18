/**
 * Maps safe reason codes from the trusted layer to user-facing copy. Deliberately coarse and
 * non-revealing (never discloses whether an account exists); anything unrecognized falls back to the
 * generic administrator message. Detailed context lives only in the main-process audit log.
 *
 * See docs/plans/SECURE_LOGIN_AUTHORIZATION_LICENSING_IMPLEMENTATION_PLAN.md §22.
 */
const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: "Incorrect username or password.",
  ACCOUNT_LOCKED: "Too many attempts. This account is temporarily locked — please try again later.",
  MUST_CHANGE_PASSWORD: "You must set a new password before continuing.",
  SESSION_EXPIRED: "Your session has expired. Please sign in again.",
  NOT_PROVISIONED: "This application has not been set up yet.",
  ALREADY_PROVISIONED: "This application has already been set up.",
  PROVIDER_DISABLED: "That sign-in method isn't available yet.",
  STORAGE_UNAVAILABLE: "Secure storage is unavailable on this system, so sign-in can't proceed.",
  PASSWORD_POLICY: "That password doesn't meet the requirements.",
  USERNAME_INVALID: "That username isn't allowed."
};

export const GENERIC_MESSAGE = "Something went wrong. Please contact your system administrator.";

export function messageForReason(reason: string | undefined): string {
  if (!reason) return GENERIC_MESSAGE;
  return MESSAGES[reason] ?? GENERIC_MESSAGE;
}
