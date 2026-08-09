import type { Middleware } from "../http/middleware";
import { runWithMembershipContext } from "./membershipContext";

function createMembershipContextMiddleware(): Middleware {
  return async (_request: Request, next: () => Promise<Response>) => {
    return await runWithMembershipContext(async () => await next());
  };
}

export { createMembershipContextMiddleware };
