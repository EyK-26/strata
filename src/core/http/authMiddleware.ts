import { type AuthUser, authContext, runWithAuthContext } from "@getstrata/core/auth/authContext";
import { validatedAuthOutcome } from "@getstrata/core/auth/authOutcome";
import { InternalServerError, InvalidCredentialsError } from "@getstrata/core/errors/http";
import type { AuthReader } from "../auth/authReader";

function createAuthMiddleware(auth: Pick<AuthReader, "authenticate">) {
  return async (request: Request, next: () => Promise<Response>) => {
    const resolved = validatedAuthOutcome(await auth.authenticate(request));
    if (resolved.status === "error")
      throw Object.assign(new InternalServerError(), { cause: resolved.error });
    if (resolved.status === "invalid") throw new InvalidCredentialsError();

    return await runWithAuthContext(resolved.user, resolved.credentialSource, async () => {
      return await next();
    });
  };
}

export type { AuthUser };
export { authContext, createAuthMiddleware };
