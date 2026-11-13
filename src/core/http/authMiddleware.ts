import { type AuthUser, authContext, runWithAuthContext } from "@getstrata/core/auth/authContext";
import { validatedAuthOutcome } from "../auth/authOutcome";
import type { AuthReader } from "../auth/authReader";
import { InternalServerError, UnauthorizedError } from "../errors/http";

function createAuthMiddleware(auth: AuthReader) {
  return async (request: Request, next: () => Promise<Response>) => {
    const resolved = validatedAuthOutcome(await auth.authenticate(request));
    if (resolved.status === "error")
      throw Object.assign(new InternalServerError(), { cause: resolved.error });
    if (resolved.status === "invalid") throw new UnauthorizedError();

    return await runWithAuthContext(resolved.user, resolved.credentialSource, async () => {
      return await next();
    });
  };
}

export type { AuthUser };
export { authContext, createAuthMiddleware };
