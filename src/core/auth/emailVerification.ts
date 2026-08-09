import type { AuthUser } from "./authContext";

function isEmailVerificationRequired(): boolean {
  return (process.env.FEATURE_EMAIL_VERIFICATION ?? "false") === "true";
}

/** `null` is unverified. Missing/`undefined` (GuestGuard, legacy tokens) is treated as verified. */
function hasVerifiedEmail(user: AuthUser): boolean {
  return user.emailVerifiedAt !== null;
}

export { hasVerifiedEmail, isEmailVerificationRequired };
