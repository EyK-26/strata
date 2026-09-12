import type { AuthUser } from "./authContext";

function isEmailVerificationRequired(): boolean {
  return (process.env.FEATURE_EMAIL_VERIFICATION ?? "false") === "true";
}

/** Missing, undefined, or null means unverified. */
function hasVerifiedEmail(user: AuthUser): boolean {
  return user.emailVerifiedAt != null;
}

export { hasVerifiedEmail, isEmailVerificationRequired };
