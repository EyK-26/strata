import { authUsesJwt, authUsesToken } from "../types.ts";
import { renderMfaChallengeRoutes } from "./renderBrowserRoutes.ts";
import type { AuthRenderingContext } from "./renderingContext.ts";

export function renderApiAuthRoutes({
  layers,
  cookie,
  github,
  oidc,
  mfa,
  verify,
  bearerApi,
  jsonCookieAccounts,
  jsonAccounts,
}: Pick<
  AuthRenderingContext,
  | "layers"
  | "cookie"
  | "github"
  | "oidc"
  | "mfa"
  | "verify"
  | "bearerApi"
  | "jsonCookieAccounts"
  | "jsonAccounts"
>) {
  const browserMfa =
    cookie && mfa && (layers.frontend === "api" || layers.frontend === "spa-react");
  const mfaContinuation = browserMfa
    ? `
        ...applyMiddlewareToRoutes({
${renderMfaChallengeRoutes()}
        }, kernel.group("api")),`
    : "";
  const tokenLogin = authUsesToken(layers.auth)
    ? `
        "/api/v1/auth/login": {
          POST: kernel.wrap("api", kernel.wrapLogin(withErrorHandling(async (request) => {
            const { email, password, mfa_code } = await parseJsonBody(request, parseLoginCredentials);
            return runWithLoginUser(email, async (candidate) => {
            const mfaResult = await authenticatePasswordUser(candidate, password, mfa_code);
            if (!mfaResult.ok) {
              if (mfaResult.error === "invalid_credentials") {
                return privateJsonResponse({ error: "Invalid credentials" }, { status: 422 });
              }
              return privateJsonResponse({ error: mfaResult.error }, { status: mfaResult.error === "mfa_required" ? 401 : 422 });
            }
            const record = mfaResult.user;
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

  const jsonRegister = jsonAccounts
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
            return runWithLoginUser(email, async (candidate) => {
            const mfaResult = await authenticatePasswordUser(candidate, password, mfa_code);
            if (!mfaResult.ok) {
              if (mfaResult.error === "invalid_credentials") {
                return privateJsonResponse({ error: "Invalid credentials" }, { status: 422 });
              }
              return privateJsonResponse({ error: mfaResult.error }, { status: mfaResult.error === "mfa_required" ? 401 : 422 });
            }
            const record = mfaResult.user;
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

  const apiUser = bearerApi
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

  const jsonPassword = jsonAccounts
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
            const body = await parseJsonBody(request, (payload) => payload);
            const password = typeof body === "object" && body !== null && "password" in body ? body.password : undefined;
            if (!(await completeSignedPasswordReset(request, password))) {
              return privateJsonResponse({ error: "Invalid or expired reset link." }, { status: 403 });
            }
            return privateJsonResponse({ ok: true });
          }))),
        },`
    : "";

  const jsonVerify =
    jsonAccounts && verify
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

  const jsonAccountManagement = jsonCookieAccounts
    ? `
        ${
          verify
            ? `"/api/v1/auth/verification-notification": {
          POST: kernel.wrapApi(async (request) => {
            const user = await dependencies.container.resolve<CookieSessionAuthManager>(CORE_AUTH_TOKEN).requireUser(request);
            await runWithLockedAuthUser(Number(user.id), async (record) => {
              if (!record?.is_active || record.auth_version !== user.authVersion) throw new ConflictError("Account changed. Sign in again.");
              if (!record.email_verified_at) await issueSignedAuthMail(record.email ?? "", "Verify your email", "/api/v1/auth/verify-email", AUTH_ONE_TIME_PURPOSES.emailVerify, record.id, { id: String(record.id) });
            });
            return privateJsonResponse({ ok: true });
          }),
        },`
            : ""
        }
        ${
          mfa
            ? `"/api/v1/auth/confirm-password": {
          POST: kernel.wrap("api", kernel.wrapVerified(async (request) => {
            const user = await dependencies.container.resolve<CookieSessionAuthManager>(CORE_AUTH_TOKEN).requireUser(request);
            const { password } = await parseJsonBody(request, (payload) => validateObject(payload, { password: [required(), stringRule()] }));
            return runWithLockedAuthUser(Number(user.id), async (record) => {
              if (!record?.is_active || record.auth_version !== user.authVersion) throw new ConflictError("Account changed. Sign in again.");
              if (!record.password || !(await verifyPassword(String(password), record.password))) return privateJsonResponse({ error: "That password is not correct." }, { status: 422 });
              const response = privateJsonResponse({ ok: true });
              response.headers.append("set-cookie", createPasswordConfirmCookie(Number(user.id), record.auth_version));
              return response;
            });
          })),
        },
        "/api/v1/auth/mfa": {
          GET: kernel.wrap("api", kernel.wrapVerified(async (request) => {
            const user = await dependencies.container.resolve<CookieSessionAuthManager>(CORE_AUTH_TOKEN).requireUser(request);
            const record = await starterAuthDirectory.findByIdOrThrow(Number(user.id));
            const secret = generateTotpSecret();
            return privateJsonResponse({ secret, otpauth: buildOtpauthUrl({ secret, account: record.email ?? "user", issuer: process.env.APP_NAME ?? "Strata" }) });
          })),
          POST: kernel.wrap("api", kernel.wrapVerified(withMiddleware(createRequirePasswordConfirmMiddleware())(async (request) => {
            const user = await dependencies.container.resolve<CookieSessionAuthManager>(CORE_AUTH_TOKEN).requireUser(request);
            const fields = await parseJsonBody(request, (payload) => validateObject(payload, { secret: [required(), stringRule()], code: [required(), stringRule()] }));
            const secret = String(fields.secret).trim();
            if (!verifyTotp(secret, String(fields.code).trim())) return privateJsonResponse({ error: "Could not confirm that code." }, { status: 422 });
            const recoveryCodes = await enrollMfa(user, secret);
            return privateJsonResponse({ recoveryCodes });
          }))),
        },`
            : ""
        }`
    : "";

  const csrfRoute = `
        "/api/v1/auth/csrf": {
          GET: kernel.wrap("api", withErrorHandling(async (request) => {
            return privateJsonResponse({ token: resolveCsrfTokenForRequest(request) });
          })),
        },`;

  const cookieJsonAuth =
    cookie && !bearerApi
      ? `
        "/api/v1/auth/login": {
          POST: kernel.wrap("api", kernel.wrapLogin(withErrorHandling(async (request) => {
            const { email, password, mfa_code } = await parseJsonBody(request, parseLoginCredentials);
            return runWithLoginUser(email, async (candidate) => {
            const mfaResult = await authenticatePasswordUser(candidate, password, mfa_code);
            if (!mfaResult.ok) {
              if (mfaResult.error === "invalid_credentials") {
                return privateJsonResponse({ error: "Invalid credentials" }, { status: 422 });
              }
              return privateJsonResponse({ error: mfaResult.error }, { status: mfaResult.error === "mfa_required" ? 401 : 422 });
            }
            const record = mfaResult.user;
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
    bearerApi || cookie
      ? `
    routes({ kernel, dependencies }) {${
      browserMfa
        ? `
      // Browser SSO requires only its continuation view, not general web routes.
      const auth = dependencies.container.resolve<CookieSessionAuthManager>(CORE_AUTH_TOKEN);
      const views = dependencies.container.resolve(CORE_VIEW_RENDERER_TOKEN).namespace("auth", { headers: { "Cache-Control": "private, no-store" } });`
        : ""
    }
      return {${mfaContinuation}${csrfRoute}${samlRoutes}${githubRoutes}${oidcRoutes}${cookieJsonAuth}${tokenLogin}${jsonRegister}${jwtLogin}${apiUser}${jsonPassword}${jsonVerify}${jsonAccountManagement}
      };
    },`
      : "";
  return apiRoutes;
}
