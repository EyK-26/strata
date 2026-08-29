import { currentAuthUser } from "@getstrata/core/auth/authContext";
import {
  hasVerifiedEmail,
  isEmailVerificationRequired,
} from "@getstrata/core/auth/emailVerification";
import type { AuthManager } from "@getstrata/core/auth/guard";
import { requestPrefersJson } from "./contentNegotiation";
import type { Middleware } from "./middleware";

const UNVERIFIED_MESSAGE = "Your email address is not verified.";
const VERIFY_NOTICE_PATH = "/email/verify";

function createRequireVerifiedMiddleware(auth?: AuthManager): Middleware {
  return async (request: Request, next: () => Promise<Response>) => {
    if (!isEmailVerificationRequired()) {
      return await next();
    }

    const user = currentAuthUser() ?? (auth ? await auth.resolve(request) : null);

    if (!user || hasVerifiedEmail(user)) {
      return await next();
    }

    if (requestPrefersJson(request)) {
      return Response.json({ error: UNVERIFIED_MESSAGE }, { status: 403 });
    }

    return Response.redirect(VERIFY_NOTICE_PATH, 302);
  };
}

export { createRequireVerifiedMiddleware, UNVERIFIED_MESSAGE, VERIFY_NOTICE_PATH };
