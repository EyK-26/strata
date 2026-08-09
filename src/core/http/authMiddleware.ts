import { type AuthUser, authContext, runWithAuthUser } from "@getstrata/core/auth/authContext";
import type { AuthManager } from "@getstrata/core/auth/guard";

function createAuthMiddleware(auth: AuthManager) {
  return async (request: Request, next: () => Promise<Response>) => {
    const user = await auth.resolve(request);

    return await runWithAuthUser(user, async () => {
      const response = await next();

      if (user) {
        const headers = new Headers(response.headers);
        headers.set("x-authenticated-user-id", String(user.id));
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }

      return response;
    });
  };
}

export type { AuthUser };
export { authContext, createAuthMiddleware };
