import { randomBytes } from "node:crypto";
import { CORE_AUTH_TOKEN } from "@getstrata/bootstrap/config";
import type { AppModule } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { wrapWebLogin, wrapWebRegister } from "@getstrata/bootstrap/web/routing";
import type { CookieSessionAuthManager } from "@getstrata/bootstrap/web/session";
import {
  AUTH_ONE_TIME_PURPOSES,
  consumeOneTimeToken,
  generateOneTimeToken,
  revokeUserSessions as revokeStoredUserSessions,
} from "@getstrata/core/auth/oneTimeToken";
import { hashPassword, verifyPassword } from "@getstrata/core/auth/password";
import {
  completePasswordLogin,
  persistConsumedRecoveryHash,
} from "@getstrata/core/auth/passwordLogin";
import { createSamlServiceProvider } from "@getstrata/core/auth/saml/samlServiceProvider";
import { resolveCsrfTokenForRequest } from "@getstrata/core/http/csrfToken";
import { flashResponse } from "@getstrata/core/http/flashSession";
import { jsonResponse, withErrorHandling } from "@getstrata/core/http/response";
import { absoluteTemporarySignedUrl, assertValidSignature } from "@getstrata/core/http/signedUrl";
import { mailer } from "@getstrata/core/mail/mailer";
import { createOAuthState, verifyOAuthState } from "@getstrata/core/security/oauthState";
import { runWithMigrationBypass } from "@getstrata/core/tenant/databaseTenantContext";
import { emailRule } from "@getstrata/core/validation/rules";
import { starterAuthDirectory } from "../../bootstrap/authDirectory.ts";
import { getSql } from "../../bootstrap/database.ts";
import { renderPage } from "../../lib/view.ts";

function isValidEmail(value: string): boolean {
  return emailRule()("email", value, {}) === undefined;
}

async function runAuthWrite<T>(callback: () => Promise<T>): Promise<T> {
  return await runWithMigrationBypass(callback);
}

async function issueSignedAuthMail(
  to: string,
  subject: string,
  path: string,
  purpose: string,
  userId: number,
  extra: Record<string, string> = {},
) {
  const issued = generateOneTimeToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await runAuthWrite(async () => {
    await getSql().unsafe(
      "INSERT INTO auth_one_time_tokens (purpose, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)",
      [purpose, userId, issued.hash, expiresAt.toISOString()],
    );
  });
  const link = absoluteTemporarySignedUrl(path, 3600, { ...extra, token: issued.plain });
  await mailer().send({
    to,
    subject,
    body: `${subject}\n\n${link}\n`,
  });
}

async function consumeSignedAuthToken(request: Request, purpose: string): Promise<number | null> {
  assertValidSignature(request);
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!token) {
    return null;
  }
  return await runAuthWrite(async () => consumeOneTimeToken(getSql(), purpose, token));
}

async function revokeUserSessions(userId: number) {
  await runAuthWrite(async () => {
    await revokeStoredUserSessions(getSql(), userId);
  });
}

