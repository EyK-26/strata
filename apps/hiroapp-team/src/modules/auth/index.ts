import { CORE_AUTH_TOKEN } from "@getstrata/bootstrap/config";
import type { AppModule } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { wrapWebLogin } from "@getstrata/bootstrap/web/routing";
import type { CookieSessionAuthManager } from "@getstrata/bootstrap/web/session";
import { verifyPassword } from "@getstrata/core/auth/password";
import { starterAuthDirectory } from "../../bootstrap/authDirectory.ts";
import { renderPage } from "../../lib/view.ts";

const authModule: AppModule = {
  name: "auth",
  order: 2,
  webRoutes({ kernel, dependencies }) {
    const auth = dependencies.container.resolve<CookieSessionAuthManager>(CORE_AUTH_TOKEN);
    return {
      "/login": {
        GET: kernel.wrapWebGuest(async (request) =>
          renderPage(
            "auth/login.eta",
            { layout: { title: "Sign in" }, errors: {}, email: "" },
            request,
          ),
        ),
        POST: wrapWebLogin(
          kernel,
          async (request) => {
            const { fields } = await parseFormBody(request);
            const email = (fields.email ?? "").trim().toLowerCase();
            const password = fields.password ?? "";
            const user = await starterAuthDirectory.findByEmail?.(email);
            if (!user?.password || !(await verifyPassword(password, user.password))) {
              return renderPage(
                "auth/login.eta",
                {
                  layout: { title: "Sign in" },
                  errors: { email: "These credentials do not match our records." },
                  email,
                },
                request,
              );
            }
            return auth.signInRedirect(
              {
                id: user.id,
                name: user.email ?? "",
                email: user.email ?? "",
                is_admin: user.role === "admin",
              },
              "/",
            );
          },
          async () => new Response("Too many login attempts", { status: 429 }),
        ),
      },
      "/logout": {
        POST: kernel.wrapWebAuthenticatedAllowUnverified((request) =>
          auth.signOutRedirect(request, "/login"),
        ),
      },
    };
  },
};

export default authModule;
