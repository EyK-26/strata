import { randomBytes } from "node:crypto";
import { CORE_AUTH_TOKEN } from "@getstrata/bootstrap/config";
import type { AppModule } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { wrapWebLogin, wrapWebRegister } from "@getstrata/bootstrap/web/routing";
import type { CookieSessionAuthManager } from "@getstrata/bootstrap/web/session";
import type { AuthManager } from "@getstrata/core/auth/guard";
import { jwtTtlSeconds, signJwt } from "@getstrata/core/auth/jwt";
import {
  AUTH_ONE_TIME_PURPOSES,
  consumeOneTimeToken,
  generateOneTimeToken,
  revokeUserSessions as revokeStoredUserSessions,
} from "@getstrata/core/auth/oneTimeToken";
import { hashPassword, verifyPassword } from "@getstrata/core/auth/password";
import {
  createPasswordConfirmCookie,
  hasFreshPasswordConfirmation,
} from "@getstrata/core/auth/passwordConfirmCookie";
import {
  completePasswordLogin,
  persistConsumedRecoveryHash,
} from "@getstrata/core/auth/passwordLogin";
import { createSamlServiceProvider } from "@getstrata/core/auth/saml/samlServiceProvider";
import { hashApiToken } from "@getstrata/core/auth/tokenHash";
import { protectMfaSecret } from "@getstrata/core/crypto/mfaSecret";
import { sqlTimestamp } from "@getstrata/core/database/dialect";
import { resolveCsrfToken } from "@getstrata/core/http/csrfToken";
import { flashResponse } from "@getstrata/core/http/flashSession";
import { jsonResponse, withErrorHandling } from "@getstrata/core/http/response";
import { sanitizeInternalPath } from "@getstrata/core/http/safeInternalPath";
import { absoluteTemporarySignedUrl, assertValidSignature } from "@getstrata/core/http/signedUrl";
import { mailer } from "@getstrata/core/mail/mailer";
import { createOAuthStateCookie, verifyOAuthState } from "@getstrata/core/security/oauthState";
import { generateRecoveryCodes, hashRecoveryCode } from "@getstrata/core/security/recoveryCodes";
import { resolveDefaultTokenExpiryDays } from "@getstrata/core/security/tokenExpiry";
import { buildOtpauthUrl, generateTotpSecret, verifyTotp } from "@getstrata/core/security/totp";
import { emailRule } from "@getstrata/core/validation/rules";
import { starterAuthDirectory } from "../../bootstrap/authDirectory.ts";
import { getSql } from "../../bootstrap/database.ts";
import {
  pendingMfaClearCookie,
  pendingMfaSetCookie,
  readPendingMfaUserId,
} from "../../bootstrap/pendingMfa.ts";
import { renderPage } from "../../lib/view.ts";

function isValidEmail(value: string): boolean {
  return emailRule()("email", value, {}) === undefined;
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
  await getSql().unsafe(
    "INSERT INTO auth_one_time_tokens (purpose, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)",
    [purpose, userId, issued.hash, expiresAt.toISOString()],
  );
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
  return consumeOneTimeToken(getSql(), purpose, token);
}

