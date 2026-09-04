import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { verifyPassword } from "@getstrata/core/auth/password";
import { UnauthorizedError, ValidationError } from "@getstrata/core/errors/http";
import { jsonResponse } from "@getstrata/core/http/response";
import { isSpaEnabled } from "@getstrata/core/runtime/frontendMode";
import { sessionMetaFromRequest, withCookies } from "../../http/cookies.ts";
import { authManager, requireCurrentUser } from "../../http/currentUser.ts";
import { mergeResource, NotificationResource, UserResource } from "../../http/resources.ts";
import { wrapApi, wrapGuestApi } from "../../http/wrap.ts";
import { loadUserGraph } from "../../lib/loaders.ts";
import { toSessionUser } from "../../lib/sessionUser.ts";
import {
  clearMfaChallengeCookie,
  createMfaChallengeCookie,
  readMfaChallenge,
} from "../account/mfaChallenge.ts";
import { MfaCodeRequest } from "../account/requests.ts";
import { accountService } from "../account/service.ts";
import { users } from "../users/repository.ts";
import { LoginRequest } from "./requests.ts";

async function loginJson(request: Request) {
  const payload = await new LoginRequest().validate(request);
  const user = await users.findByEmail(payload.email);
  if (!user || !(await verifyPassword(payload.password, user.password))) {
    throw new ValidationError("The given data was invalid.", {
      email: ["These credentials do not match our records."],
    });
  }
  if (accountService.staffRequiresMfa(user)) {
    return jsonResponse(
      { message: "Two-factor authentication required.", mfa_required: true },
      {
        status: 423,
        headers: { "Set-Cookie": createMfaChallengeCookie(user.id) },
      },
    );
  }
  const { setCookie } = await authManager().signIn(
    toSessionUser(user),
    sessionMetaFromRequest(request),
  );
  const graph = await loadUserGraph(user);
  const body = mergeResource(new UserResource(user), {
    notifications: graph.notifications.map((row) => new NotificationResource(row).toArray()),
    position: graph.position,
  });
  return jsonResponse(body, {
    headers: { "Set-Cookie": setCookie },
  });
}

export function authRoutes(dependencies: AppDependencies): AppRouteMap {
  const routes: AppRouteMap = {
    "/api/user": {
      GET: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        const graph = await loadUserGraph(user);
        return jsonResponse(
          mergeResource(new UserResource(user), {
            notifications: graph.notifications.map((row) =>
              new NotificationResource(row).toArray(),
            ),
            position: graph.position,
          }),
        );
      }),
    },
    "/api/login": {
      POST: wrapGuestApi(dependencies, loginJson),
    },
    "/api/logout": {
      POST: wrapGuestApi(dependencies, async (request) => {
        const { setCookie } = await authManager().signOut(request);
        return jsonResponse(
          { message: "Logged out" },
          {
            headers: { "Set-Cookie": setCookie },
          },
        );
      }),
    },
    "/api/auth/two-factor-challenge": {
      POST: wrapGuestApi(dependencies, async (request) => {
        const pending = readMfaChallenge(request);
        if (!pending) {
          throw new UnauthorizedError("Two-factor authentication is not pending.");
        }
        const payload = await new MfaCodeRequest().validate(request);
        const user = await accountService.verifyMfaChallenge(pending.userId, payload.mfa_code);
        const signedIn = await authManager().signIn(
          toSessionUser(user),
          sessionMetaFromRequest(request),
        );
        const graph = await loadUserGraph(user);
        return withCookies(
          jsonResponse(
            mergeResource(new UserResource(user), {
              notifications: graph.notifications.map((row) =>
                new NotificationResource(row).toArray(),
              ),
              position: graph.position,
            }),
          ),
          [signedIn.setCookie, clearMfaChallengeCookie()],
        );
      }),
    },
  };

  if (!isSpaEnabled()) {
    return routes;
  }

  routes["/login"] = {
    POST: wrapGuestApi(dependencies, loginJson),
  };

  routes["/logout"] = {
    POST: wrapGuestApi(dependencies, async (request) => {
      const { setCookie } = await authManager().signOut(request);
      return jsonResponse(
        { message: "Logged out" },
        {
          headers: { "Set-Cookie": setCookie },
        },
      );
    }),
  };

  return routes;
}
