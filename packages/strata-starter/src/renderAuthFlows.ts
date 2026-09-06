import {
  authNeedsUsers,
  authUsesJwt,
  authUsesToken,
  htmlAuthKit,
  nowTimestampLiteral,
  type StarterLayers,
  usesTenantTable,
} from "./types.ts";

function ph(layers: StarterLayers, count: number, start = 1): string {
  if (layers.database === "postgres") {
    return Array.from({ length: count }, (_, index) => `$${start + index}`).join(", ");
  }
  return Array.from({ length: count }, () => "?").join(", ");
}

function sqlFalse(layers: StarterLayers): string {
  return layers.database === "postgres" ? "false" : "0";
}

function sqlTrue(layers: StarterLayers): string {
  return layers.database === "postgres" ? "true" : "1";
}

function renderPendingMfaTs(): string {
  return `import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE = "strata_mfa_pending";

function secret(): string {
  return process.env.SESSION_SECRET?.trim() || "dev-session-secret-change-me-please-32ch";
}

function sign(userId: number, issuedAt: number): string {
  const payload = \`\${userId}.\${issuedAt}\`;
  const signature = createHmac("sha256", secret()).update(payload).digest("hex");
  return \`\${payload}.\${signature}\`;
}

export function pendingMfaSetCookie(userId: number): string {
  const issuedAt = Date.now();
  return \`\${COOKIE}=\${sign(userId, issuedAt)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600\`;
}

export function pendingMfaClearCookie(): string {
  return \`\${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0\`;
}

export function readPendingMfaUserId(request: Request): number | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== COOKIE) {
      continue;
    }
    const value = rest.join("=");
    const pieces = value.split(".");
    if (pieces.length !== 3) {
      return null;
    }
    const userId = Number.parseInt(pieces[0] ?? "", 10);
    const issuedAt = Number.parseInt(pieces[1] ?? "", 10);
    const signature = pieces[2] ?? "";
    if (!Number.isInteger(userId) || userId <= 0 || Date.now() - issuedAt > 10 * 60 * 1000) {
      return null;
    }
    const expected = sign(userId, issuedAt).split(".").pop() ?? "";
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      return null;
    }
    return userId;
  }
  return null;
}
`;
}

