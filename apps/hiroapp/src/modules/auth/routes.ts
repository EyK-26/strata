import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { verifyPassword } from "@getstrata/core/auth/password";
import { ValidationError } from "@getstrata/core/errors/http";
import { jsonResponse } from "@getstrata/core/http/response";
import { isSpaEnabled } from "@getstrata/core/runtime/frontendMode";
import type { HiroSessionUser } from "../../bootstrap/providers/auth.ts";
import { authManager, requireCurrentUser } from "../../http/currentUser.ts";
import { mergeResource, NotificationResource, UserResource } from "../../http/resources.ts";
import { wrapApi, wrapGuestApi } from "../../http/wrap.ts";
import { loadUserGraph } from "../../lib/loaders.ts";
import { users } from "../users/repository.ts";
import { LoginRequest } from "./requests.ts";

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
  };

  if (!isSpaEnabled()) {
    return routes;
  }

  routes["/login"] = {
    POST: wrapGuestApi(dependencies, async (request) => {
      const payload = await new LoginRequest().validate(request);
      const user = await users.findByEmail(payload.email);
      if (!user || !(await verifyPassword(payload.password, user.password))) {
        throw new ValidationError("The given data was invalid.", {
          email: ["These credentials do not match our records."],
        });
      }
      const sessionUser: HiroSessionUser = {
        id: user.id,
        name: `${user.first_name} ${user.last_name}`,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        role_id: user.role_id,
        is_admin: Number(user.role_id) === 1,
      };
      const { setCookie } = await authManager().signIn(sessionUser);
      const graph = await loadUserGraph(user);
      const body = mergeResource(new UserResource(user), {
        notifications: graph.notifications.map((row) => new NotificationResource(row).toArray()),
        position: graph.position,
      });
      return jsonResponse(body, {
        headers: { "Set-Cookie": setCookie },
      });
    }),
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
