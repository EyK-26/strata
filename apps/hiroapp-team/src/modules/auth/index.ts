import { CORE_AUTH_TOKEN } from "@getstrata/bootstrap/config";
import type { AppModule } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { wrapWebLogin, wrapWebRegister } from "@getstrata/bootstrap/web/routing";
import type { CookieSessionAuthManager } from "@getstrata/bootstrap/web/session";
import { hashPassword, verifyPassword } from "@getstrata/core/auth/password";
import { flashResponse } from "@getstrata/core/http/flashSession";
import { absoluteTemporarySignedUrl, assertValidSignature } from "@getstrata/core/http/signedUrl";
import { mailer } from "@getstrata/core/mail/mailer";
import { starterAuthDirectory } from "../../bootstrap/authDirectory.ts";
import { getSql } from "../../bootstrap/database.ts";
import { renderPage } from "../../lib/view.ts";

async function sendSignedMail(
  to: string,
  subject: string,
  path: string,
  query: Record<string, string>,
) {
  const link = absoluteTemporarySignedUrl(path, 3600, query);
  await mailer().send({
    to,
    subject,
    body: `${subject}\n\n${link}\n`,
  });
}

function redirectTo(path: string, status = 302): Response {
  return new Response(null, { status, headers: { location: path } });
}

function sessionUser(user: {
  id: number;
  name?: string | null;
  email?: string | null;
  role: string;
}) {
  return {
    id: user.id,
    name: user.name ?? user.email ?? "",
    email: user.email ?? "",
    is_admin: user.role === "admin",
  };
}

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
            { layout: { title: "Sign in" }, errors: {}, email: "", password: "" },
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
                  password: "",
                },
                request,
              );
            }

            return auth.signInRedirect(sessionUser(user), "/");
          },
          async (request) =>
            renderPage(
              "auth/login.eta",
              {
                layout: { title: "Sign in" },
                errors: { email: "Too many login attempts. Try again shortly." },
                email: "",
                password: "",
              },
              request,
              429,
            ),
        ),
      },
      "/register": {
        GET: kernel.wrapWebGuest(async (request) =>
          renderPage(
            "auth/register.eta",
            { layout: { title: "Create account" }, errors: {}, name: "", email: "", password: "" },
            request,
          ),
        ),
        POST: wrapWebRegister(
          kernel,
          async (request) => {
            const { fields } = await parseFormBody(request);
            const name = (fields.name ?? "").trim();
            const email = (fields.email ?? "").trim().toLowerCase();
            const password = fields.password ?? "";
            const errors: Record<string, string> = {};
            if (!name) {
              errors.name = "Name is required.";
            }
            if (!email) {
              errors.email = "Email is required.";
            }
            if (password.length < 8) {
              errors.password = "Use at least 8 characters.";
            }
            if (email && (await starterAuthDirectory.findByEmail?.(email))) {
              errors.email = "Email is already registered.";
            }
            if (Object.keys(errors).length > 0) {
              return renderPage(
                "auth/register.eta",
                { layout: { title: "Create account" }, errors, name, email, password: "" },
                request,
              );
            }
            const hashed = await hashPassword(password);
            await getSql().unsafe(
              "INSERT INTO users (name, email, password, is_admin) VALUES ($1, $2, $3, $4)",
              [name, email, hashed, false],
            );
            const created = await starterAuthDirectory.findByEmail?.(email);
            const insertedId = created?.id ?? 0;
            return auth.signInRedirect(
              sessionUser({ id: insertedId, name, email, role: "member" }),
              "/",
            );
          },
          async (request) =>
            renderPage(
              "auth/register.eta",
              {
                layout: { title: "Create account" },
                errors: { form: "Too many registration attempts. Try again shortly." },
                name: "",
                email: "",
                password: "",
              },
              request,
              429,
            ),
        ),
      },
      "/forgot-password": {
        GET: kernel.wrapWebGuest(async (request) =>
          renderPage(
            "auth/forgot-password.eta",
            { layout: { title: "Forgot password" }, errors: {}, email: "" },
            request,
          ),
        ),
        POST: kernel.wrapWeb(async (request) => {
          const { fields } = await parseFormBody(request);
          const email = (fields.email ?? "").trim().toLowerCase();
          const user = await starterAuthDirectory.findByEmail?.(email);
          if (user) {
            await sendSignedMail(email, "Reset your password", "/reset-password", { email });
          }
          return flashResponse(redirectTo("/forgot-password"), {
            level: "success",
            message: "If that account exists, a reset link is on its way.",
          });
        }),
      },
      "/reset-password": {
        GET: kernel.wrapWebGuest(async (request) => {
          assertValidSignature(request);
          const email = new URL(request.url).searchParams.get("email") ?? "";
          return renderPage(
            "auth/reset-password.eta",
            {
              layout: { title: "Reset password" },
              errors: {},
              password: "",
              email,
              action: `${new URL(request.url).pathname}${new URL(request.url).search}`,
            },
            request,
          );
        }),
        POST: kernel.wrapWeb(async (request) => {
          assertValidSignature(request);
          const { fields } = await parseFormBody(request);
          const email = new URL(request.url).searchParams.get("email") ?? fields.email ?? "";
          const password = fields.password ?? "";
          if (!email || password.length < 8) {
            return renderPage(
              "auth/reset-password.eta",
              {
                layout: { title: "Reset password" },
                errors: { password: "Use at least 8 characters." },
                password: "",
                email,
                action: `${new URL(request.url).pathname}${new URL(request.url).search}`,
              },
              request,
            );
          }
          await getSql().unsafe("UPDATE users SET password = $1 WHERE email = $2", [
            await hashPassword(password),
            email,
          ]);
          return flashResponse(redirectTo("/login"), {
            level: "success",
            message: "Password updated. Sign in.",
          });
        }),
      },
      "/logout": {
        POST: kernel.wrapWebAuthenticatedAllowUnverified((request) =>
          auth.signOutRedirect(request, "/"),
        ),
      },
    };
  },
};

export default authModule;
