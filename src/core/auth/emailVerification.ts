import type { AuthUser } from "./authContext";

function isEmailVerificationRequired(env: Readonly<Record<string, string | undefined>>): boolean {
  return (env.FEATURE_EMAIL_VERIFICATION ?? "false") === "true";
}

/** Missing, undefined, or null means unverified. */
function hasVerifiedEmail(user: AuthUser): boolean {
  return user.emailVerifiedAt != null;
}

export { hasVerifiedEmail, isEmailVerificationRequired };
