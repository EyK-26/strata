import { resolveUserId } from "@getstrata/core/auth/accessControl";
import { currentAuthUser } from "@getstrata/core/auth/authContext";
import { hasFreshPasswordConfirmation } from "@getstrata/core/auth/passwordConfirmCookie";
import { HttpError, UnauthorizedError } from "@getstrata/core/errors/http";
import { errorResponse } from "@getstrata/core/http/response";
import { requestPrefersJson } from "./contentNegotiation";
import type { Middleware } from "./middleware";
import { sanitizeInternalPath } from "./safeInternalPath";

const PASSWORD_CONFIRM_MESSAGE = "Password confirmation required.";
const PASSWORD_CONFIRM_PATH = "/confirm-password";

function createRequirePasswordConfirmMiddleware(): Middleware {
  return async (request: Request, next: () => Promise<Response>) => {
    const user = currentAuthUser();

    if (!user) {
      if (requestPrefersJson(request)) {
        return errorResponse(new UnauthorizedError("Authentication required."));
      }

      return Response.redirect("/login", 302);
    }

    const userId = resolveUserId(user);

    if (hasFreshPasswordConfirmation(request, userId, user.authVersion)) {
      return await next();
    }

    if (requestPrefersJson(request)) {
      return errorResponse(new HttpError(423, PASSWORD_CONFIRM_MESSAGE));
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
