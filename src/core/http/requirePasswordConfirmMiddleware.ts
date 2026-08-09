import { resolveUserId } from "@getstrata/core/auth/accessControl";
import { currentAuthUser } from "@getstrata/core/auth/authContext";
import { hasFreshPasswordConfirmation } from "@getstrata/core/auth/passwordConfirmCookie";
import { requestPrefersJson } from "./contentNegotiation";
import type { Middleware } from "./middleware";
import { sanitizeInternalPath } from "./safeInternalPath";

const PASSWORD_CONFIRM_MESSAGE = "Password confirmation required.";
const PASSWORD_CONFIRM_PATH = "/confirm-password";

function createRequirePasswordConfirmMiddleware(): Middleware {
  return async (request: Request, next: () => Promise<Response>) => {
    const user = currentAuthUser();

    if (!user) {
      return await next();
    }

    const userId = resolveUserId(user);

    if (hasFreshPasswordConfirmation(request, userId)) {
      return await next();
    }

    if (requestPrefersJson(request)) {
      return Response.json({ error: PASSWORD_CONFIRM_MESSAGE }, { status: 423 });
    }

    const url = new URL(request.url);
    const intended = request.method === "GET" ? `${url.pathname}${url.search}` : "/account";
    const redirect = sanitizeInternalPath(intended, "/account");

    return Response.redirect(
      `${PASSWORD_CONFIRM_PATH}?redirect=${encodeURIComponent(redirect)}`,
      302,
    );
  };
}

export { createRequirePasswordConfirmMiddleware, PASSWORD_CONFIRM_MESSAGE, PASSWORD_CONFIRM_PATH };
