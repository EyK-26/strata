import { runWithMembershipContext } from "@getstrata/core/auth/membershipContext";
import type { Middleware } from "@getstrata/core/http/middleware";

function createMembershipContextMiddleware(): Middleware {
  return async (_request: Request, next: () => Promise<Response>) => {
    return await runWithMembershipContext(async () => await next());
  };
}

export { createMembershipContextMiddleware };
