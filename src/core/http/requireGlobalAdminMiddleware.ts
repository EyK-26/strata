import { isGlobalAdmin } from "../auth/accessControl";
import { currentAuthUser } from "../auth/authContext";
import { ForbiddenError } from "../errors/http";
import { logSecurityEvent } from "../security/securityEvents";
import type { Middleware } from "./middleware";

function createRequireGlobalAdminMiddleware(): Middleware {
  return async (_request: Request, next: () => Promise<Response>) => {
    const user = currentAuthUser();

    if (!isGlobalAdmin(user)) {
      logSecurityEvent("privilege_escalation_blocked", {
        required_role: "platform_admin",
        path: new URL(_request.url).pathname,
      });
      const error = new ForbiddenError("Platform admin access required.");

      return Response.json({ error: error.message }, { status: error.status });
    }

    return await next();
  };
}

export { createRequireGlobalAdminMiddleware };
