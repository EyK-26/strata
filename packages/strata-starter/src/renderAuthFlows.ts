import {
  authNeedsUsers,
  authUsesJwt,
  authUsesToken,
  htmlAuthKit,
  type StarterLayers,
  usesTenantTable,
} from "./types.ts";

function renderPendingMfaTs(): string {
  return `import { createPendingMfaCookie, clearPendingMfaCookie, readPendingMfaCookie } from "@getstrata/core/auth/pendingMfaCookie";
import { sessionSecret } from "./config.ts";

export function pendingMfaSetCookie(userId: number, authVersion: number): string {
  return createPendingMfaCookie(userId, authVersion, sessionSecret());
}
export const pendingMfaClearCookie = clearPendingMfaCookie;
export function readPendingMfaChallenge(request: Request) {
  return readPendingMfaCookie(request, sessionSecret());
}
`;
}

function renderAuthModule(layers: StarterLayers): string | null {
  if (!authNeedsUsers(layers.auth)) {
    return null;
  }

  const cookie = htmlAuthKit(layers.auth);
  const github = Boolean(layers.extras.oauthGithub && cookie);
  const oidc = Boolean(layers.extras.oidc && cookie);
  const mfa = Boolean(layers.extras.mfa && cookie);
  const verify = Boolean(layers.extras.emailVerification);
  const jsonApi = authUsesToken(layers.auth) || authUsesJwt(layers.auth);
  const tenantInsert = usesTenantTable(layers.tenancy);
  const tenantCreateField = tenantInsert
    ? `
                tenant_id: currentTenantId(),`
    : "";
  const samlTenantCreateField = tenantInsert
    ? `
                  tenant_id: currentTenantId(),`
    : "";

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
    if (github) {
      imports.push(`import { GitHubOAuthProvider } from "@getstrata/core/auth/oauth/providers";`);
    }
    if (oidc) {
      imports.push(`import { OidcProvider } from "@getstrata/core/auth/oauth/oidcProvider";`);
    }
    if (github || oidc) {
      imports.push(`import { appUrl } from "@getstrata/core/runtime/appKeyPrefix";`);
    }
  }
  imports.push(`import { ConflictError } from "@getstrata/core/errors/http";`);
  if (jsonApi) {
    imports.push(`import { AuthManager } from "@getstrata/core/auth/guard";`);
  }
  if (authUsesJwt(layers.auth)) {
    imports.push(`import { jwtTtlSeconds, signJwt } from "@getstrata/core/auth/jwt";`);
  }
  imports.push(
    `import { afterCommit, runInTransaction } from "@getstrata/core/database/transaction";`,
  );
  imports.push(`import { hashPassword, verifyPassword } from "@getstrata/core/auth/password";`);
  imports.push(
    `import { AUTH_ONE_TIME_PURPOSES, consumeOneTimeToken, generateOneTimeToken, hashOneTimeToken, revokeUserSessions as revokeStoredUserSessions } from "@getstrata/core/auth/oneTimeToken";`,
  );
  imports.push(
    `import { completePasswordLogin, persistConsumedRecoveryHash } from "@getstrata/core/auth/passwordLogin";`,
  );
  if (mfa) {
    imports.push(
      `import { createPasswordConfirmCookie } from "@getstrata/core/auth/passwordConfirmCookie";`,
    );
  }
  imports.push(
    `import { emailRule, minLength, required, stringRule, validateObject } from "@getstrata/core/validation/rules";`,
  );
  imports.push(`import { parseJsonBody } from "@getstrata/core/http/validation";`);
  imports.push(`import { sqlTimestamp } from "@getstrata/core/database/dialect";`);
  if (authUsesToken(layers.auth)) {
    imports.push(`import { hashApiToken } from "@getstrata/core/auth/tokenHash";`);
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
      oidc
        ? `import { clearOidcPkceCookie, createOAuthState, readOidcPkceCookie, sealOidcPkceCookie, verifyOAuthState } from "@getstrata/core/security/oauthState";`
        : `import { createOAuthState, verifyOAuthState } from "@getstrata/core/security/oauthState";`,
    );
  }
  if (jsonApi || cookie) {
    imports.push(
      `import { privateJsonResponse, withErrorHandling } from "@getstrata/core/http/response";`,
    );
    imports.push(`import { resolveCsrfTokenForRequest } from "@getstrata/core/http/csrfToken";`);
  }
  imports.push(
    cookie && verify
      ? `import { absoluteTemporarySignedUrl, assertValidSignature } from "@getstrata/core/http/signedUrl";`
      : `import { absoluteTemporarySignedUrl } from "@getstrata/core/http/signedUrl";`,
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
    `import { runWithMigrationBypassForIdentifier } from "@getstrata/core/tenant/databaseTenantContext";`,
  );
  imports.push(
    `import { starterAuthDirectory, runWithLockedAuthUser, type StarterAuthUserRecord } from "../../bootstrap/authDirectory.ts";`,
  );
  imports.push(`import { getSql } from "../../bootstrap/database.ts";`);
  imports.push(`import { User } from "../../models/User.ts";`);
  imports.push(`import { AuthOneTimeToken } from "../../models/AuthOneTimeToken.ts";`);
  if (authUsesToken(layers.auth)) {
    imports.push(`import { ApiToken } from "../../models/ApiToken.ts";`);
  }
  if (cookie) {
    imports.push(`import { CORE_VIEW_RENDERER_TOKEN } from "@getstrata/core/view";`);
  }
  if (mfa) {
    imports.push(
      `import { pendingMfaClearCookie, pendingMfaSetCookie, readPendingMfaChallenge } from "../../bootstrap/pendingMfa.ts";`,
    );
  }

  const helpers = `
function parseLoginCredentials(payload: unknown) {
  const body = validateObject(payload, {
    email: [required(), stringRule(), emailRule()],
    password: [required(), stringRule()],
    mfa_code: [stringRule()],
  });
  return {
    email: String(body.email).toLowerCase(),
    password: String(body.password ?? ""),
    mfa_code: typeof body.mfa_code === "string" ? body.mfa_code : undefined,
  };
}

function parseRegisterCredentials(payload: unknown) {
  const body = validateObject(payload, {
    name: [required(), stringRule()],
    email: [required(), stringRule(), emailRule()],
    password: [required(), stringRule(), minLength(8)],
  });
  return {
    name: String(body.name ?? ""),
    email: String(body.email).toLowerCase(),
    password: String(body.password ?? ""),
  };
}

function parseForgotPasswordEmail(payload: unknown) {
  const body = validateObject(payload, {
    email: [required(), stringRule(), emailRule()],
  });
  return String(body.email).toLowerCase();
}

async function runWithLoginUser<T>(email: string, operation: (record: StarterAuthUserRecord | null) => Promise<T>): Promise<T> {
  const candidate = await starterAuthDirectory.findByEmail(email);
  if (!candidate) return operation(null);
  return runWithLockedAuthUser(candidate.id, async (record) => {
    // Recheck identity after locking: provisioning may have changed the email.
    return operation(record?.email === email.trim().toLowerCase() ? record : null);
  });
}

async function runAuthWrite<T>(identifier: string | number, callback: () => Promise<T>): Promise<T> {
  return await runWithMigrationBypassForIdentifier(identifier, callback);
}

async function prepareSignedAuthMail(to: string, subject: string, path: string, purpose: string, userId: number, extra: Record<string, string> = {}) {
  const issued = generateOneTimeToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await runAuthWrite(userId, async () => {
    await AuthOneTimeToken.create({
      purpose,
      user_id: userId,
      token_hash: issued.hash,
      expires_at: sqlTimestamp(expiresAt),
    });
  });
  const link = absoluteTemporarySignedUrl(path, 3600, { ...extra, token: issued.plain });
  return { to, subject, body: \`\${subject}\\n\\n\${link}\\n\` };
}

async function issueSignedAuthMail(to: string, subject: string, path: string, purpose: string, userId: number, extra: Record<string, string> = {}) {
  const message = await prepareSignedAuthMail(to, subject, path, purpose, userId, extra);
  await afterCommit(() => mailer().send(message));
}

async function createRegistration(credentials: { name: string; email: string; password: string }${verify ? ", verificationPath: string" : ""}) {
  const { email } = credentials;
  try {
    return await runAuthWrite(email, () => runInTransaction(async () => {
      ${verify ? "const created = " : ""}await User.create({
        ...credentials,
        is_admin: false,${tenantCreateField}
      });
      ${verify ? `return prepareSignedAuthMail(email, "Verify your email", verificationPath, AUTH_ONE_TIME_PURPOSES.emailVerify, Number(created.get("id")), { id: String(created.get("id")) });` : ""}
    }));
  } catch (error) {
    // The failed transaction/savepoint is already rolled back before readback.
    // Only an actual account race is neutral; unrelated persistence failures propagate.
    if (!(error instanceof ConflictError) || !(await starterAuthDirectory.findByEmail(email))) throw error;
    return undefined;
  }
}

async function consumeSignedAuthToken(request: Request, purpose: string): Promise<number | null> {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!token) {
    return null;
  }
  return await runAuthWrite(hashOneTimeToken(token), async () => consumeOneTimeToken(getSql(), purpose, token));
}

async function revokeUserSessions(userId: number) {
  await runAuthWrite(userId, async () => {
    await revokeStoredUserSessions(getSql(), userId, { incrementAuthVersion: true });
  });
}

${
  verify
    ? `