async function revokeUserSessions(userId: number) {
  await revokeStoredUserSessions(getSql(), userId);
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
            const csrf = resolveCsrfToken(request);
            const response = jsonResponse({ token: csrf.token });
            if (csrf.cookie) {
              response.headers.append("set-cookie", csrf.cookie);
            }
            return response;
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
            const issued = createOAuthStateCookie();
            const url = await createSamlServiceProvider().authorizationUrl(issued.state);
            const redirect = new Response(null, { status: 302, headers: { location: url } });
            redirect.headers.append("set-cookie", issued.cookie);
            return redirect;
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
              await getSql().unsafe(
                "INSERT INTO users (name, email, password, is_admin, tenant_id) VALUES ($1, $2, $3, $4, $5)",
                [profile.name, profile.email, hashed, false, 1],
              );
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
              await persistConsumedRecoveryHash(
                getSql(),
                record.id,
                record.mfa_recovery_codes,
                mfaResult.consumedRecoveryHash,
              );
              const user = { id: record.id, role: record.role };
              const plain = `strp_${randomBytes(24).toString("hex")}`;
              // API_TOKEN_DEFAULT_EXPIRY_DAYS bounds every minted token; unset means no expiry.
              const expiryDays = resolveDefaultTokenExpiryDays();
              const expiresAt = expiryDays
                ? new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000)
                : null;
              await getSql().unsafe(
                "INSERT INTO api_tokens (user_id, name, token_hash, abilities, expires_at) VALUES ($1, $2, $3, $4, $5)",
                [
                  user.id,
                  "spa",
                  hashApiToken(plain),
                  JSON.stringify(["profile:read"]),
                  expiresAt ? sqlTimestamp(expiresAt) : null,
                ],
              );
              const payload = jsonResponse({
                token: plain,
                expires_at: expiresAt?.toISOString() ?? null,
              });
              const sessionAuth =
                dependencies.container.resolve<CookieSessionAuthManager>(CORE_AUTH_TOKEN);
              const { setCookie } = await sessionAuth.signIn(sessionUser(record));
              payload.headers.append("set-cookie", setCookie);
              return payload;
            }),
          ),
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
            name: record.name ?? record.email,
            email: record.email,
            role: record.role,
          });
        }),
      },
      "/api/v1/auth/register": {
        POST: kernel.wrap(
          "api",
          kernel.wrapRegister(
            withErrorHandling(async (request) => {
              const body = (await request.json()) as {
                name?: string;
                email?: string;
                password?: string;
              };
              if ((process.env.FEATURE_REGISTRATION ?? "true") === "false") {
                return jsonResponse({ error: "Not found" }, { status: 404 });
              }
              const name = (body.name ?? "").trim();
              const email = (body.email ?? "").trim().toLowerCase();
              const password = body.password ?? "";
              if (!name || !isValidEmail(email) || password.length < 8) {
                return jsonResponse(
                  { error: "Name, email, and a password of 8+ characters are required." },
                  { status: 422 },
                );
              }
              const existing = await starterAuthDirectory.findByEmail?.(email);
              await hashPassword(password);
              if (existing) {
                return jsonResponse({ ok: true }, { status: 201 });
              }
              const hashed = await hashPassword(password);
              await getSql().unsafe(
                "INSERT INTO users (name, email, password, is_admin, tenant_id) VALUES ($1, $2, $3, $4, $5)",
                [name, email, hashed, false, 1],
              );
              const created = await starterAuthDirectory.findByEmail?.(email);
              if (created) {
                await issueSignedAuthMail(
                  email,
                  "Verify your email",
                  "/api/v1/auth/verify-email",
                  AUTH_ONE_TIME_PURPOSES.emailVerify,
                  created.id,
                  { id: String(created.id) },
                );
              }
              return jsonResponse({ ok: true }, { status: 201 });
            }),
          ),
        ),
      },
      "/api/auth/token": {
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
              await persistConsumedRecoveryHash(
                getSql(),
                record.id,
                record.mfa_recovery_codes,
                mfaResult.consumedRecoveryHash,
              );
              const user = {
                id: record.id,
                role: record.role,
                emailVerifiedAt: record.email_verified_at ?? null,
              };
              const token = signJwt({
                sub: user.id,
                role: user.role,
                abilities:
                  user.role === "admin" ? ["profile:read", "reports:export"] : ["profile:read"],
                emailVerifiedAt: user.emailVerifiedAt ?? null,
              });
              return jsonResponse({
                token,
                token_type: "bearer",
                expires_in: jwtTtlSeconds(),
              });
            }),
          ),
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
      "/api/v1/auth/logout": {
        POST: kernel.wrap(
          "api",
          withErrorHandling(async (request) => {
            const payload = jsonResponse({ ok: true });
            const sessionAuth =
              dependencies.container.resolve<CookieSessionAuthManager>(CORE_AUTH_TOKEN);
            const { setCookie } = await sessionAuth.signOut(request);
            payload.headers.append("set-cookie", setCookie);
            return payload;
          }),
        ),
      },
      "/api/v1/auth/forgot-password": {
        POST: kernel.wrap(
          "api",
          withErrorHandling(async (request) => {
            const body = (await request.json()) as { email?: string };
            const email = (body.email ?? "").trim().toLowerCase();
            const user = await starterAuthDirectory.findByEmail?.(email);
            if (user) {
              await issueSignedAuthMail(
                email,
                "Reset your password",
                "/api/v1/auth/reset-password",
                AUTH_ONE_TIME_PURPOSES.passwordReset,
                user.id,
                { email },
              );
            }
            return jsonResponse({ ok: true });
          }),
        ),
      },
      "/api/v1/auth/reset-password": {
        POST: kernel.wrap(
          "api",
          withErrorHandling(async (request) => {
            const userId = await consumeSignedAuthToken(
              request,
              AUTH_ONE_TIME_PURPOSES.passwordReset,
            );
            const body = (await request.json()) as { password?: string };
            if (!userId || !(body.password && body.password.length >= 8)) {
              return jsonResponse({ error: "Invalid or expired reset link." }, { status: 403 });
            }
            await getSql().unsafe("UPDATE users SET password = $1 WHERE id = $2", [
              await hashPassword(body.password),
              userId,
            ]);
            await revokeUserSessions(userId);
            return jsonResponse({ ok: true });
          }),
        ),
      },
      "/api/v1/auth/verify-email": {
        POST: kernel.wrap(
          "api",
          withErrorHandling(async (request) => {
            const id = await consumeSignedAuthToken(request, AUTH_ONE_TIME_PURPOSES.emailVerify);
            if (!id) {
              return jsonResponse(
                { error: "Invalid or expired verification link." },
                { status: 403 },
              );
            }
            await getSql().unsafe("UPDATE users SET email_verified_at = $1 WHERE id = $2", [
              new Date().toISOString(),
              id,
            ]);
            return jsonResponse({ ok: true });
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
            if (user.mfa_enabled) {
              const pending = redirectTo("/login/mfa");
              pending.headers.append("set-cookie", pendingMfaSetCookie(user.id));
              return pending;
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
            await getSql().unsafe(
              "INSERT INTO users (name, email, password, is_admin, tenant_id) VALUES ($1, $2, $3, $4, $5)",
              [name, email, hashed, false, 1],
            );
            const created = await starterAuthDirectory.findByEmail?.(email);
            const insertedId = created?.id ?? 0;
            await issueSignedAuthMail(
              email,
              "Verify your email",
              "/email/verify",
              AUTH_ONE_TIME_PURPOSES.emailVerify,
              insertedId,
              { id: String(insertedId) },
            );
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
          await getSql().unsafe("UPDATE users SET password = $1 WHERE id = $2", [
            await hashPassword(password),
            userId,
          ]);
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
      "/email/verify": {
        GET: kernel.wrapWeb(async (request) => {
          const url = new URL(request.url);
          if (url.searchParams.get("signature")) {
            const id = await consumeSignedAuthToken(request, AUTH_ONE_TIME_PURPOSES.emailVerify);
            if (id) {
              await getSql().unsafe("UPDATE users SET email_verified_at = $1 WHERE id = $2", [
                new Date().toISOString(),
                id,
              ]);
              return flashResponse(redirectTo("/login"), {
                level: "success",
                message: "Email verified. Sign in.",
              });
            }
            return flashResponse(redirectTo("/login"), {
              level: "error",
              message: "Invalid or expired verification link.",
            });
          }
          return renderPage(
            "auth/verify-email.eta",
            { layout: { title: "Verify email" } },
            request,
          );
        }),
      },
      "/email/verification-notification": {
        POST: kernel.wrapWebAuthenticatedAllowUnverified(async (request) => {
          const user = await auth.user(request);
          if (user) {
            const record = await starterAuthDirectory.findByIdOrThrow(Number(user.id));
            await issueSignedAuthMail(
              record.email ?? "",
              "Verify your email",
              "/email/verify",
              AUTH_ONE_TIME_PURPOSES.emailVerify,
              Number(record.id),
              { id: String(record.id) },
            );
          }
          return flashResponse(redirectTo("/email/verify"), {
            level: "info",
            message: "Verification link sent.",
          });
        }),
      },
      "/login/mfa": {
        GET: kernel.wrapWebGuest(async (request) => {
          if (!readPendingMfaUserId(request)) {
            return redirectTo("/login");
          }
          return renderPage(
            "auth/mfa-challenge.eta",
            { layout: { title: "MFA" }, errors: {}, code: "" },
            request,
          );
        }),
        POST: wrapWebLogin(
          kernel,
          async (request) => {
            const pendingId = readPendingMfaUserId(request);
            if (!pendingId) {
              return redirectTo("/login");
            }
            const { fields } = await parseFormBody(request);
            const submitted = (fields.code ?? "").trim();
            const record = await starterAuthDirectory.findByIdOrThrow(pendingId);
            const mfaResult = completePasswordLogin(record, { mfaCode: submitted });
            if (!mfaResult.ok) {
              return renderPage(
                "auth/mfa-challenge.eta",
                { layout: { title: "MFA" }, errors: { code: "That code is not valid." }, code: "" },
                request,
              );
            }
            await persistConsumedRecoveryHash(
              getSql(),
              pendingId,
              record.mfa_recovery_codes,
              mfaResult.consumedRecoveryHash,
            );
            const signed = await auth.signInRedirect(sessionUser(record), "/");
            signed.headers.append("set-cookie", pendingMfaClearCookie());
            return signed;
          },
          async (request) =>
            renderPage(
              "auth/mfa-challenge.eta",
              {
                layout: { title: "MFA" },
                errors: { code: "Too many login attempts. Try again shortly." },
                code: "",
              },
              request,
              429,
            ),
        ),
      },
      "/confirm-password": {
        GET: kernel.wrapWebAuthenticated(async (request) =>
          renderPage(
            "auth/confirm-password.eta",
            { layout: { title: "Confirm password" }, errors: {}, password: "" },
            request,
          ),
        ),
        POST: kernel.wrapWebAuthenticated(async (request) => {
          const user = await auth.user(request);
          if (!user) {
            return redirectTo("/login");
          }
          const { fields } = await parseFormBody(request);
          const password = fields.password ?? "";
          const record = await starterAuthDirectory.findByIdOrThrow(Number(user.id));
          if (!record.password || !(await verifyPassword(password, record.password))) {
            return renderPage(
              "auth/confirm-password.eta",
              {
                layout: { title: "Confirm password" },
                errors: { password: "That password is not correct." },
                password: "",
              },
              request,
            );
          }
          const next = sanitizeInternalPath(
            new URL(request.url).searchParams.get("redirect") ?? "/account/mfa",
          );
          const confirmed = redirectTo(next);
          confirmed.headers.append("set-cookie", createPasswordConfirmCookie(Number(user.id)));
          return confirmed;
        }),
      },
      "/account/mfa": {
        GET: kernel.wrapWebAuthenticated(async (request) => {
          const secret = generateTotpSecret();
          const user = await auth.user(request);
          const record = user ? await starterAuthDirectory.findByIdOrThrow(Number(user.id)) : null;
          const otpauth = buildOtpauthUrl({
            secret,
            account: record?.email ?? "user",
            issuer: process.env.APP_NAME ?? "Strata",
          });
          return renderPage(
            "auth/mfa-setup.eta",
            { layout: { title: "MFA" }, errors: {}, code: "", secret, otpauth },
            request,
          );
        }),
        POST: kernel.wrapWebAuthenticated(async (request) => {
          const user = await auth.user(request);
          if (!user) {
            return redirectTo("/login");
          }
          if (!hasFreshPasswordConfirmation(request, Number(user.id))) {
            return redirectTo("/confirm-password?redirect=/account/mfa");
          }
          const { fields } = await parseFormBody(request);
          const secret = (fields.secret ?? "").trim();
          const submitted = (fields.code ?? "").trim();
          if (!secret || !verifyTotp(secret, submitted)) {
            return renderPage(
              "auth/mfa-setup.eta",
              {
                layout: { title: "MFA" },
                errors: { code: "Could not confirm that code." },
                code: "",
                secret,
                otpauth: buildOtpauthUrl({
                  secret,
                  account: "user",
                  issuer: process.env.APP_NAME ?? "Strata",
                }),
              },
              request,
            );
          }
          const recoveryCodes = generateRecoveryCodes();
          const stored = protectMfaSecret(secret);
          await getSql().unsafe(
            "UPDATE users SET mfa_secret = $1, mfa_enabled = $2, mfa_recovery_codes = $3 WHERE id = $4",
            [
              stored,
              true,
              JSON.stringify(recoveryCodes.map((item) => hashRecoveryCode(item))),
              Number(user.id),
            ],
          );
          return renderPage(
            "auth/mfa-setup.eta",
            {
              layout: { title: "MFA" },
              errors: {},
              code: "",
              secret,
              otpauth: buildOtpauthUrl({
                secret,
                account: "user",
                issuer: process.env.APP_NAME ?? "Strata",
              }),
              recoveryCodes,
            },
            request,
          );
        }),
      },
    };
  },
};

export default authModule;
