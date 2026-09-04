import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { verifyPassword } from "@getstrata/core/auth/password";
import { ValidationError } from "@getstrata/core/errors/http";
import { redirectResponse } from "@getstrata/core/view";
import type { HiroSessionUser } from "../../bootstrap/providers/auth.ts";
import { authManager } from "../../http/currentUser.ts";
import { renderPage } from "../../http/view.ts";
import { wrapWebAuthenticated, wrapWebGuest } from "../../http/wrap.ts";
import { users } from "../users/repository.ts";

function toSessionUser(user: {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  role_id: number;
}): HiroSessionUser {
  return {
    id: user.id,
    name: `${user.first_name} ${user.last_name}`,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    role_id: user.role_id,
    is_admin: user.role_id === 1,
  };
}

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
        return authManager().signInRedirect(toSessionUser(user), "/", 302);
      }),
    },
    "/logout": {
      POST: wrapWebAuthenticated(dependencies, async (request) =>
        authManager().signOutRedirect(request, "/login", 302),
      ),
    },
  };
}

void ValidationError;
void redirectResponse;