async function completeSignedEmailVerification(request: Request): Promise<boolean> {
  return await runInTransaction(async () => {
    const userId = await consumeSignedAuthToken(request, AUTH_ONE_TIME_PURPOSES.emailVerify);
    if (!userId) return false;
    await runAuthWrite(userId, async () => {
      const user = await User.find(userId);
      if (!user) throw new Error("Verification account no longer exists.");
      await user.update({ email_verified_at: sqlTimestamp() });
    });
    return true;
  });
}
`
    : ""
}

async function completeSignedPasswordReset(request: Request, password: unknown): Promise<boolean> {
  if (typeof password !== "string" || password.length < 8) return false;
  return await runInTransaction(async () => {
    const userId = await consumeSignedAuthToken(request, AUTH_ONE_TIME_PURPOSES.passwordReset);
    if (!userId) return false;
    await runAuthWrite(userId, async () => {
      const user = await User.where({ id: userId })${layers.database === "sqlite" ? "" : ".lockForUpdate()"}.first();
      if (!user) throw new Error("Reset account no longer exists.");
      await user.update({ password: await hashPassword(password) });
      await revokeStoredUserSessions(getSql(), userId, { incrementAuthVersion: true });
    });
    return true;
  });
}

async function persistAuthRecovery(
  userId: number,
  currentRaw: string | null | undefined,
  consumedHash: string | undefined,
) {
  await runAuthWrite(userId, async () => {
    await persistConsumedRecoveryHash(getSql(), userId, currentRaw, consumedHash);
  });
}
${
  cookie
    ? `
