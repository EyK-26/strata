import { AuthAccountNotFoundError } from "@getstrata/core/contracts/authUserDirectory";
import { isAuthUserActive } from "./accountState";
import type { AuthUser, CredentialSource } from "./authContext";

type AuthOutcome =
  | Readonly<{ status: "absent"; user: null; credentialSource: null }>
  | Readonly<{ status: "invalid"; user: null; credentialSource: CredentialSource }>
  | Readonly<{ status: "authenticated"; user: AuthUser; credentialSource: CredentialSource }>
  | Readonly<{ status: "error"; user: null; credentialSource: CredentialSource; error: unknown }>;

const absentAuth: AuthOutcome = Object.freeze({
  status: "absent",
  user: null,
  credentialSource: null,
});
function invalidAuth(credentialSource: CredentialSource): AuthOutcome {
  return { status: "invalid", user: null, credentialSource };
}
function authenticatedAuth(user: AuthUser, credentialSource: CredentialSource): AuthOutcome {
  return isAuthUserActive(user)
    ? { status: "authenticated", user, credentialSource }
    : invalidAuth(credentialSource);
}
/** Validate untyped/custom adapter output before composing or establishing identity. */
function validatedAuthOutcome(input: unknown): AuthOutcome {
  if (!input || typeof input !== "object") throw new TypeError("Invalid authentication outcome.");
  const value = input as Record<string, unknown>;
  if (
    ![null, "session", "bearer", "basic", "guest"].includes(
      value.credentialSource as CredentialSource,
    )
  )
    throw new TypeError("Invalid credential source.");
  if (value.status === "absent" && value.user === null && value.credentialSource === null)
    return input as AuthOutcome;
  if (value.status === "invalid" && value.user === null) return input as AuthOutcome;
  if (value.status === "error" && value.user === null && Object.hasOwn(value, "error"))
    return input as AuthOutcome;
  if (
    value.status === "authenticated" &&
    value.user &&
    typeof value.user === "object" &&
    !Array.isArray(value.user)
  ) {
    const user = value.user as AuthUser;
    if (
      (typeof user.id === "string" && user.id.trim().length > 0) ||
      (typeof user.id === "number" && Number.isSafeInteger(user.id))
    )
      return authenticatedAuth(user, value.credentialSource as CredentialSource);
  }
  throw new TypeError("Invalid authentication outcome.");
}

function authUserFromOutcome(outcome: AuthOutcome): AuthUser | null {
  if (outcome.status === "error") throw outcome.error;
  return outcome.user;
}
async function authenticateProof(
  credentialSource: CredentialSource,
  present: boolean | (() => boolean),
  resolve: () => AuthUser | null | Promise<AuthUser | null>,
): Promise<AuthOutcome> {
  try {
    if (!(typeof present === "function" ? present() : present)) return absentAuth;
    const user = await resolve();
    return user ? authenticatedAuth(user, credentialSource) : invalidAuth(credentialSource);
  } catch (error) {
    if (error instanceof AuthAccountNotFoundError) return invalidAuth(credentialSource);
    return { status: "error", user: null, credentialSource, error };
  }
}

export type { AuthOutcome };
export {
  absentAuth,
  authenticatedAuth,
  authenticateProof,
  authUserFromOutcome,
  invalidAuth,
  validatedAuthOutcome,
};
