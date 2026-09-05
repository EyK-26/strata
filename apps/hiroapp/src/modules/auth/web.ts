import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { isEmailVerificationRequired } from "@getstrata/core/auth/emailVerification";
import { clearIntendedUrlCookie, readIntendedUrl } from "@getstrata/core/auth/intendedUrlCookie";
import { verifyPassword } from "@getstrata/core/auth/password";
import { hasValidSignature } from "@getstrata/core/http/signedUrl";
import { redirectResponse } from "@getstrata/core/view";
import { redirectWithCookies, sessionMetaFromRequest } from "../../http/cookies.ts";
import { authManager, requireCurrentUser } from "../../http/currentUser.ts";
import { renderPage } from "../../http/view.ts";
import { wrapLoginWeb, wrapWeb, wrapWebGuest, wrapWebUnverified } from "../../http/wrap.ts";
import { toSessionUser } from "../../lib/sessionUser.ts";
import { createMfaChallengeCookie } from "../account/mfaChallenge.ts";
import { accountService } from "../account/service.ts";
import { users } from "../users/repository.ts";

export function authWebRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/login": {
      GET: wrapWebGuest(dependencies, async (request) =>
        renderPage(request, "auth/login", { errors: {} }, 200, false),
      ),
      POST: wrapLoginWeb(dependencies, async (request) => {
        const { fields } = await parseFormBody(request);
        const email = (fields.email ?? "").trim().toLowerCase();
        const password = fields.password ?? "";
        const errors: Record<string, string> = {};
        if (!email) errors.email = "The email field is required.";
        if (!password) errors.password = "The password field is required.";
        if (Object.keys(errors).length > 0) {
          return renderPage(request, "auth/login", { errors, email }, 422, false);
        }
        const user = await users.findByEmail(email);
        if (!user || !(await verifyPassword(password, user.password))) {
          return renderPage(
            request,
            "auth/login",
            { errors: { email: "These credentials do not match our records." }, email },
            422,
            false,
          );
        }
        if (accountService.staffRequiresMfa(user)) {
          return redirectWithCookies("/two-factor-challenge", [createMfaChallengeCookie(user.id)]);
        }
        const nextPath = readIntendedUrl(request) ?? "/";
        const signedIn = await authManager().signIn(
          toSessionUser(user),
          sessionMetaFromRequest(request),
        );
        return redirectWithCookies(nextPath, [signedIn.setCookie, clearIntendedUrlCookie()]);
      }),
    },
    "/logout": {
      POST: wrapWebUnverified(dependencies, async (request) =>
        authManager().signOutRedirect(request, "/login", 302),
      ),
    },
    "/email/verify": {
      GET: wrapWeb(dependencies, async (request) => {
        if (hasValidSignature(request)) {
          const userId = Number(new URL(request.url).searchParams.get("id"));
          if (Number.isInteger(userId) && userId > 0) {
            await accountService.markEmailVerified(userId);
          }
          return redirectResponse("/");
        }
        if (!isEmailVerificationRequired()) {
          return redirectResponse("/");
        }
        const user = await requireCurrentUser(request).catch(() => null);
        if (!user) {
          return redirectResponse("/login");
        }
        return renderPage(request, "auth/verify-email", { email: user.email }, 200, false);
      }),
    },
    "/email/verification-notification": {
      POST: wrapWebUnverified(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        await accountService.sendVerificationEmail(user);
        return redirectResponse("/email/verify");
      }),
    },
  };
}
