import { randomBytes } from "node:crypto";
import { CORE_AUTH_TOKEN } from "@getstrata/bootstrap/config";
import type { AppModule } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { wrapWebLogin } from "@getstrata/bootstrap/web/routing";
import type { CookieSessionAuthManager } from "@getstrata/bootstrap/web/session";
import type { AuthManager } from "@getstrata/core/auth/guard";
import { jwtTtlSeconds, signJwt } from "@getstrata/core/auth/jwt";
import { verifyPassword } from "@getstrata/core/auth/password";
import { hashApiToken } from "@getstrata/core/auth/tokenHash";
import { jsonResponse, withErrorHandling } from "@getstrata/core/http/response";
import { starterAuthDirectory } from "../../bootstrap/authDirectory.ts";
import { getSql } from "../../bootstrap/database.ts";
import { renderPage } from "../../lib/view.ts";

const authModule: AppModule = {
  name: "auth",
  order: 2,
  routes({ kernel, dependencies }) {
    return {
      "/api/v1/auth/login": {
        POST: kernel.wrap(
          "api",
          withErrorHandling(async (request) => {
            const body = (await request.json()) as { email?: string; password?: string };
            const email = (body.email ?? "").trim().toLowerCase();
            const password = body.password ?? "";
            const user = await starterAuthDirectory.verifyCredentials?.(email, password);
            if (!user) {
              return jsonResponse({ error: "Invalid credentials" }, { status: 422 });
            }
            const plain = `strp_${randomBytes(24).toString("hex")}`;
            await getSql().unsafe(
              "INSERT INTO api_tokens (user_id, name, token_hash, abilities) VALUES ($1, $2, $3, $4)",
              [user.id, "spa", hashApiToken(plain), JSON.stringify(["profile:read"])],
            );
            return jsonResponse({ token: plain });
          }),
        ),
      },
      "/api/v1/auth/me": {
        GET: kernel.wrapApi(async (request) => {
          const user = await dependencies.container
            .resolve<AuthManager>(CORE_AUTH_TOKEN)
            .requireUser(request);
          const record = await starterAuthDirectory.findByIdOrThrow(Number(user.id));
          return jsonResponse({
            id: record.id,
            name: record.email,
            email: record.email,
            role: record.role,
          });
        }),
      },
      "/api/auth/token": {
        POST: kernel.wrap(
          "api",
          withErrorHandling(async (request) => {
            const body = (await request.json()) as { email?: string; password?: string };
            const email = (body.email ?? "").trim().toLowerCase();
            const password = body.password ?? "";
            const user = await starterAuthDirectory.verifyCredentials?.(email, password);
            if (!user) {
              return jsonResponse({ error: "Invalid credentials" }, { status: 422 });
            }
            const token = signJwt({
              sub: user.id,
              role: user.role,
              abilities:
                user.role === "admin" ? ["profile:read", "reports:export"] : ["profile:read"],
            });
            return jsonResponse({
              token,
              token_type: "bearer",
              expires_in: jwtTtlSeconds(),
            });
          }),
        ),
      },
      "/api/user": {
        GET: kernel.wrapApi(async (request) => {
          const user = await dependencies.container
            .resolve<AuthManager>(CORE_AUTH_TOKEN)
            .requireUser(request);
          return jsonResponse({ id: user.id, role: user.role ?? "member" });
        }),
      },
    };
  },
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