async function persistAuthRecovery(
  userId: number,
  currentRaw: string | null | undefined,
  consumedHash: string | undefined,
) {
  await runAuthWrite(async () => {
    await persistConsumedRecoveryHash(getSql(), userId, currentRaw, consumedHash);
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
  routes({ kernel, dependencies }) {
    return {
      "/api/v1/auth/csrf": {
        GET: kernel.wrap(
          "api",
          withErrorHandling(async (request) => {
            return jsonResponse({ token: resolveCsrfTokenForRequest(request) });
          }),
        ),
      },
      "/auth/saml": {
        GET: kernel.wrap(
          "api",
          withErrorHandling(async () => {
            if (process.env.FEATURE_SAML !== "true") {
              return new Response("Not found", { status: 404 });
            }
            const issued = createOAuthState();
            const url = await createSamlServiceProvider().authorizationUrl(issued.state);
            return new Response(null, { status: 302, headers: { location: url } });
          }),
        ),
      },
      "/auth/saml/acs": {
        POST: kernel.wrap(
          "api",
          withErrorHandling(async (request) => {
            if (process.env.FEATURE_SAML !== "true") {
              return new Response("Not found", { status: 404 });
            }
            const form = await request.formData();
            const samlResponse = String(form.get("SAMLResponse") ?? "");
            const relayState = String(form.get("RelayState") ?? "");
            if (!verifyOAuthState(request, relayState)) {
              return jsonResponse({ error: "Invalid SAML state." }, { status: 403 });
            }
            const profile = await createSamlServiceProvider()
              .consumePost(samlResponse, relayState)
              .catch(() => null);
            if (!profile) {
              return jsonResponse({ error: "Invalid SAML response." }, { status: 400 });
            }
            let record = await starterAuthDirectory.findByEmail?.(profile.email);
            if (!record) {
              if ((process.env.FEATURE_REGISTRATION ?? "true") === "false") {
                return jsonResponse({ error: "SAML user is not provisioned." }, { status: 403 });
              }
              const hashed = await hashPassword(randomBytes(18).toString("hex"));
              try {
                await runAuthWrite(async () => {
                  await getSql().unsafe(
                    "INSERT INTO users (name, email, password, is_admin) VALUES ($1, $2, $3, $4)",
                    [profile.name, profile.email, hashed, false],
                  );
                });
              } catch {
                // Unique email: another request already provisioned this user.
              }
              record = await starterAuthDirectory.findByEmail?.(profile.email);
            }
            if (!record) {
              return jsonResponse({ error: "Could not complete SAML login." }, { status: 500 });
            }
            const auth = dependencies.container.resolve<CookieSessionAuthManager>(CORE_AUTH_TOKEN);
            return auth.signInRedirect(sessionUser(record), "/");
          }),
        ),
      },
      "/api/v1/auth/login": {
        POST: kernel.wrap(
          "api",
          kernel.wrapLogin(
            withErrorHandling(async (request) => {
              const body = (await request.json()) as {
                email?: string;
                password?: string;
                mfa_code?: string;
              };
              const email = (body.email ?? "").trim().toLowerCase();
              const password = body.password ?? "";
              const record = await starterAuthDirectory.findByEmail?.(email);
              if (!record?.password || !(await verifyPassword(password, record.password))) {
                return jsonResponse({ error: "Invalid credentials" }, { status: 422 });
              }
              const mfaResult = completePasswordLogin(record, { mfaCode: body.mfa_code });
              if (!mfaResult.ok) {
                return jsonResponse(
                  { error: mfaResult.error },
                  { status: mfaResult.error === "mfa_required" ? 401 : 422 },
                );
              }
              await persistAuthRecovery(
                record.id,
                record.mfa_recovery_codes,
                mfaResult.consumedRecoveryHash,
              );
              const sessionAuth =
                dependencies.container.resolve<CookieSessionAuthManager>(CORE_AUTH_TOKEN);
              const { setCookie } = await sessionAuth.signIn(sessionUser(record));
              const payload = jsonResponse({ ok: true });
              payload.headers.append("set-cookie", setCookie);
              return payload;
            }),
          ),
        ),
      },
      "/api/v1/auth/me": {
        GET: kernel.wrapApi(async (request) => {
          const user = await dependencies.container
            .resolve<CookieSessionAuthManager>(CORE_AUTH_TOKEN)
            .requireUser(request);
          const record = await starterAuthDirectory.findByIdOrThrow(Number(user.id));
          return jsonResponse({
            id: record.id,
            name: record.name ?? record.email,
            email: record.email,
            role: record.role,
          });
        }),
      },
      "/api/v1/auth/logout": {
        POST: kernel.wrap(
          "api",
          withErrorHandling(async (request) => {
            const sessionAuth =
              dependencies.container.resolve<CookieSessionAuthManager>(CORE_AUTH_TOKEN);
            const { setCookie } = await sessionAuth.signOut(request);
            const payload = jsonResponse({ ok: true });
            payload.headers.append("set-cookie", setCookie);
            return payload;
          }),
        ),
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
            const mfaResult = completePasswordLogin(user, { mfaCode: fields.mfa_code });
            if (!mfaResult.ok) {
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
            await persistAuthRecovery(
              user.id,
              user.mfa_recovery_codes,
              mfaResult.consumedRecoveryHash,
            );
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
        GET: kernel.wrapWebGuest(async (request) => {
          if ((process.env.FEATURE_REGISTRATION ?? "true") === "false") {
            return new Response("Not found", { status: 404 });
          }
          return renderPage(
            "auth/register.eta",
            { layout: { title: "Create account" }, errors: {}, name: "", email: "", password: "" },
            request,
          );
        }),
        POST: wrapWebRegister(
          kernel,
          async (request) => {
            if ((process.env.FEATURE_REGISTRATION ?? "true") === "false") {
              return new Response("Not found", { status: 404 });
            }
            const { fields } = await parseFormBody(request);
            const name = (fields.name ?? "").trim();
            const email = (fields.email ?? "").trim().toLowerCase();
            const password = fields.password ?? "";
            const errors: Record<string, string> = {};
            if (!name) {
              errors.name = "Name is required.";
            }
            if (!email || !isValidEmail(email)) {
              errors.email = "Email is required.";
            }
            if (password.length < 8) {
              errors.password = "Use at least 8 characters.";
            }
            const existing = email ? await starterAuthDirectory.findByEmail?.(email) : null;
            await hashPassword(password || "dummy-password");
            if (Object.keys(errors).length > 0) {
              return renderPage(
                "auth/register.eta",
                { layout: { title: "Create account" }, errors, name, email, password: "" },
                request,
              );
            }
            if (existing) {
              return flashResponse(redirectTo("/login"), {
                level: "success",
                message: "If that email is available, continue from the sign-in page.",
              });
            }
            const hashed = await hashPassword(password);
            await runAuthWrite(async () => {
              await getSql().unsafe(
                "INSERT INTO users (name, email, password, is_admin) VALUES ($1, $2, $3, $4)",
                [name, email, hashed, false],
              );
            });
            return flashResponse(redirectTo("/login"), {
              level: "success",
              message: "If that email is available, continue from the sign-in page.",
            });
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
            await issueSignedAuthMail(
              email,
              "Reset your password",
              "/reset-password",
              AUTH_ONE_TIME_PURPOSES.passwordReset,
              user.id,
              { email },
            );
          }
          return flashResponse(redirectTo("/forgot-password"), {
            level: "success",
            message: "If that account exists, a reset link is on its way.",
          });
        }),
      },
      "/reset-password": {
        GET: kernel.wrapWeb(async (request) => {
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
          const userId = await consumeSignedAuthToken(
            request,
            AUTH_ONE_TIME_PURPOSES.passwordReset,
          );
          const { fields } = await parseFormBody(request);
          const email = new URL(request.url).searchParams.get("email") ?? fields.email ?? "";
          const password = fields.password ?? "";
          if (!userId || !email || password.length < 8) {
            return renderPage(
              "auth/reset-password.eta",
              {
                layout: { title: "Reset password" },
                errors: { password: "Invalid or expired reset link." },
                password: "",
                email,
                action: `${new URL(request.url).pathname}${new URL(request.url).search}`,
              },
              request,
            );
          }
          await runAuthWrite(async () => {
            await getSql().unsafe("UPDATE users SET password = $1 WHERE id = $2", [
              await hashPassword(password),
              userId,
            ]);
          });
          await revokeUserSessions(userId);
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
