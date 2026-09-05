import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { jwtTtlSeconds, signJwt } from "@getstrata/core/auth/jwt";
import { verifyPassword } from "@getstrata/core/auth/password";
import { UnauthorizedError, ValidationError } from "@getstrata/core/errors/http";
import { jsonResponse } from "@getstrata/core/http/response";
import { isSpaEnabled, isViewsEnabled } from "@getstrata/core/runtime/frontendMode";
import { sessionMetaFromRequest, withCookies } from "../../http/cookies.ts";
import { authManager, requireCurrentUser } from "../../http/currentUser.ts";
import { mergeResource, NotificationResource, UserResource } from "../../http/resources.ts";
import {
  wrapApi,
  wrapGuestApi,
  wrapLoginApi,
  wrapPartnerApi,
  wrapTokenApi,
} from "../../http/wrap.ts";
import { loadUserGraph } from "../../lib/loaders.ts";
import { isStaff, roleName } from "../../lib/roles.ts";
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
      POST: wrapLoginApi(dependencies, loginJson),
    },
    "/api/auth/token": {
      POST: wrapTokenApi(dependencies, async (request) => {
        const payload = await new LoginRequest().validate(request);
        const user = await users.findByEmail(payload.email);
        if (!user || !(await verifyPassword(payload.password, user.password))) {
          throw new ValidationError("The given data was invalid.", {
            email: ["These credentials do not match our records."],
          });
        }
        if (accountService.staffRequiresMfa(user)) {
          throw new UnauthorizedError("Two-factor authentication required.");
        }
        const token = signJwt({
          sub: Number(user.id),
          role: roleName(user.role_id),
          abilities: isStaff(user.role_id)
            ? ["reports:export", "profile:read"]
            : ["interviews:join"],
          emailVerifiedAt: user.email_verified_at ?? null,
        });
        return jsonResponse({
          token,
          token_type: "Bearer",
          expires_in: jwtTtlSeconds(),
        });
      }),
    },
    "/api/integrations/ping": {
      GET: wrapPartnerApi(dependencies, "integrations:ping", async () =>
        jsonResponse({ ok: true, service: "hiroapp" }),
      ),
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

  if (!isSpaEnabled() || isViewsEnabled()) {
    return routes;
  }

  routes["/login"] = {
    POST: wrapLoginApi(dependencies, loginJson),
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