function renderAuthModule(layers: StarterLayers): string | null {
  if (!authNeedsUsers(layers.auth)) {
    return null;
  }

  const cookie = htmlAuthKit(layers.auth);
  const mfa = Boolean(layers.extras.mfa && cookie);
  const verify = Boolean(layers.extras.emailVerification);
  const jsonApi = authUsesToken(layers.auth) || authUsesJwt(layers.auth);
  const tenantInsert = usesTenantTable(layers.tenancy);
  const insertCols = tenantInsert
    ? "name, email, password, is_admin, tenant_id"
    : "name, email, password, is_admin";
  const insertPh = tenantInsert ? ph(layers, 5) : ph(layers, 4);
  const insertTail = tenantInsert ? `, ${sqlFalse(layers)}, 1` : `, ${sqlFalse(layers)}`;
  const passwordPh = `${ph(layers, 1)}`;
  const emailPh = `${ph(layers, 1, 2)}`;
  const idPh = `${ph(layers, 1, 2)}`;
  const verifiedPh = `${ph(layers, 1)}`;
  const mfaUpdatePh = `${ph(layers, 1)}, ${ph(layers, 1, 2)}, ${ph(layers, 1, 3)}`;
  const mfaIdPh = `${ph(layers, 1, 4)}`;

  const imports: string[] = [];
  if (authUsesToken(layers.auth)) {
    imports.push(`import { randomBytes } from "node:crypto";`);
  }
  imports.push(`import { CORE_AUTH_TOKEN } from "@getstrata/bootstrap/config";`);
  imports.push(`import type { AppModule } from "@getstrata/bootstrap/contracts";`);
  if (cookie) {
    imports.push(`import { parseFormBody } from "@getstrata/bootstrap/web/forms";`);
    imports.push(
      `import { wrapWebLogin, wrapWebRegister } from "@getstrata/bootstrap/web/routing";`,
    );
    imports.push(
      `import type { CookieSessionAuthManager } from "@getstrata/bootstrap/web/session";`,
    );
  }
  if (jsonApi) {
    imports.push(`import { AuthManager } from "@getstrata/core/auth/guard";`);
  }
  if (authUsesJwt(layers.auth)) {
    imports.push(`import { jwtTtlSeconds, signJwt } from "@getstrata/core/auth/jwt";`);
  }
  imports.push(`import { hashPassword, verifyPassword } from "@getstrata/core/auth/password";`);
  if (authUsesToken(layers.auth)) {
    imports.push(`import { hashApiToken } from "@getstrata/core/auth/tokenHash";`);
    imports.push(`import { sqlTimestamp } from "@getstrata/core/database/dialect";`);
    imports.push(
      `import { resolveDefaultTokenExpiryDays } from "@getstrata/core/security/tokenExpiry";`,
    );
  }
  if (mfa) {
    imports.push(
      `import { protectMfaSecret, revealMfaSecret } from "@getstrata/core/crypto/mfaSecret";`,
    );
  }
  if (cookie) {
    imports.push(`import { flashResponse } from "@getstrata/core/http/flashSession";`);
  }
  if (jsonApi) {
    imports.push(
      `import { jsonResponse, withErrorHandling } from "@getstrata/core/http/response";`,
    );
  }
  imports.push(
    `import { absoluteTemporarySignedUrl, assertValidSignature } from "@getstrata/core/http/signedUrl";`,
  );
  imports.push(`import { mailer } from "@getstrata/core/mail/mailer";`);
  if (mfa) {
    imports.push(
      `import { generateRecoveryCodes, hashRecoveryCode, recoveryCodeMatches } from "@getstrata/core/security/recoveryCodes";`,
    );
    imports.push(
      `import { buildOtpauthUrl, generateTotpSecret, verifyTotp } from "@getstrata/core/security/totp";`,
    );
  }
  imports.push(`import { starterAuthDirectory } from "../../bootstrap/authDirectory.ts";`);
  imports.push(`import { getSql } from "../../bootstrap/database.ts";`);
  if (cookie) {
    imports.push(`import { renderPage } from "../../lib/view.ts";`);
  }
  if (mfa) {
    imports.push(
      `import { pendingMfaClearCookie, pendingMfaSetCookie, readPendingMfaUserId } from "../../bootstrap/pendingMfa.ts";`,
    );
  }

  const helpers = `
async function sendSignedMail(to: string, subject: string, path: string, query: Record<string, string>) {
  const link = absoluteTemporarySignedUrl(path, 3600, query);
  await mailer().send({
    to,
    subject,
    body: \`\${subject}\\n\\n\${link}\\n\`,
  });
}
${
  cookie
    ? `
function redirectTo(path: string, status = 302): Response {
  return new Response(null, { status, headers: { location: path } });
}

function sessionUser(user: { id: number; name?: string | null; email?: string | null; role: string }) {
  return {
    id: user.id,
    name: user.name ?? user.email ?? "",
    email: user.email ?? "",
    is_admin: user.role === "admin",
  };
}
`
    : ""
}`;

  const tokenLogin = authUsesToken(layers.auth)
    ? `
        "/api/v1/auth/login": {
          POST: kernel.wrap("api", withErrorHandling(async (request) => {
            const body = (await request.json()) as { email?: string; password?: string };
            const email = (body.email ?? "").trim().toLowerCase();
            const password = body.password ?? "";
            const user = await starterAuthDirectory.verifyCredentials?.(email, password);
            if (!user) {
              return jsonResponse({ error: "Invalid credentials" }, { status: 422 });
            }
            const plain = \`strp_\${randomBytes(24).toString("hex")}\`;
            // API_TOKEN_DEFAULT_EXPIRY_DAYS (30 in .env.example) bounds every minted token.
            // Unset means no expiry; the production guard requires it to be set.
            const expiryDays = resolveDefaultTokenExpiryDays();
            const expiresAt = expiryDays
              ? new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000)
              : null;
            await getSql().unsafe(
              "INSERT INTO api_tokens (user_id, name, token_hash, abilities, expires_at) VALUES (${ph(layers, 5)})",
              [
                user.id,
                "spa",
                hashApiToken(plain),
                JSON.stringify(["profile:read"]),
                expiresAt ? sqlTimestamp(expiresAt) : null,
              ],
            );
            return jsonResponse({ token: plain, expires_at: expiresAt?.toISOString() ?? null });
          })),
        },
        "/api/v1/auth/me": {
          GET: kernel.wrapApi(async (request) => {
            const user = await dependencies.container.resolve<AuthManager>(CORE_AUTH_TOKEN).requireUser(request);
            const record = await starterAuthDirectory.findByIdOrThrow(Number(user.id));
            return jsonResponse({
              id: record.id,
              name: record.name ?? record.email,
              email: record.email,
              role: record.role,
            });
          }),
        },`
    : "";

  const jsonRegister = jsonApi
    ? `
        "/api/v1/auth/register": {
          POST: kernel.wrap("api", withErrorHandling(async (request) => {
            const body = (await request.json()) as { name?: string; email?: string; password?: string };
            const name = (body.name ?? "").trim();
            const email = (body.email ?? "").trim().toLowerCase();
            const password = body.password ?? "";
            if (!name || !email || password.length < 8) {
              return jsonResponse({ error: "Name, email, and a password of 8+ characters are required." }, { status: 422 });
            }
            if (await starterAuthDirectory.findByEmail?.(email)) {
              return jsonResponse({ error: "Email is already registered." }, { status: 422 });
            }
            const hashed = await hashPassword(password);
            await getSql().unsafe(
              "INSERT INTO users (${insertCols}) VALUES (${insertPh})",
              [name, email, hashed${insertTail}],
            );
            const created = await starterAuthDirectory.findByEmail?.(email);
            ${
              verify
                ? `if (created) {
              await sendSignedMail(email, "Verify your email", "/api/v1/auth/verify-email", { id: String(created.id) });
            }`
                : ""
            }
            return jsonResponse({ ok: true }, { status: 201 });
          })),
        },`
    : "";

  const jwtLogin = authUsesJwt(layers.auth)
    ? `
        "/api/auth/token": {
          POST: kernel.wrap("api", withErrorHandling(async (request) => {
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
              abilities: user.role === "admin" ? ["profile:read", "reports:export"] : ["profile:read"],${
                verify ? "\n              emailVerifiedAt: user.emailVerifiedAt ?? null," : ""
              }
            });
            return jsonResponse({
              token,
              token_type: "bearer",
              expires_in: jwtTtlSeconds(),
            });
          })),
        },`
    : "";

  const apiUser = jsonApi
    ? `
        "/api/user": {
          GET: kernel.wrapApi(async (request) => {
            const user = await dependencies.container.resolve<AuthManager>(CORE_AUTH_TOKEN).requireUser(request);
            return jsonResponse({ id: user.id, role: user.role ?? "member" });
          }),
        },`
    : "";

  const jsonPassword = jsonApi
    ? `
        "/api/v1/auth/forgot-password": {
          POST: kernel.wrap("api", withErrorHandling(async (request) => {
            const body = (await request.json()) as { email?: string };
            const email = (body.email ?? "").trim().toLowerCase();
            const user = await starterAuthDirectory.findByEmail?.(email);
            if (user) {
              await sendSignedMail(email, "Reset your password", "/api/v1/auth/reset-password", { email });
            }
            return jsonResponse({ ok: true });
          })),
        },
        "/api/v1/auth/reset-password": {
          POST: kernel.wrap("api", withErrorHandling(async (request) => {
            assertValidSignature(request);
            const body = (await request.json()) as { password?: string };
            const email = new URL(request.url).searchParams.get("email") ?? "";
            if (!email || !(body.password && body.password.length >= 8)) {
              return jsonResponse({ error: "Invalid reset payload." }, { status: 422 });
            }
            await getSql().unsafe(
              "UPDATE users SET password = ${passwordPh} WHERE email = ${emailPh}",
              [await hashPassword(body.password), email],
            );
            return jsonResponse({ ok: true });
          })),
        },`
    : "";

  const jsonVerify =
    jsonApi && verify
      ? `
        "/api/v1/auth/verify-email": {
          POST: kernel.wrap("api", withErrorHandling(async (request) => {
            assertValidSignature(request);
            const id = Number.parseInt(new URL(request.url).searchParams.get("id") ?? "", 10);
            if (!Number.isInteger(id) || id <= 0) {
              return jsonResponse({ error: "Invalid verification link." }, { status: 422 });
            }
            await getSql().unsafe(
              "UPDATE users SET email_verified_at = ${verifiedPh} WHERE id = ${idPh}",
              [${nowTimestampLiteral(layers.database)}, id],
            );
            return jsonResponse({ ok: true });
          })),
        },`
      : "";

  const apiRoutes = jsonApi
    ? `
    routes({ kernel, dependencies }) {
      return {${tokenLogin}${jsonRegister}${jwtLogin}${apiUser}${jsonPassword}${jsonVerify}
      };
    },`
    : "";

  const mfaLoginBranch = mfa
    ? `if (user.mfa_enabled) {
                const pending = redirectTo("/login/mfa");
                pending.headers.append("set-cookie", pendingMfaSetCookie(user.id));
                return pending;
              }`
    : "";

  const verifyRegisterBranch = verify
    ? `await sendSignedMail(email, "Verify your email", "/email/verify", { id: String(insertedId) });
              return flashResponse(
                await auth.signInRedirect(sessionUser({ id: insertedId, name, email, role: "member" }), "/email/verify"),
                { level: "info", message: "Check your email for a verification link." },
              );`
    : `return auth.signInRedirect(sessionUser({ id: insertedId, name, email, role: "member" }), "/");`;

  const cookieRoutes = cookie
    ? `
    webRoutes({ kernel, dependencies }) {
      const auth = dependencies.container.resolve<CookieSessionAuthManager>(CORE_AUTH_TOKEN);
      return {
        "/login": {
          GET: kernel.wrapWebGuest(async (request) =>
            renderPage("auth/login.eta", { layout: { title: "Sign in" }, errors: {}, email: "", password: "" }, request),
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
                  { layout: { title: "Sign in" }, errors: { email: "These credentials do not match our records." }, email, password: "" },
                  request,
                );
              }
              ${mfaLoginBranch}
              return auth.signInRedirect(sessionUser(user), "/");
            },
            async (request) =>
              renderPage(
                "auth/login.eta",
                { layout: { title: "Sign in" }, errors: { email: "Too many login attempts. Try again shortly." }, email: "", password: "" },
                request,
                429,
              ),
          ),
        },
        "/register": {
          GET: kernel.wrapWebGuest(async (request) =>
            renderPage("auth/register.eta", { layout: { title: "Create account" }, errors: {}, name: "", email: "", password: "" }, request),
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
                "INSERT INTO users (${insertCols}) VALUES (${insertPh})",
                [name, email, hashed${insertTail}],
              );
              const created = await starterAuthDirectory.findByEmail?.(email);
              const insertedId = created?.id ?? 0;
              ${verifyRegisterBranch}
            },
            async (request) =>
              renderPage(
                "auth/register.eta",
                { layout: { title: "Create account" }, errors: { form: "Too many registration attempts. Try again shortly." }, name: "", email: "", password: "" },
                request,
                429,
              ),
          ),
        },
        "/forgot-password": {
          GET: kernel.wrapWebGuest(async (request) =>
            renderPage("auth/forgot-password.eta", { layout: { title: "Forgot password" }, errors: {}, email: "" }, request),
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
              { layout: { title: "Reset password" }, errors: {}, password: "", email, action: \`\${new URL(request.url).pathname}\${new URL(request.url).search}\` },
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
                { layout: { title: "Reset password" }, errors: { password: "Use at least 8 characters." }, password: "", email, action: \`\${new URL(request.url).pathname}\${new URL(request.url).search}\` },
                request,
              );
            }
            await getSql().unsafe(
              "UPDATE users SET password = ${passwordPh} WHERE email = ${emailPh}",
              [await hashPassword(password), email],
            );
            return flashResponse(redirectTo("/login"), { level: "success", message: "Password updated. Sign in." });
          }),
        },
        "/logout": {
          POST: kernel.wrapWebAuthenticatedAllowUnverified((request) => auth.signOutRedirect(request, "/")),
        },${
          verify
            ? `
        "/email/verify": {
          GET: kernel.wrapWeb(async (request) => {
            const url = new URL(request.url);
            if (url.searchParams.get("signature")) {
              assertValidSignature(request);
              const id = Number.parseInt(url.searchParams.get("id") ?? "", 10);
              if (Number.isInteger(id) && id > 0) {
                await getSql().unsafe(
                  "UPDATE users SET email_verified_at = ${verifiedPh} WHERE id = ${idPh}",
                  [${nowTimestampLiteral(layers.database)}, id],
                );
                const record = await starterAuthDirectory.findByIdOrThrow(id);
                return flashResponse(
                  await auth.signInRedirect(sessionUser(record), "/"),
                  { level: "success", message: "Email verified." },
                );
              }
            }
            return renderPage("auth/verify-email.eta", { layout: { title: "Verify email" } }, request);
          }),
        },
        "/email/verification-notification": {
          POST: kernel.wrapWebAuthenticatedAllowUnverified(async (request) => {
            const user = await auth.user(request);
            if (user) {
              const record = await starterAuthDirectory.findByIdOrThrow(Number(user.id));
              await sendSignedMail(record.email ?? "", "Verify your email", "/email/verify", { id: String(record.id) });
            }
            return flashResponse(redirectTo("/email/verify"), { level: "info", message: "Verification link sent." });
          }),
        },`
            : ""
        }${
          mfa
            ? `
        "/login/mfa": {
          GET: kernel.wrapWebGuest(async (request) => {
            if (!readPendingMfaUserId(request)) {
              return redirectTo("/login");
            }
            return renderPage("auth/mfa-challenge.eta", { layout: { title: "MFA" }, errors: {}, code: "" }, request);
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
              await getSql().unsafe(
                "UPDATE users SET mfa_recovery_codes = ${passwordPh} WHERE id = ${idPh}",
                [JSON.stringify(remaining), pendingId],
              );
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
                  otpauth: buildOtpauthUrl({ secret, account: "user", issuer: process.env.APP_NAME ?? "Strata" }),
                },
                request,
              );
            }
            const recoveryCodes = generateRecoveryCodes();
            const stored = protectMfaSecret(secret);
            await getSql().unsafe(
              "UPDATE users SET mfa_secret = ${mfaUpdatePh.split(", ")[0]}, mfa_enabled = ${mfaUpdatePh.split(", ")[1]}, mfa_recovery_codes = ${mfaUpdatePh.split(", ")[2]} WHERE id = ${mfaIdPh}",
              [stored, ${sqlTrue(layers)}, JSON.stringify(recoveryCodes.map((item) => hashRecoveryCode(item))), Number(user.id)],
            );
            return renderPage(
              "auth/mfa-setup.eta",
              {
                layout: { title: "MFA" },
                errors: {},
                code: "",
                secret,
                otpauth: buildOtpauthUrl({ secret, account: "user", issuer: process.env.APP_NAME ?? "Strata" }),
                recoveryCodes,
              },
              request,
            );
          }),
        },`
            : ""
        }
      };
    },`
    : "";

  return `${imports.join("\n")}
${helpers}
const authModule: AppModule = {
  name: "auth",
  order: 2,${apiRoutes}${cookieRoutes}
};

export default authModule;
`;
}

function renderSiteModule(_layers: StarterLayers): string {
  return `import type { AppModule } from "@getstrata/bootstrap/contracts";
import { withErrorHandling } from "@getstrata/core/http/response";
import { pingDatabase } from "../../bootstrap/database.ts";
import { plainText, renderPage } from "../../lib/view.ts";

const siteModule: AppModule = {
  name: "site",
  order: 1,
  routes({ kernel }) {
    return {
      "/health": kernel.wrap("api", withErrorHandling(async () => {
        const dbOk = await pingDatabase();
        return plainText(dbOk ? "ok" : "degraded");
      })),
    };
  },
  webRoutes({ kernel }) {
    return {
      "/": kernel.wrapWeb(async (request) =>
        renderPage(
          "home.eta",
          {
            layout: {
              title: "Welcome",
              description: "Welcome to your Strata app. Restyle views/home.eta and public/assets/site.css.",
            },
          },
          request,
        ),
      ),
    };
  },
};

export default siteModule;
`;
}

export { renderAuthModule, renderPendingMfaTs, renderSiteModule };
