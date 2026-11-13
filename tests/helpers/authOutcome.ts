import type { AuthUser, CredentialSource } from "@getstrata/core/auth/authContext";
import { type AuthOutcome, absentAuth, authenticatedAuth } from "@getstrata/core/auth/guard";

/** Explicit outcomes for fixture guards; production adapters implement authenticate directly. */
async function authFixtureOutcome(
  user: AuthUser | null | Promise<AuthUser | null>,
  source: CredentialSource = "session",
): Promise<AuthOutcome> {
  const resolved = await user;
  return resolved ? authenticatedAuth(resolved, source) : absentAuth;
}

export { authFixtureOutcome };
