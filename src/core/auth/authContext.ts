import { createAsyncContextStore } from "../runtime/asyncContextStore";

type CredentialSource = "session" | "bearer" | "basic" | "guest" | null;

type AuthUser = {
  id: number | string;
  role?: string;
  abilities?: string[];
  tokenId?: number;
  emailVerifiedAt?: Date | string | null;
};

const authContext = createAsyncContextStore<AuthUser | null>("@getstrata/authContext");
const credentialSourceContext = createAsyncContextStore<CredentialSource>(
  "@getstrata/credentialSource",
);

function runWithAuthUser<T>(user: AuthUser | null, callback: () => T | Promise<T>): T | Promise<T> {
  return authContext.run(user, callback);
}

function runWithAuthContext<T>(
  user: AuthUser | null,
  credentialSource: CredentialSource,
  callback: () => T | Promise<T>,
): T | Promise<T> {
  return authContext.run(user, () => credentialSourceContext.run(credentialSource, callback));
}

function currentAuthUser(): AuthUser | null {
  return authContext.getStore() ?? null;
}

function currentCredentialSource(): CredentialSource {
  return credentialSourceContext.getStore() ?? null;
}

export type { AuthUser, CredentialSource };
export {
  authContext,
  currentAuthUser,
  currentCredentialSource,
  runWithAuthContext,
  runWithAuthUser,
};
