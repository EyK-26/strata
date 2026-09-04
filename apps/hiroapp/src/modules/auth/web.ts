import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { verifyPassword } from "@getstrata/core/auth/password";
import { redirectResponse } from "@getstrata/core/view";
import { redirectWithCookies, sessionMetaFromRequest } from "../../http/cookies.ts";
import { authManager } from "../../http/currentUser.ts";
import { renderPage } from "../../http/view.ts";
import { wrapWebAuthenticated, wrapWebGuest } from "../../http/wrap.ts";
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
      POST: wrapWebGuest(dependencies, async (request) => {
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
        return authManager().signInRedirect(
          toSessionUser(user),
          "/",
          302,
          sessionMetaFromRequest(request),
        );
      }),
    },
    "/logout": {
      POST: wrapWebAuthenticated(dependencies, async (request) =>
        authManager().signOutRedirect(request, "/login", 302),
      ),
    },
  };
}

void redirectResponse;
