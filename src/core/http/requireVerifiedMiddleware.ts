import { currentAuthUser } from "@getstrata/core/auth/authContext";
import {
  hasVerifiedEmail,
  isEmailVerificationRequired,
} from "@getstrata/core/auth/emailVerification";
import { createIntendedUrlCookieFromRequest } from "@getstrata/core/auth/intendedUrlCookie";
import { ForbiddenError } from "@getstrata/core/errors/http";
import { errorResponse } from "@getstrata/core/http/response";
import type { AuthReader } from "../auth/authReader";
import { requestPrefersJson } from "./contentNegotiation";
import type { Middleware } from "./middleware";

const UNVERIFIED_MESSAGE = "Your email address is not verified.";
const VERIFY_NOTICE_PATH = "/email/verify";

function createRequireVerifiedMiddleware(
  auth?: AuthReader,
  required = isEmailVerificationRequired(),
): Middleware {
  return async (request: Request, next: () => Promise<Response>) => {
    if (!required) {
      return await next();
    }

    const user = currentAuthUser() ?? (auth ? await auth.resolve(request) : null);

    if (!user || hasVerifiedEmail(user)) {
      return await next();
    }

    if (requestPrefersJson(request)) {
      return errorResponse(new ForbiddenError(UNVERIFIED_MESSAGE));
    }

    const headers = new Headers({ Location: VERIFY_NOTICE_PATH });
    const intended = createIntendedUrlCookieFromRequest(request);

    if (intended) {
      headers.append("Set-Cookie", intended);
    }

    return new Response(null, { status: 302, headers });
  };
}

export { createRequireVerifiedMiddleware, UNVERIFIED_MESSAGE, VERIFY_NOTICE_PATH };
