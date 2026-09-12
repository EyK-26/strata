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
import { sessionSecret } from "./config.ts";

const COOKIE = "strata_mfa_pending";

function sign(userId: number, issuedAt: number): string {
  const payload = \`\${userId}.\${issuedAt}\`;
  const signature = createHmac("sha256", sessionSecret()).update(payload).digest("hex");
  return \`\${payload}.\${signature}\`;
}

export function pendingMfaSetCookie(userId: number): string {
  const issuedAt = Date.now();
  const secure = process.env.APP_ENV === "production" || process.env.APP_ENV === "staging" ? "; Secure" : "";
  return \`\${COOKIE}=\${sign(userId, issuedAt)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600\${secure}\`;
}

export function pendingMfaClearCookie(): string {
  const secure = process.env.APP_ENV === "production" || process.env.APP_ENV === "staging" ? "; Secure" : "";
  return \`\${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0\${secure}\`;
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
  const insertTail = tenantInsert
    ? `, ${sqlFalse(layers)}, currentTenantId()`
    : `, ${sqlFalse(layers)}`;
  const passwordPh = `${ph(layers, 1)}`;
  const idPh = `${ph(layers, 1, 2)}`;
  const verifiedPh = `${ph(layers, 1)}`;
  const mfaUpdatePh = `${ph(layers, 1)}, ${ph(layers, 1, 2)}, ${ph(layers, 1, 3)}`;
  const mfaIdPh = `${ph(layers, 1, 4)}`;

  const imports: string[] = [];
  if (authUsesToken(layers.auth) || cookie) {
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
    imports.push(
      `import { createSamlServiceProvider } from "@getstrata/core/auth/saml/samlServiceProvider";`,
    );
  }
  if (jsonApi) {
    imports.push(`import { AuthManager } from "@getstrata/core/auth/guard";`);
  }
  if (authUsesJwt(layers.auth)) {
    imports.push(`import { jwtTtlSeconds, signJwt } from "@getstrata/core/auth/jwt";`);
  }
  imports.push(`import { hashPassword, verifyPassword } from "@getstrata/core/auth/password";`);
  imports.push(
    `import { AUTH_ONE_TIME_PURPOSES, consumeOneTimeToken, generateOneTimeToken, revokeUserSessions as revokeStoredUserSessions } from "@getstrata/core/auth/oneTimeToken";`,
  );
  imports.push(
    `import { completePasswordLogin, persistConsumedRecoveryHash } from "@getstrata/core/auth/passwordLogin";`,
  );
  if (mfa) {
    imports.push(
      `import { createPasswordConfirmCookie, hasFreshPasswordConfirmation } from "@getstrata/core/auth/passwordConfirmCookie";`,
    );
  }
  imports.push(`import { emailRule } from "@getstrata/core/validation/rules";`);
  if (authUsesToken(layers.auth)) {
    imports.push(`import { hashApiToken } from "@getstrata/core/auth/tokenHash";`);
    imports.push(`import { sqlTimestamp } from "@getstrata/core/database/dialect";`);
    imports.push(
      `import { resolveDefaultTokenExpiryDays } from "@getstrata/core/security/tokenExpiry";`,
    );
  }
  if (mfa) {
    imports.push(`import { protectMfaSecret } from "@getstrata/core/crypto/mfaSecret";`);
  }
  if (cookie) {
    imports.push(`import { flashResponse } from "@getstrata/core/http/flashSession";`);
    if (mfa) {
      imports.push(`import { sanitizeInternalPath } from "@getstrata/core/http/safeInternalPath";`);
    }
    imports.push(
      `import { createOAuthState, verifyOAuthState } from "@getstrata/core/security/oauthState";`,
    );
  }
  if (jsonApi || cookie) {
    imports.push(
      `import { jsonResponse, withErrorHandling } from "@getstrata/core/http/response";`,
    );
    imports.push(`import { resolveCsrfToken } from "@getstrata/core/http/csrfToken";`);
  }
  imports.push(
    `import { absoluteTemporarySignedUrl, assertValidSignature } from "@getstrata/core/http/signedUrl";`,
  );
  imports.push(`import { mailer } from "@getstrata/core/mail/mailer";`);
  if (mfa) {
    imports.push(
      `import { generateRecoveryCodes, hashRecoveryCode } from "@getstrata/core/security/recoveryCodes";`,
    );
    imports.push(
      `import { buildOtpauthUrl, generateTotpSecret, verifyTotp } from "@getstrata/core/security/totp";`,
    );
  }
  if (tenantInsert) {
    imports.push(`import { currentTenantId } from "@getstrata/core/tenant/tenantContext";`);
  }
  imports.push(
    `import { runWithMigrationBypass } from "@getstrata/core/tenant/databaseTenantContext";`,
  );
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

  const tokenPh = ph(layers, 4);
  const helpers = `
function isValidEmail(value: string): boolean {
  return emailRule()("email", value, {}) === undefined;
}

async function runAuthWrite<T>(callback: () => Promise<T>): Promise<T> {
  return await runWithMigrationBypass(callback);
}

async function issueSignedAuthMail(to: string, subject: string, path: string, purpose: string, userId: number, extra: Record<string, string> = {}) {
  const issued = generateOneTimeToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await runAuthWrite(async () => {
    await getSql().unsafe(
      "INSERT INTO auth_one_time_tokens (purpose, user_id, token_hash, expires_at) VALUES (${tokenPh})",
      [purpose, userId, issued.hash, expiresAt.toISOString()],
    );
  });
  const link = absoluteTemporarySignedUrl(path, 3600, { ...extra, token: issued.plain });
  await mailer().send({
    to,
    subject,
    body: \`\${subject}\\n\\n\${link}\\n\`,
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
          POST: kernel.wrap("api", kernel.wrapLogin(withErrorHandling(async (request) => {
            const body = (await request.json()) as { email?: string; password?: string; mfa_code?: string };
            const email = (body.email ?? "").trim().toLowerCase();
            const password = body.password ?? "";
            const record = await starterAuthDirectory.findByEmail?.(email);
            if (!record?.password || !(await verifyPassword(password, record.password))) {
              return jsonResponse({ error: "Invalid credentials" }, { status: 422 });
            }
            const mfaResult = completePasswordLogin(record, { mfaCode: body.mfa_code });
            if (!mfaResult.ok) {
              return jsonResponse({ error: mfaResult.error }, { status: mfaResult.error === "mfa_required" ? 401 : 422 });
            }
            await persistAuthRecovery(record.id, record.mfa_recovery_codes, mfaResult.consumedRecoveryHash);
            const user = { id: record.id, role: record.role };
            const plain = \`strp_\${randomBytes(24).toString("hex")}\`;
            // API_TOKEN_DEFAULT_EXPIRY_DAYS bounds every minted token; unset means no expiry.
            const expiryDays = resolveDefaultTokenExpiryDays();
            const expiresAt = expiryDays
              ? new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000)
              : null;
            await runAuthWrite(async () => {
              await getSql().unsafe(
              "INSERT INTO api_tokens (user_id, name, token_hash, abilities, expires_at) VALUES (${ph(layers, 5)})",
              [
                user.id,
                "spa",
                hashApiToken(plain),
                JSON.stringify([]),
                expiresAt ? sqlTimestamp(expiresAt) : null,
              ],
            );
            });
            const payload = jsonResponse({ token: plain, expires_at: expiresAt?.toISOString() ?? null });
            ${
              cookie
                ? `const sessionAuth = dependencies.container.resolve<CookieSessionAuthManager>(CORE_AUTH_TOKEN);
            const { setCookie } = await sessionAuth.signIn(sessionUser(record));
            payload.headers.append("set-cookie", setCookie);
            `
                : ""
            }return payload;
          }))),
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
          POST: kernel.wrap("api", kernel.wrapRegister(withErrorHandling(async (request) => {
            const body = (await request.json()) as { name?: string; email?: string; password?: string };
            if ((process.env.FEATURE_REGISTRATION ?? "true") === "false") {
              return jsonResponse({ error: "Not found" }, { status: 404 });
            }
            const name = (body.name ?? "").trim();
            const email = (body.email ?? "").trim().toLowerCase();
            const password = body.password ?? "";
            if (!name || !isValidEmail(email) || password.length < 8) {
              return jsonResponse({ error: "Name, email, and a password of 8+ characters are required." }, { status: 422 });
            }
            const existing = await starterAuthDirectory.findByEmail?.(email);
            await hashPassword(password);
            if (existing) {
              return jsonResponse({ ok: true }, { status: 201 });
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
              await issueSignedAuthMail(email, "Verify your email", "/api/v1/auth/verify-email", AUTH_ONE_TIME_PURPOSES.emailVerify, created.id, { id: String(created.id) });
            }`
                : ""
            }
            return jsonResponse({ ok: true }, { status: 201 });
          }))),
        },`
    : "";

  const jwtLogin = authUsesJwt(layers.auth)
    ? `
        "/api/auth/token": {
          POST: kernel.wrap("api", kernel.wrapLogin(withErrorHandling(async (request) => {
            const body = (await request.json()) as { email?: string; password?: string; mfa_code?: string };
            const email = (body.email ?? "").trim().toLowerCase();
            const password = body.password ?? "";
            const record = await starterAuthDirectory.findByEmail?.(email);
            if (!record?.password || !(await verifyPassword(password, record.password))) {
              return jsonResponse({ error: "Invalid credentials" }, { status: 422 });
            }
            const mfaResult = completePasswordLogin(record, { mfaCode: body.mfa_code });
            if (!mfaResult.ok) {
              return jsonResponse({ error: mfaResult.error }, { status: mfaResult.error === "mfa_required" ? 401 : 422 });
            }
            await persistAuthRecovery(record.id, record.mfa_recovery_codes, mfaResult.consumedRecoveryHash);
            const user = { id: record.id, role: record.role, emailVerifiedAt: record.email_verified_at ?? null };
            const token = signJwt({
              sub: user.id,
              role: user.role,
              abilities: [],${
                verify ? "\n              emailVerifiedAt: user.emailVerifiedAt ?? null," : ""
              }
            });
            return jsonResponse({
              token,
              token_type: "bearer",
              expires_in: jwtTtlSeconds(),
            });
          }))),
        },`
    : "";

  const apiUser = jsonApi
    ? `
        "/api/user": {
          GET: kernel.wrapApi(async (request) => {
            const user = await dependencies.container.resolve<AuthManager>(CORE_AUTH_TOKEN).requireUser(request);
            return jsonResponse({ id: user.id, role: user.role ?? "member" });
          }),
        },
        "/api/v1/auth/logout": {
          POST: kernel.wrap("api", withErrorHandling(async (request) => {
            const payload = jsonResponse({ ok: true });
            ${
              cookie
                ? `const sessionAuth = dependencies.container.resolve<CookieSessionAuthManager>(CORE_AUTH_TOKEN);
            const { setCookie } = await sessionAuth.signOut(request);
            payload.headers.append("set-cookie", setCookie);
            `
                : ""
            }return payload;
          })),
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
              await issueSignedAuthMail(email, "Reset your password", "/api/v1/auth/reset-password", AUTH_ONE_TIME_PURPOSES.passwordReset, user.id, { email });
            }
            return jsonResponse({ ok: true });
          })),
        },
        "/api/v1/auth/reset-password": {
          POST: kernel.wrap("api", withErrorHandling(async (request) => {
            const userId = await consumeSignedAuthToken(request, AUTH_ONE_TIME_PURPOSES.passwordReset);
            const body = (await request.json()) as { password?: string };
            if (!userId || !(body.password && body.password.length >= 8)) {
              return jsonResponse({ error: "Invalid or expired reset link." }, { status: 403 });
            }
            await runAuthWrite(async () => {
              await getSql().unsafe(
              "UPDATE users SET password = ${passwordPh} WHERE id = ${idPh}",
              [await hashPassword(body.password), userId],
            );
            });
            await revokeUserSessions(userId);
            return jsonResponse({ ok: true });
          })),
        },`
    : "";

  const jsonVerify =
    jsonApi && verify
      ? `
        "/api/v1/auth/verify-email": {
          POST: kernel.wrap("api", withErrorHandling(async (request) => {
            const id = await consumeSignedAuthToken(request, AUTH_ONE_TIME_PURPOSES.emailVerify);
            if (!id) {
              return jsonResponse({ error: "Invalid or expired verification link." }, { status: 403 });
            }
            await runAuthWrite(async () => {
              await getSql().unsafe(
              "UPDATE users SET email_verified_at = ${verifiedPh} WHERE id = ${idPh}",
              [${nowTimestampLiteral(layers.database)}, id],
            );
            });
            return jsonResponse({ ok: true });
          })),
        },`
      : "";

  const csrfRoute = `
        "/api/v1/auth/csrf": {
          GET: kernel.wrap("api", withErrorHandling(async (request) => {
            const csrf = resolveCsrfToken(request);
            const response = jsonResponse({ token: csrf.token });
            if (csrf.cookie) {
              response.headers.append("set-cookie", csrf.cookie);
            }
            return response;
          })),
        },`;

  const cookieJsonAuth =
    cookie && !jsonApi
      ? `
        "/api/v1/auth/login": {
          POST: kernel.wrap("api", kernel.wrapLogin(withErrorHandling(async (request) => {
            const body = (await request.json()) as { email?: string; password?: string; mfa_code?: string };
            const email = (body.email ?? "").trim().toLowerCase();
            const password = body.password ?? "";
            const record = await starterAuthDirectory.findByEmail?.(email);
            if (!record?.password || !(await verifyPassword(password, record.password))) {
              return jsonResponse({ error: "Invalid credentials" }, { status: 422 });
            }
            const mfaResult = completePasswordLogin(record, { mfaCode: body.mfa_code });
            if (!mfaResult.ok) {
              return jsonResponse({ error: mfaResult.error }, { status: mfaResult.error === "mfa_required" ? 401 : 422 });
            }
            await persistAuthRecovery(record.id, record.mfa_recovery_codes, mfaResult.consumedRecoveryHash);
            const sessionAuth = dependencies.container.resolve<CookieSessionAuthManager>(CORE_AUTH_TOKEN);
            const { setCookie } = await sessionAuth.signIn(sessionUser(record));
            const payload = jsonResponse({ ok: true });
            payload.headers.append("set-cookie", setCookie);
            return payload;
          }))),
        },
        "/api/v1/auth/me": {
          GET: kernel.wrapApi(async (request) => {
            const user = await dependencies.container.resolve<CookieSessionAuthManager>(CORE_AUTH_TOKEN).requireUser(request);
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
          POST: kernel.wrap("api", withErrorHandling(async (request) => {
            const sessionAuth = dependencies.container.resolve<CookieSessionAuthManager>(CORE_AUTH_TOKEN);
            const { setCookie } = await sessionAuth.signOut(request);
            const payload = jsonResponse({ ok: true });
            payload.headers.append("set-cookie", setCookie);
            return payload;
          })),
        },`
      : "";

  const samlRoutes = cookie
    ? `
        "/auth/saml": {
          GET: kernel.wrap("api", withErrorHandling(async () => {
            if (process.env.FEATURE_SAML !== "true") {
              return new Response("Not found", { status: 404 });
            }
            const issued = createOAuthState();
            const url = await createSamlServiceProvider().authorizationUrl(issued.state);
            return new Response(null, { status: 302, headers: { location: url } });
          })),
        },
        "/auth/saml/acs": {
          POST: kernel.wrap("api", withErrorHandling(async (request) => {
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
                "INSERT INTO users (${insertCols}) VALUES (${insertPh})",
                [profile.name, profile.email, hashed${insertTail}],
              );
              record = await starterAuthDirectory.findByEmail?.(profile.email);
            }
            if (!record) {
              return jsonResponse({ error: "Could not complete SAML login." }, { status: 500 });
            }
            ${
              mfa
                ? `if (record.mfa_enabled) {
              const pending = redirectTo("/login/mfa");
              pending.headers.append("set-cookie", pendingMfaSetCookie(record.id));
              return pending;
            }
            `
                : ""
            }const auth = dependencies.container.resolve<CookieSessionAuthManager>(CORE_AUTH_TOKEN);
            return auth.signInRedirect(sessionUser(record), "/");
          })),
        },`
    : "";

  const apiRoutes =
    jsonApi || cookie
      ? `
    routes({ kernel, dependencies }) {
      return {${csrfRoute}${samlRoutes}${cookieJsonAuth}${tokenLogin}${jsonRegister}${jwtLogin}${apiUser}${jsonPassword}${jsonVerify}
      };
    },`
      : "";

  const mfaLoginBranch = `const mfaResult = completePasswordLogin(user, { mfaCode: fields.mfa_code });
              if (!mfaResult.ok) {
                ${
                  mfa
                    ? `if (mfaResult.error === "mfa_required") {
                  const pending = redirectTo("/login/mfa");
                  pending.headers.append("set-cookie", pendingMfaSetCookie(user.id));
                  return pending;
                }`
                    : ""
                }
                return renderPage(
                  "auth/login.eta",
                  { layout: { title: "Sign in" }, errors: { email: "These credentials do not match our records." }, email, password: "" },
                  request,
                );
              }
              await persistAuthRecovery(user.id, user.mfa_recovery_codes, mfaResult.consumedRecoveryHash);`;

  const registerSuccessExisting = `return flashResponse(
                redirectTo("/login"),
                { level: "success", message: "If that email is available, continue from the sign-in page." },
              );`;

  const verifyRegisterBranch = verify
    ? `await issueSignedAuthMail(email, "Verify your email", "/email/verify", AUTH_ONE_TIME_PURPOSES.emailVerify, insertedId, { id: String(insertedId) });
              return flashResponse(
                redirectTo("/login"),
                { level: "success", message: "If that email is available, continue from the sign-in page." },
              );`
    : `return flashResponse(
                redirectTo("/login"),
                { level: "success", message: "If that email is available, continue from the sign-in page." },
              );`;

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
          GET: kernel.wrapWebGuest(async (request) => {
            if ((process.env.FEATURE_REGISTRATION ?? "true") === "false") {
              return new Response("Not found", { status: 404 });
            }
            return renderPage("auth/register.eta", { layout: { title: "Create account" }, errors: {}, name: "", email: "", password: "" }, request);
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
                ${registerSuccessExisting}
              }
              const hashed = await hashPassword(password);
              await getSql().unsafe(
                "INSERT INTO users (${insertCols}) VALUES (${insertPh})",
                [name, email, hashed${insertTail}],
              );
              ${
                verify
                  ? `const created = await starterAuthDirectory.findByEmail?.(email);
              const insertedId = created?.id ?? 0;
              ${verifyRegisterBranch}`
                  : verifyRegisterBranch
              }
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
              await issueSignedAuthMail(email, "Reset your password", "/reset-password", AUTH_ONE_TIME_PURPOSES.passwordReset, user.id, { email });
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
              { layout: { title: "Reset password" }, errors: {}, password: "", email, action: \`\${new URL(request.url).pathname}\${new URL(request.url).search}\` },
              request,
            );
          }),
          POST: kernel.wrapWeb(async (request) => {
            const userId = await consumeSignedAuthToken(request, AUTH_ONE_TIME_PURPOSES.passwordReset);
            const { fields } = await parseFormBody(request);
            const email = new URL(request.url).searchParams.get("email") ?? fields.email ?? "";
            const password = fields.password ?? "";
            if (!userId || !email || password.length < 8) {
              return renderPage(
                "auth/reset-password.eta",
                { layout: { title: "Reset password" }, errors: { password: "Invalid or expired reset link." }, password: "", email, action: \`\${new URL(request.url).pathname}\${new URL(request.url).search}\` },
                request,
              );
            }
            await runAuthWrite(async () => {
              await getSql().unsafe(
              "UPDATE users SET password = ${passwordPh} WHERE id = ${idPh}",
              [await hashPassword(password), userId],
            );
            });
            await revokeUserSessions(userId);
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
              const id = await consumeSignedAuthToken(request, AUTH_ONE_TIME_PURPOSES.emailVerify);
              if (id) {
                await runAuthWrite(async () => {
                  await getSql().unsafe(
                  "UPDATE users SET email_verified_at = ${verifiedPh} WHERE id = ${idPh}",
                  [${nowTimestampLiteral(layers.database)}, id],
                );
                });
                return flashResponse(
                  redirectTo("/login"),
                  { level: "success", message: "Email verified. Sign in." },
                );
              }
              return flashResponse(
                redirectTo("/login"),
                { level: "error", message: "Invalid or expired verification link." },
              );
            }
            return renderPage("auth/verify-email.eta", { layout: { title: "Verify email" } }, request);
          }),
        },
        "/email/verification-notification": {
          POST: kernel.wrapWebAuthenticatedAllowUnverified(async (request) => {
            const user = await auth.user(request);
            if (user) {
              const record = await starterAuthDirectory.findByIdOrThrow(Number(user.id));
              await issueSignedAuthMail(record.email ?? "", "Verify your email", "/email/verify", AUTH_ONE_TIME_PURPOSES.emailVerify, Number(record.id), { id: String(record.id) });
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
            await persistAuthRecovery(pendingId, record.mfa_recovery_codes, mfaResult.consumedRecoveryHash);
            const signed = await auth.signInRedirect(sessionUser(record), "/");
            signed.headers.append("set-cookie", pendingMfaClearCookie());
            return signed;
          },
            async (request) =>
              renderPage(
                "auth/mfa-challenge.eta",
                { layout: { title: "MFA" }, errors: { code: "Too many login attempts. Try again shortly." }, code: "" },
                request,
                429,
              ),
          ),
        },
        "/confirm-password": {
          GET: kernel.wrapWebAuthenticated(async (request) =>
            renderPage("auth/confirm-password.eta", { layout: { title: "Confirm password" }, errors: {}, password: "" }, request),
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
                { layout: { title: "Confirm password" }, errors: { password: "That password is not correct." }, password: "" },
                request,
              );
            }
            const next = sanitizeInternalPath(new URL(request.url).searchParams.get("redirect") ?? "/account/mfa");
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
                  otpauth: buildOtpauthUrl({ secret, account: "user", issuer: process.env.APP_NAME ?? "Strata" }),
                },
                request,
              );
            }
            const recoveryCodes = generateRecoveryCodes();
            const stored = protectMfaSecret(secret);
            await runAuthWrite(async () => {
              await getSql().unsafe(
              "UPDATE users SET mfa_secret = ${mfaUpdatePh.split(", ")[0]}, mfa_enabled = ${mfaUpdatePh.split(", ")[1]}, mfa_recovery_codes = ${mfaUpdatePh.split(", ")[2]} WHERE id = ${mfaIdPh}",
              [stored, ${sqlTrue(layers)}, JSON.stringify(recoveryCodes.map((item) => hashRecoveryCode(item))), Number(user.id)],
            );
            });
            await revokeUserSessions(Number(user.id));
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
import { Note } from "../../models/Note.ts";
import { plainText, renderPage } from "../../lib/view.ts";

async function schemaReady(): Promise<boolean> {
  try {
    return (await Note.query().value("id")) !== null;
  } catch {
    return false;
  }
}

const siteModule: AppModule = {
  name: "site",
  order: 1,
  routes({ kernel }) {
    return {
      "/health": kernel.wrap("api", withErrorHandling(async () => {
        const ok = (await pingDatabase()) && (await schemaReady());
        return plainText(ok ? "ok" : "degraded", ok ? 200 : 503);
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
