import { createAsyncContextStore } from "../runtime/asyncContextStore";

type AuthUser = {
  id: number | string;
  role?: string;
  abilities?: string[];
  tokenId?: number;
};

const authContext = createAsyncContextStore<AuthUser | null>("@getstrata/authContext");

function runWithAuthUser<T>(user: AuthUser | null, callback: () => T | Promise<T>): T | Promise<T> {
  return authContext.run(user, callback);
}

function currentAuthUser(): AuthUser | null {
  return authContext.getStore() ?? null;
}

export type { AuthUser };
export { authContext, currentAuthUser, runWithAuthUser };
