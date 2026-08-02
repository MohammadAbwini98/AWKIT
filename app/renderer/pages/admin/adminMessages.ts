/** Safe, user-facing messages for admin reason codes (never leaks internal detail). */
export function adminReasonMessage(reason: string | undefined, errors?: string[]): string {
  const base = (() => {
    switch (reason) {
      case "NOT_AUTHORIZED":
        return "You don't have permission to do that.";
      case "REAUTH_REQUIRED":
        return "Please confirm your password to continue.";
      case "LAST_ACTIVE_SUPER_USER":
        return "You can't remove the last active Super User.";
      case "PROTECTED_SUPER_USER":
        return "The primary Super User can't be disabled, archived, or demoted.";
      case "USERNAME_TAKEN":
        return "That username is already taken.";
      case "USER_NOT_FOUND":
        return "That user no longer exists.";
      case "INVALID_ROLE":
        return "Invalid role selection.";
      case "ISSUER_ROLE_EXCLUSIVE":
        return "Issuer must be the user's only role.";
      case "ISSUER_ROLE_ASSIGNED":
        return "The Issuer role is already assigned to another user.";
      case "INVALID_PERMISSION":
        return "Invalid permission selection.";
      case "ROLE_NAME_TAKEN":
        return "That role name is already in use.";
      case "ROLE_NOT_FOUND":
        return "That custom role no longer exists.";
      case "BUILT_IN_ROLE":
        return "Built-in roles can't be changed.";
      case "PASSWORD_POLICY":
        return "That password doesn't meet the policy.";
      case "USERNAME_INVALID":
        return "That username isn't allowed.";
      case "SESSION_EXPIRED":
        return "Your session expired. Please sign in again.";
      case "INVALID_CREDENTIALS":
        return "Incorrect password.";
      default:
        return "Something went wrong. Please try again.";
    }
  })();
  return errors && errors.length ? `${base} ${errors.join(" ")}` : base;
}
