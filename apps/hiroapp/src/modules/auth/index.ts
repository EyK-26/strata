import { randomBytes } from "node:crypto";
import { CORE_AUTH_TOKEN } from "@getstrata/bootstrap/config";
import type { AppModule } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { wrapWebLogin, wrapWebRegister } from "@getstrata/bootstrap/web/routing";
import type { CookieSessionAuthManager } from "@getstrata/bootstrap/web/session";
import type { AuthManager } from "@getstrata/core/auth/guard";
import { jwtTtlSeconds, signJwt } from "@getstrata/core/auth/jwt";
import { hashPassword, verifyPassword } from "@getstrata/core/auth/password";
import { hashApiToken } from "@getstrata/core/auth/tokenHash";
import { protectMfaSecret, revealMfaSecret } from "@getstrata/core/crypto/mfaSecret";
import { flashResponse } from "@getstrata/core/http/flashSession";
import { jsonResponse, withErrorHandling } from "@getstrata/core/http/response";
import { absoluteTemporarySignedUrl, assertValidSignature } from "@getstrata/core/http/signedUrl";
import { mailer } from "@getstrata/core/mail/mailer";
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  recoveryCodeMatches,
} from "@getstrata/core/security/recoveryCodes";
import { buildOtpauthUrl, generateTotpSecret, verifyTotp } from "@getstrata/core/security/totp";
import { starterAuthDirectory } from "../../bootstrap/authDirectory.ts";
import { getSql } from "../../bootstrap/database.ts";
import {
  pendingMfaClearCookie,
  pendingMfaSetCookie,
  readPendingMfaUserId,
} from "../../bootstrap/pendingMfa.ts";
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
            name: record.name ?? record.email,
            email: record.email,
            role: record.role,
          });
        }),
      },
      "/api/v1/auth/register": {
        POST: kernel.wrap(
          "api",
          withErrorHandling(async (request) => {
            const body = (await request.json()) as {
              name?: string;
              email?: string;
              password?: string;
            };
            const name = (body.name ?? "").trim();
            const email = (body.email ?? "").trim().toLowerCase();
            const password = body.password ?? "";
            if (!name || !email || password.length < 8) {
              return jsonResponse(
                { error: "Name, email, and a password of 8+ characters are required." },
                { status: 422 },
              );
            }
            if (await starterAuthDirectory.findByEmail?.(email)) {
              return jsonResponse({ error: "Email is already registered." }, { status: 422 });
            }
            const hashed = await hashPassword(password);
            await getSql().unsafe(
              "INSERT INTO users (name, email, password, is_admin, tenant_id) VALUES ($1, $2, $3, $4, $5)",
              [name, email, hashed, false, 1],
            );
            const created = await starterAuthDirectory.findByEmail?.(email);
            if (created) {
              await sendSignedMail(email, "Verify your email", "/api/v1/auth/verify-email", {
                id: String(created.id),
              });
            }
            return jsonResponse({ ok: true }, { status: 201 });
          }),
        ),
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
              emailVerifiedAt: user.emailVerifiedAt ?? null,
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
      "/api/v1/auth/forgot-password": {
        POST: kernel.wrap(
          "api",
          withErrorHandling(async (request) => {
            const body = (await request.json()) as { email?: string };
            const email = (body.email ?? "").trim().toLowerCase();
            const user = await starterAuthDirectory.findByEmail?.(email);
            if (user) {
              await sendSignedMail(email, "Reset your password", "/api/v1/auth/reset-password", {
                email,
              });
            }
            return jsonResponse({ ok: true });
          }),
        ),
      },
      "/api/v1/auth/reset-password": {
        POST: kernel.wrap(
          "api",
          withErrorHandling(async (request) => {
            assertValidSignature(request);
            const body = (await request.json()) as { password?: string };
            const email = new URL(request.url).searchParams.get("email") ?? "";
            if (!email || !(body.password && body.password.length >= 8)) {
              return jsonResponse({ error: "Invalid reset payload." }, { status: 422 });
            }
            await getSql().unsafe("UPDATE users SET password = $1 WHERE email = $2", [
              await hashPassword(body.password),
              email,
            ]);
            return jsonResponse({ ok: true });
          }),
        ),
      },
      "/api/v1/auth/verify-email": {
        POST: kernel.wrap(
          "api",
          withErrorHandling(async (request) => {
            assertValidSignature(request);
            const id = Number.parseInt(new URL(request.url).searchParams.get("id") ?? "", 10);
            if (!Number.isInteger(id) || id <= 0) {
              return jsonResponse({ error: "Invalid verification link." }, { status: 422 });
            }
            await getSql().unsafe("UPDATE users SET email_verified_at = $1 WHERE id = $2", [
              new Date(),
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
              "INSERT INTO users (name, email, password, is_admin, tenant_id) VALUES ($1, $2, $3, $4, $5)",
              [name, email, hashed, false, 1],
            );
            const created = await starterAuthDirectory.findByEmail?.(email);
            const insertedId = created?.id ?? 0;
            await sendSignedMail(email, "Verify your email", "/email/verify", {
              id: String(insertedId),
            });
            return flashResponse(
              await auth.signInRedirect(
                sessionUser({ id: insertedId, name, email, role: "member" }),
                "/email/verify",
              ),
              { level: "info", message: "Check your email for a verification link." },
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
      "/email/verify": {
        GET: kernel.wrapWeb(async (request) => {
          const url = new URL(request.url);
          if (url.searchParams.get("signature")) {
            assertValidSignature(request);
            const id = Number.parseInt(url.searchParams.get("id") ?? "", 10);
            if (Number.isInteger(id) && id > 0) {
              await getSql().unsafe("UPDATE users SET email_verified_at = $1 WHERE id = $2", [
                new Date(),
                id,
              ]);
              const record = await starterAuthDirectory.findByIdOrThrow(id);
              return flashResponse(await auth.signInRedirect(sessionUser(record), "/"), {
                level: "success",
                message: "Email verified.",
              });
            }
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
            await sendSignedMail(record.email ?? "", "Verify your email", "/email/verify", {
              id: String(record.id),
            });
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
        POST: kernel.wrapWeb(async (request) => {
          const pendingId = readPendingMfaUserId(request);
          if (!pendingId) {
            return redirectTo("/login");
          }
          const { fields } = await parseFormBody(request);
          const submitted = (fields.code ?? "").trim();
          const record = await starterAuthDirectory.findByIdOrThrow(pendingId);
          const secret = revealMfaSecret(record.mfa_secret ?? null);
          const hashedCodes: string[] = record.mfa_recovery_codes
            ? (JSON.parse(record.mfa_recovery_codes) as string[])
            : [];
          const totpOk = secret ? verifyTotp(secret, submitted) : false;
          const recoveryOk = hashedCodes.some((hash) => recoveryCodeMatches(submitted, hash));
          if (!totpOk && !recoveryOk) {
            return renderPage(
              "auth/mfa-challenge.eta",
              { layout: { title: "MFA" }, errors: { code: "That code is not valid." }, code: "" },
              request,
            );
          }
          if (recoveryOk) {
            const remaining = hashedCodes.filter((hash) => !recoveryCodeMatches(submitted, hash));
            await getSql().unsafe("UPDATE users SET mfa_recovery_codes = $1 WHERE id = $2", [
              JSON.stringify(remaining),
              pendingId,
            ]);
          }
          const signed = await auth.signInRedirect(sessionUser(record), "/");
          signed.headers.append("set-cookie", pendingMfaClearCookie());
          return signed;
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