function redirectTo(path: string, status = 302): Response {
  return new Response(null, { status, headers: { location: path } });
}

function sessionUser(user: StarterAuthUserRecord) {
  return {
    id: user.id,
    name: user.name ?? user.email ?? "",
    email: user.email ?? "",
    is_admin: user.role === "admin",
    is_active: user.is_active,
    auth_version: user.auth_version,
  };
}

async function completeBrowserSsoLogin(
  dependencies: { container: { resolve: <T>(token: string) => T } },
  profile: { email: string; name: string },
  label: string,
): Promise<Response> {
  const email = profile.email.trim().toLowerCase();
  let record = await starterAuthDirectory.findByEmail?.(email);
  if (!record) {
    if ((process.env.FEATURE_REGISTRATION ?? "true") === "false") {
      return privateJsonResponse({ error: \`\${label} user is not provisioned.\` }, { status: 403 });
    }
    const hashed = await hashPassword(randomBytes(18).toString("hex"));
    try {
      await runAuthWrite(email, async () => {
        await User.create({
          name: profile.name,
          email,
          password: hashed,
          is_admin: false,${samlTenantCreateField}
        });
      });
    } catch {
      // Unique email: another request already provisioned this user.
    }
    record = await starterAuthDirectory.findByEmail?.(email);
  }
  if (!record) {
    return privateJsonResponse({ error: \`Could not complete \${label} login.\` }, { status: 500 });
  }
  return runWithLockedAuthUser(record.id, async (record) => {
    if (!record?.is_active || record.email !== email) return privateJsonResponse({ error: "Account unavailable." }, { status: 403 });
  ${
    mfa
      ? `if (record.mfa_enabled) {
    const pending = redirectTo("/login/mfa");
    pending.headers.append("set-cookie", pendingMfaSetCookie(record.id, record.auth_version));
    return pending;
  }
  `
      : ""
  }const auth = dependencies.container.resolve<CookieSessionAuthManager>(CORE_AUTH_TOKEN);
  return auth.signInRedirect(sessionUser(record), "/");
  });
}
`
    : ""
}`;

  const tokenLogin = authUsesToken(layers.auth)
    ? `
        "/api/v1/auth/login": {
          POST: kernel.wrap("api", kernel.wrapLogin(withErrorHandling(async (request) => {
            const { email, password, mfa_code } = await parseJsonBody(request, parseLoginCredentials);
            return runWithLoginUser(email, async (record) => {
            if (!record?.password || !(await verifyPassword(password, record.password))) {
              return privateJsonResponse({ error: "Invalid credentials" }, { status: 422 });
            }
            const mfaResult = completePasswordLogin(record, { mfaCode: mfa_code });
            if (!mfaResult.ok) {
              return privateJsonResponse({ error: mfaResult.error }, { status: mfaResult.error === "mfa_required" ? 401 : 422 });
            }
            await persistAuthRecovery(record.id, record.mfa_recovery_codes, mfaResult.consumedRecoveryHash);
            const user = { id: record.id, role: record.role };
            const plain = \`strp_\${randomBytes(24).toString("hex")}\`;
            // API_TOKEN_DEFAULT_EXPIRY_DAYS bounds every minted token; unset means no expiry.
            const expiryDays = resolveDefaultTokenExpiryDays();
            const expiresAt = expiryDays
              ? new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000)
              : null;
            await runAuthWrite(user.id, async () => {
              await ApiToken.create({
                user_id: user.id,
                name: "spa",
                token_hash: hashApiToken(plain),
                abilities: JSON.stringify([]),
                expires_at: expiresAt ? sqlTimestamp(expiresAt) : null,
              });
            });
            const payload = privateJsonResponse({ token: plain, expires_at: expiresAt?.toISOString() ?? null });
            ${
              cookie
                ? `const sessionAuth = dependencies.container.resolve<CookieSessionAuthManager>(CORE_AUTH_TOKEN);
            const { setCookie } = await sessionAuth.signIn(sessionUser(record));
            payload.headers.append("set-cookie", setCookie);
            `
                : ""
            }return payload;
            });
          }))),
        },
        "/api/v1/auth/me": {
          GET: kernel.wrapApi(async (request) => {
            const user = await dependencies.container.resolve<AuthManager>(CORE_AUTH_TOKEN).requireUser(request);
            const record = await starterAuthDirectory.findByIdOrThrow(Number(user.id));
            return privateJsonResponse({
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
            if ((process.env.FEATURE_REGISTRATION ?? "true") === "false") {
              return privateJsonResponse({ error: "Not found" }, { status: 404 });
            }
            const { name, email, password } = await parseJsonBody(request, parseRegisterCredentials);
            const existing = await starterAuthDirectory.findByEmail?.(email);
            await hashPassword(password);
            if (existing) {
              return privateJsonResponse({ ok: true }, { status: 201 });
            }
            const hashed = await hashPassword(password);
            ${verify ? "const verificationMail = " : ""}await createRegistration({ name, email, password: hashed }${verify ? ', "/api/v1/auth/verify-email"' : ""});
            ${verify ? "// SMTP follows the outermost commit, including request RLS.\n            if (verificationMail) await afterCommit(() => mailer().send(verificationMail));" : ""}
            return privateJsonResponse({ ok: true }, { status: 201 });
          }))),
        },`
    : "";

  const jwtLogin = authUsesJwt(layers.auth)
    ? `
        "/api/auth/token": {
          POST: kernel.wrap("api", kernel.wrapLogin(withErrorHandling(async (request) => {
            const { email, password, mfa_code } = await parseJsonBody(request, parseLoginCredentials);
            return runWithLoginUser(email, async (record) => {
            if (!record?.password || !(await verifyPassword(password, record.password))) {
              return privateJsonResponse({ error: "Invalid credentials" }, { status: 422 });
            }
            const mfaResult = completePasswordLogin(record, { mfaCode: mfa_code });
            if (!mfaResult.ok) {
              return privateJsonResponse({ error: mfaResult.error }, { status: mfaResult.error === "mfa_required" ? 401 : 422 });
            }
            await persistAuthRecovery(record.id, record.mfa_recovery_codes, mfaResult.consumedRecoveryHash);
            const user = { id: record.id, role: record.role, emailVerifiedAt: record.email_verified_at ?? null };
            const token = signJwt({
              sub: user.id,
              authVersion: record.auth_version,
              role: user.role,
              abilities: [],${
                verify ? "\n              emailVerifiedAt: user.emailVerifiedAt ?? null," : ""
              }
            });
            return privateJsonResponse({
              token,
              token_type: "bearer",
              expires_in: jwtTtlSeconds(),
            });
            });
          }))),
        },`
    : "";

  const apiUser = jsonApi
    ? `
        "/api/user": {
          GET: kernel.wrapApi(async (request) => {
            const user = await dependencies.container.resolve<AuthManager>(CORE_AUTH_TOKEN).requireUser(request);
            return privateJsonResponse({ id: user.id, role: user.role ?? "member" });
          }),
        },
        "/api/v1/auth/logout": {
          POST: kernel.wrap("api", withErrorHandling(async (request) => {
            const payload = privateJsonResponse({ ok: true });
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
            const email = await parseJsonBody(request, parseForgotPasswordEmail);
            const user = await starterAuthDirectory.findByEmail?.(email);
            if (user) {
              await issueSignedAuthMail(email, "Reset your password", "/api/v1/auth/reset-password", AUTH_ONE_TIME_PURPOSES.passwordReset, user.id, { email });
            }
            return privateJsonResponse({ ok: true });
          })),
        },
        "/api/v1/auth/reset-password": {
          POST: kernel.wrap("api", kernel.wrapSigned(withErrorHandling(async (request) => {
            const body: unknown = await request.json();
            const password = typeof body === "object" && body !== null && "password" in body ? body.password : undefined;
            if (!(await completeSignedPasswordReset(request, password))) {
              return privateJsonResponse({ error: "Invalid or expired reset link." }, { status: 403 });
            }
            return privateJsonResponse({ ok: true });
          }))),
        },`
    : "";

  const jsonVerify =
    jsonApi && verify
      ? `
        "/api/v1/auth/verify-email": {
          POST: kernel.wrap("api", kernel.wrapSigned(withErrorHandling(async (request) => {
            if (!(await completeSignedEmailVerification(request))) {
              return privateJsonResponse({ error: "Invalid or expired verification link." }, { status: 403 });
            }
            return privateJsonResponse({ ok: true });
          }))),
        },`
      : "";

  const csrfRoute = `
        "/api/v1/auth/csrf": {
          GET: kernel.wrap("api", withErrorHandling(async (request) => {
            return privateJsonResponse({ token: resolveCsrfTokenForRequest(request) });
          })),
        },`;

  const cookieJsonAuth =
    cookie && !jsonApi
      ? `
        "/api/v1/auth/login": {
          POST: kernel.wrap("api", kernel.wrapLogin(withErrorHandling(async (request) => {
            const { email, password, mfa_code } = await parseJsonBody(request, parseLoginCredentials);
            return runWithLoginUser(email, async (record) => {
            if (!record?.password || !(await verifyPassword(password, record.password))) {
              return privateJsonResponse({ error: "Invalid credentials" }, { status: 422 });
            }
            const mfaResult = completePasswordLogin(record, { mfaCode: mfa_code });
            if (!mfaResult.ok) {
              return privateJsonResponse({ error: mfaResult.error }, { status: mfaResult.error === "mfa_required" ? 401 : 422 });
            }
            await persistAuthRecovery(record.id, record.mfa_recovery_codes, mfaResult.consumedRecoveryHash);
            const sessionAuth = dependencies.container.resolve<CookieSessionAuthManager>(CORE_AUTH_TOKEN);
            const { setCookie } = await sessionAuth.signIn(sessionUser(record));
            const payload = privateJsonResponse({ ok: true });
            payload.headers.append("set-cookie", setCookie);
            return payload;
            });
          }))),
        },
        "/api/v1/auth/me": {
          GET: kernel.wrapApi(async (request) => {
            const user = await dependencies.container.resolve<CookieSessionAuthManager>(CORE_AUTH_TOKEN).requireUser(request);
            const record = await starterAuthDirectory.findByIdOrThrow(Number(user.id));
            return privateJsonResponse({
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
            const payload = privateJsonResponse({ ok: true });
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
              return privateJsonResponse({ error: "Invalid SAML state." }, { status: 403 });
            }
            const profile = await createSamlServiceProvider()
              .consumePost(samlResponse, relayState)
              .catch(() => null);
            if (!profile) {
              return privateJsonResponse({ error: "Invalid SAML response." }, { status: 400 });
            }
            return completeBrowserSsoLogin(dependencies, profile, "SAML");
          })),
        },`
    : "";

  const githubRoutes = github
    ? `
        "/auth/github": {
          GET: kernel.wrap("api", withErrorHandling(async () => {
            if (process.env.FEATURE_OAUTH !== "true") {
              return new Response("Not found", { status: 404 });
            }
            const clientId = process.env.GITHUB_CLIENT_ID?.trim();
            const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
            if (!clientId || !clientSecret) {
              return new Response("Not found", { status: 404 });
            }
            const redirectUri = process.env.GITHUB_REDIRECT_URI?.trim() || \`\${appUrl()}/auth/github/callback\`;
            const issued = createOAuthState();
            const url = new GitHubOAuthProvider({ clientId, clientSecret, redirectUri }).getAuthorizationUrl(issued.state);
            return new Response(null, { status: 302, headers: { location: url } });
          })),
        },
        "/auth/github/callback": {
          GET: kernel.wrap("api", withErrorHandling(async (request) => {
            if (process.env.FEATURE_OAUTH !== "true") {
              return new Response("Not found", { status: 404 });
            }
            const clientId = process.env.GITHUB_CLIENT_ID?.trim();
            const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
            if (!clientId || !clientSecret) {
              return new Response("Not found", { status: 404 });
            }
            const url = new URL(request.url);
            const code = url.searchParams.get("code");
            const state = url.searchParams.get("state");
            if (!code || !verifyOAuthState(request, state)) {
              return privateJsonResponse({ error: "Invalid GitHub OAuth state." }, { status: 403 });
            }
            const redirectUri = process.env.GITHUB_REDIRECT_URI?.trim() || \`\${appUrl()}/auth/github/callback\`;
            const profile = await new GitHubOAuthProvider({ clientId, clientSecret, redirectUri })
              .exchangeCode(code)
              .catch(() => null);
            if (!profile) {
              return privateJsonResponse({ error: "Invalid GitHub OAuth response." }, { status: 400 });
            }
            return completeBrowserSsoLogin(dependencies, profile, "GitHub");
          })),
        },`
    : "";

  const oidcRoutes = oidc
    ? `
        "/auth/oidc": {
          GET: kernel.wrap("api", withErrorHandling(async () => {
            if (process.env.FEATURE_OAUTH !== "true") {
              return new Response("Not found", { status: 404 });
            }
            const issuer = process.env.OIDC_ISSUER?.trim();
            const clientId = process.env.OIDC_CLIENT_ID?.trim();
            const clientSecret = process.env.OIDC_CLIENT_SECRET?.trim();
            if (!issuer || !clientId || !clientSecret) {
              return new Response("Not found", { status: 404 });
            }
            const redirectUri = process.env.OIDC_REDIRECT_URI?.trim() || \`\${appUrl()}/auth/oidc/callback\`;
            const issued = createOAuthState();
            const provider = new OidcProvider({ name: "oidc", issuer, clientId, clientSecret, redirectUri });
            const { url, handshake } = await provider.createAuthorization(issued.state);
            const redirect = new Response(null, { status: 302, headers: { location: url } });
            redirect.headers.append(
              "set-cookie",
              sealOidcPkceCookie({ state: issued.state, nonce: handshake.nonce, codeVerifier: handshake.codeVerifier }),
            );
            return redirect;
          })),
        },
        "/auth/oidc/callback": {
          GET: kernel.wrap("api", withErrorHandling(async (request) => {
            if (process.env.FEATURE_OAUTH !== "true") {
              return new Response("Not found", { status: 404 });
            }
            const issuer = process.env.OIDC_ISSUER?.trim();
            const clientId = process.env.OIDC_CLIENT_ID?.trim();
            const clientSecret = process.env.OIDC_CLIENT_SECRET?.trim();
            if (!issuer || !clientId || !clientSecret) {
              return new Response("Not found", { status: 404 });
            }
            const url = new URL(request.url);
            const code = url.searchParams.get("code");
            const state = url.searchParams.get("state");
            const pkce = readOidcPkceCookie(request, state);
            if (!code || !verifyOAuthState(request, state) || !pkce) {
              const denied = privateJsonResponse({ error: "Invalid OIDC state." }, { status: 403 });
              denied.headers.append("set-cookie", clearOidcPkceCookie());
              return denied;
            }
            const redirectUri = process.env.OIDC_REDIRECT_URI?.trim() || \`\${appUrl()}/auth/oidc/callback\`;
            const profile = await new OidcProvider({ name: "oidc", issuer, clientId, clientSecret, redirectUri })
              .exchangeCode(code, redirectUri, pkce)
              .catch(() => null);
            if (!profile) {
              const failed = privateJsonResponse({ error: "Invalid OIDC response." }, { status: 400 });
              failed.headers.append("set-cookie", clearOidcPkceCookie());
              return failed;
            }
            const login = await completeBrowserSsoLogin(dependencies, profile, "OIDC");
            login.headers.append("set-cookie", clearOidcPkceCookie());
            return login;
          })),
        },`
    : "";

  const apiRoutes =
    jsonApi || cookie
      ? `
    routes({ kernel, dependencies }) {
      return {${csrfRoute}${samlRoutes}${githubRoutes}${oidcRoutes}${cookieJsonAuth}${tokenLogin}${jsonRegister}${jwtLogin}${apiUser}${jsonPassword}${jsonVerify}
      };
    },`
      : "";

  const mfaLoginBranch = `const mfaResult = completePasswordLogin(user, { mfaCode: mfa_code });
              if (!mfaResult.ok) {
                ${
                  mfa
                    ? `if (mfaResult.error === "mfa_required") {
                  const pending = redirectTo("/login/mfa");
                  pending.headers.append("set-cookie", pendingMfaSetCookie(user.id, user.auth_version));
                  return pending;
                }`
                    : ""
                }
                return views.render("login.eta", { layout: { title: "Sign in" }, errors: { email: "These credentials do not match our records." }, email, password: "" }, { request });
              }
              await persistAuthRecovery(user.id, user.mfa_recovery_codes, mfaResult.consumedRecoveryHash);`;

  const registerSuccessExisting = `return flashResponse(
                redirectTo("/login"),
                { level: "success", message: "If that email is available, continue from the sign-in page." },
              );`;

  const verifyRegisterBranch = `return flashResponse(
                redirectTo("/login"),
                { level: "success", message: "If that email is available, continue from the sign-in page." },
              );`;

  const cookieRoutes = cookie
    ? `
    webRoutes({ kernel, dependencies }) {
      const auth = dependencies.container.resolve<CookieSessionAuthManager>(CORE_AUTH_TOKEN);
      const views = dependencies.container.resolve(CORE_VIEW_RENDERER_TOKEN).namespace("auth", { headers: { "Cache-Control": "private, no-store" } });
      return {
        "/login": {
          GET: kernel.wrapWebGuest(async (request) =>
            views.render("login.eta", { layout: { title: "Sign in" }, errors: {}, email: "", password: "" }, { request }),
          ),
          POST: wrapWebLogin(
            kernel,
            async (request) => {
              const { fields } = await parseFormBody(request);
              const { email, password, mfa_code } = parseLoginCredentials(fields);
              return runWithLoginUser(email, async (user) => {
              if (!user?.password || !(await verifyPassword(password, user.password))) {
                return views.render("login.eta", { layout: { title: "Sign in" }, errors: { email: "These credentials do not match our records." }, email, password: "" }, { request });
              }
              ${mfaLoginBranch}
              return auth.signInRedirect(sessionUser(user), "/");
              });
            },
            async (request) =>
              views.render("login.eta", { layout: { title: "Sign in" }, errors: { email: "Too many login attempts. Try again shortly." }, email: "", password: "" }, { request, status: 429 }),
          ),
        },
        "/register": {
          GET: kernel.wrapWebGuest(async (request) => {
            if ((process.env.FEATURE_REGISTRATION ?? "true") === "false") {
              return new Response("Not found", { status: 404 });
            }
            return views.render("register.eta", { layout: { title: "Create account" }, errors: {}, name: "", email: "", password: "" }, { request });
          }),
          POST: wrapWebRegister(
            kernel,
            async (request) => {
              if ((process.env.FEATURE_REGISTRATION ?? "true") === "false") {
                return new Response("Not found", { status: 404 });
              }
              const { fields } = await parseFormBody(request);
              const { name, email, password } = parseRegisterCredentials(fields);
              const existing = await starterAuthDirectory.findByEmail?.(email);
              await hashPassword(password);
              if (existing) {
                ${registerSuccessExisting}
              }
              const hashed = await hashPassword(password);
              ${verify ? "const verificationMail = " : ""}await createRegistration({ name, email, password: hashed }${verify ? ', "/email/verify"' : ""});
              ${verify ? "// SMTP follows the outermost commit, including request RLS.\n              if (verificationMail) await afterCommit(() => mailer().send(verificationMail));" : ""}
              ${verifyRegisterBranch}
            },
            async (request) =>
              views.render("register.eta", { layout: { title: "Create account" }, errors: { form: "Too many registration attempts. Try again shortly." }, name: "", email: "", password: "" }, { request, status: 429 }),
          ),
        },
        "/forgot-password": {
          GET: kernel.wrapWebGuest(async (request) =>
            views.render("forgot-password.eta", { layout: { title: "Forgot password" }, errors: {}, email: "" }, { request }),
          ),
          POST: kernel.wrapWeb(async (request) => {
            const { fields } = await parseFormBody(request);
            const email = parseForgotPasswordEmail(fields);
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
          GET: kernel.wrapWeb(kernel.wrapSigned(async (request) => {
            const email = new URL(request.url).searchParams.get("email") ?? "";
            return views.render("reset-password.eta", { layout: { title: "Reset password" }, errors: {}, password: "", email, action: \`\${new URL(request.url).pathname}\${new URL(request.url).search}\` }, { request });
          })),
          POST: kernel.wrapWeb(kernel.wrapSigned(async (request) => {
            const { fields } = await parseFormBody(request);
            const email = new URL(request.url).searchParams.get("email") ?? fields.email ?? "";
            const password = fields.password ?? "";
            if (!email || !(await completeSignedPasswordReset(request, password))) {
              return views.render("reset-password.eta", { layout: { title: "Reset password" }, errors: { password: "Invalid or expired reset link." }, password: "", email, action: \`\${new URL(request.url).pathname}\${new URL(request.url).search}\` }, { request });
            }
            return flashResponse(redirectTo("/login"), { level: "success", message: "Password updated. Sign in." });
          })),
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
              if (await completeSignedEmailVerification(request)) {
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
            return views.render("verify-email.eta", { layout: { title: "Verify email" } }, { request });
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
            const pending = readPendingMfaChallenge(request);
            const record = pending ? await starterAuthDirectory.findByIdOrThrow(pending.userId).catch(() => null) : null;
            if (!record?.is_active || record.auth_version !== pending?.authVersion) return redirectTo("/login");
            return views.render("mfa-challenge.eta", { layout: { title: "MFA" }, errors: {}, code: "" }, { request });
          }),
          POST: wrapWebLogin(
            kernel,
            async (request) => {
            const pending = readPendingMfaChallenge(request);
            if (!pending) {
              return redirectTo("/login");
            }
            const { fields } = await parseFormBody(request);
            const submitted = (fields.code ?? "").trim();
            return runWithLockedAuthUser(pending.userId, async (record) => {
            if (!record?.is_active || record.auth_version !== pending.authVersion) {
              const failed = redirectTo("/login");
              failed.headers.append("set-cookie", pendingMfaClearCookie());
              return failed;
            }
            const mfaResult = completePasswordLogin(record, { mfaCode: submitted });
            if (!mfaResult.ok) {
              return views.render("mfa-challenge.eta", { layout: { title: "MFA" }, errors: { code: "That code is not valid." }, code: "" }, { request });
            }
            await persistAuthRecovery(pending.userId, record.mfa_recovery_codes, mfaResult.consumedRecoveryHash);
            const signed = await auth.signInRedirect(sessionUser(record), "/");
            signed.headers.append("set-cookie", pendingMfaClearCookie());
            return signed;
            });
          },
            async (request) =>
              views.render("mfa-challenge.eta", { layout: { title: "MFA" }, errors: { code: "Too many login attempts. Try again shortly." }, code: "" }, { request, status: 429 }),
          ),
        },
        "/confirm-password": {
          GET: kernel.wrapWebAuthenticated(async (request) =>
            views.render("confirm-password.eta", { layout: { title: "Confirm password" }, errors: {}, password: "" }, { request }),
          ),
          POST: kernel.wrapWebAuthenticated(async (request) => {
            const user = await auth.user(request);
            if (!user) {
              return redirectTo("/login");
            }
            const { fields } = await parseFormBody(request);
            const password = fields.password ?? "";
            return runWithLockedAuthUser(Number(user.id), async (record) => {
            if (!record?.is_active || record.auth_version !== user.authVersion) return redirectTo("/login");
            if (!record.password || !(await verifyPassword(password, record.password))) {
              return views.render("confirm-password.eta", { layout: { title: "Confirm password" }, errors: { password: "That password is not correct." }, password: "" }, { request });
            }
            const next = sanitizeInternalPath(new URL(request.url).searchParams.get("redirect") ?? "/account/mfa");
            const confirmed = redirectTo(next);
            confirmed.headers.append("set-cookie", createPasswordConfirmCookie(Number(user.id), record.auth_version));
            return confirmed;
            });
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
            return views.render("mfa-setup.eta", { layout: { title: "MFA" }, errors: {}, code: "", secret, otpauth }, { request });
          }),
          POST: kernel.wrapWebPasswordConfirm(async (request) => {
            const user = await auth.user(request);
            if (!user) {
              return redirectTo("/login");
            }
            const { fields } = await parseFormBody(request);
            const secret = (fields.secret ?? "").trim();
            const submitted = (fields.code ?? "").trim();
            if (!secret || !verifyTotp(secret, submitted)) {
              return views.render("mfa-setup.eta", {
                  layout: { title: "MFA" },
                  errors: { code: "Could not confirm that code." },
                  code: "",
                  secret,
                  otpauth: buildOtpauthUrl({ secret, account: "user", issuer: process.env.APP_NAME ?? "Strata" }),
                }, { request });
            }
            const recoveryCodes = generateRecoveryCodes();
            const stored = protectMfaSecret(secret);
            const previous = await runAuthWrite(Number(user.id), () => User.find(Number(user.id)));
            if (!previous || previous.get("auth_version") !== user.authVersion || !(previous.get("is_active") === true || previous.get("is_active") === 1)) throw new ConflictError("MFA configuration changed. Reload and confirm again.");
            await runInTransaction(async () => {
              await runAuthWrite(Number(user.id), async () => {
                // Trusted, pre-protected security fields: atomically replace only the state we read.
                const changed = await previous.getRepository().updateWhere({
                  mfa_secret: stored,
                  mfa_enabled: true,
                  mfa_recovery_codes: JSON.stringify(recoveryCodes.map((item) => hashRecoveryCode(item))),
                }, { where: {
                  id: Number(user.id),
                  is_active: previous.get("is_active"),
                  auth_version: previous.get("auth_version"),
                  mfa_enabled: previous.get("mfa_enabled"),
                  mfa_secret: previous.get("mfa_secret"),
                  mfa_recovery_codes: previous.get("mfa_recovery_codes"),
                  session_valid_after: previous.get("session_valid_after"),
                } });
                if (changed !== 1) throw new ConflictError("MFA configuration changed. Reload and confirm again.");
              });
              await revokeUserSessions(Number(user.id));
            });
            return views.render("mfa-setup.eta", {
                layout: { title: "MFA" },
                errors: {},
                code: "",
                secret,
                otpauth: buildOtpauthUrl({ secret, account: "user", issuer: process.env.APP_NAME ?? "Strata" }),
                recoveryCodes,
              }, { request });
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
import { CORE_VIEW_RENDERER_TOKEN } from "@getstrata/core/view";

const siteModule: AppModule = {
  name: "site",
  order: 1,
  webRoutes({ kernel, dependencies }) {
    const views = dependencies.container.resolve(CORE_VIEW_RENDERER_TOKEN);
    return {
      "/": kernel.wrapWeb(async (request) =>
        views.renderHtmx("home.eta", { layout: { title: "Welcome", description: "Welcome to your Strata app. Restyle views/home.eta and public/assets/site.css." } }, { request }),
      ),
    };
  },
};

export default siteModule;
`;
}

export { renderAuthModule, renderPendingMfaTs, renderSiteModule };
