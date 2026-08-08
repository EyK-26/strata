import { runWithMembershipContext } from "./membershipContext";
import type { Middleware } from "../http/middleware";

function createMembershipContextMiddleware(): Middleware {
  return async (_request: Request, next: () => Promise<Response>) => {
    return await runWithMembershipContext(async () => await next());
  };
}

export { createMembershipContextMiddleware };
