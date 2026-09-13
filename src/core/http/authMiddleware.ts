import {
  type AuthUser,
  authContext,
  type CredentialSource,
  runWithAuthContext,
} from "@getstrata/core/auth/authContext";
import type { AuthManager } from "@getstrata/core/auth/guard";

function createAuthMiddleware(auth: AuthManager) {
  return async (request: Request, next: () => Promise<Response>) => {
    const resolved =
      typeof auth.resolveWithSource === "function"
        ? await auth.resolveWithSource(request)
        : { user: await auth.resolve(request), credentialSource: null as CredentialSource };

    return await runWithAuthContext(resolved.user, resolved.credentialSource, async () => {
      return await next();
    });
  };
}

export type { AuthUser };
export { authContext, createAuthMiddleware };
