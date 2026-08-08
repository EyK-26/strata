import { AsyncLocalStorage } from "node:async_hooks";

type AuthUser = {
  id: number | string;
  role?: string;
};

const authContext = new AsyncLocalStorage<AuthUser | null>();

function runWithAuthUser<T>(
  user: AuthUser | null,
  callback: () => T | Promise<T>,
): T | Promise<T> {
  return authContext.run(user, callback);
}

function currentAuthUser(): AuthUser | null {
  return authContext.getStore() ?? null;
}

export { authContext, currentAuthUser, runWithAuthUser };
export type { AuthUser };
