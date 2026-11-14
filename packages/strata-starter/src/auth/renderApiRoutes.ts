import { renderMfaChallengeRoutes } from "./renderBrowserRoutes.ts";
import type { AuthRenderingContext } from "./renderingContext.ts";

export function renderApiAuthRoutes({
  plan,
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
  | "plan"
  | "cookie"
  | "github"
  | "oidc"
  | "mfa"
  | "verify"
  | "bearerApi"
  | "jsonCookieAccounts"
  | "jsonAccounts"
>) {
  const browserMfa = plan.decisions.mfaViews;
  const mfaContinuation = browserMfa
    ? `
        ...kernel.wrapRouteMap({
${renderMfaChallengeRoutes()}
        }, kernel.group("api")),`
    : "";
  const tokenLogin = plan.decisions.token
    ? `
        "/api/v1/auth/login": {
          POST: kernel.wrap("api", kernel.wrapLogin(kernel.wrapIdentity(async (request, _ports) => {
            const { email, password, mfa_code } = await parseJsonBody(request, parseLoginCredentials);
            return runWithLoginUser(_ports, email, async (candidate, _ports) => {
            const mfaResult = await authenticatePasswordUser(_ports, authServices, candidate, password, mfa_code);
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
            const expiryDays = authServices.config.tokenExpiryDays;
            const expiresAt = expiryDays
              ? new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000)
              : null;
            await runAuthWrite(_ports, user.id, async (_ports) => {
              await _ports.database.model(ApiToken).create({
                user_id: user.id,
                name: "spa",
                token_hash: hashApiToken(plain),
                abilities: JSON.stringify([]),
                expires_at: expiresAt ? authTimestamp(_ports, expiresAt) : null,
              });
            });
            const payload = privateJsonResponse({ token: plain, expires_at: expiresAt?.toISOString() ?? null });
            ${
              cookie
                ? `const sessionAuth = authServices.session(_ports);
            const { setCookie } = await sessionAuth.signIn(sessionUser(record));
            payload.headers.append("set-cookie", setCookie);
            `
                : ""
            }return payload;
            });
          }))),
        },
        "/api/v1/auth/me": {
          GET: kernel.wrapApi(kernel.wrapIdentity(async (request, _ports) => {
            const user = await _ports.auth.requireUser(request);
            const record = await authServices.directory(_ports).findByIdOrThrow(Number(user.id));
            return privateJsonResponse({
              id: record.id,
              name: record.name ?? record.email,
              email: record.email,
              role: record.role,
            });
          })),
        },`
    : "";

  const jsonRegister = jsonAccounts
    ? `
        "/api/v1/auth/register": {
          POST: kernel.wrap("api", kernel.wrapRegister(kernel.wrapIdentity(async (request, _ports) => {
            if (!authServices.config.registrationEnabled) {
              return privateJsonResponse({ error: "Not found" }, { status: 404 });
            }
            const { name, email, password } = await parseJsonBody(request, parseRegisterCredentials);
            const existing = await authServices.directory(_ports).findByEmail?.(email);
            await hashPassword(password);
            if (existing) {
              return privateJsonResponse({ ok: true }, { status: 201 });
            }
            const hashed = await hashPassword(password);
            ${verify ? "const verificationMail = " : ""}await createRegistration(_ports, authServices, { name, email, password: hashed }${verify ? ', "/api/v1/auth/verify-email"' : ""});
            ${verify ? "// SMTP follows the outermost commit, including request RLS.\n            if (verificationMail) await deferAuthEffect(_ports, () => authServices.mail.send(verificationMail));" : ""}
            return privateJsonResponse({ ok: true }, { status: 201 });
          }))),
        },`
    : "";

  const jwtLogin = plan.decisions.jwt
    ? `
        "/api/auth/token": {
          POST: kernel.wrap("api", kernel.wrapLogin(kernel.wrapIdentity(async (request, _ports) => {
            const { email, password, mfa_code } = await parseJsonBody(request, parseLoginCredentials);
            return runWithLoginUser(_ports, email, async (candidate, _ports) => {
            const mfaResult = await authenticatePasswordUser(_ports, authServices, candidate, password, mfa_code);
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
            }, { secret: authServices.config.jwtSecret, ttlSeconds: authServices.config.jwtTtlSeconds });
            return privateJsonResponse({
              token,
              token_type: "bearer",
              expires_in: authServices.config.jwtTtlSeconds,
            });
            });
          }))),
        },`
    : "";

  const apiUser = bearerApi
    ? `
        "/api/user": {
          GET: kernel.wrapApi(async (request, _ports) => {
            const user = await _ports.auth.requireUser(request);
            return privateJsonResponse({ id: user.id, role: user.role ?? "member" });
          }),
        },
        "/api/v1/auth/logout": {
          POST: kernel.wrap("api", ${cookie ? "kernel.wrapIdentity(" : ""}async (request, _ports) => {
            const payload = privateJsonResponse({ ok: true });
            ${
              cookie
                ? `const sessionAuth = authServices.session(_ports);
            const { setCookie } = await sessionAuth.signOut(request);
            payload.headers.append("set-cookie", setCookie);
            `
                : ""
            }return payload;
          }${cookie ? ")" : ""}),
        },`
    : "";

  const jsonPassword = jsonAccounts
    ? `
        "/api/v1/auth/forgot-password": {
          POST: kernel.wrap("api", kernel.wrapIdentity(async (request, _ports) => {
            const email = await parseJsonBody(request, parseForgotPasswordEmail);
            const user = await authServices.directory(_ports).findByEmail?.(email);
            if (user) {
              await issueSignedAuthMail(_ports, authServices, email, "Reset your password", "/api/v1/auth/reset-password", AUTH_ONE_TIME_PURPOSES.passwordReset, user.id, { email });
            }
            return privateJsonResponse({ ok: true });
          })),
        },
        "/api/v1/auth/reset-password": {
          POST: kernel.wrap("api", kernel.wrapSigned(kernel.wrapIdentity(async (request, _ports) => {
            const body = await parseJsonBody(request, (payload) => payload);
            const password = typeof body === "object" && body !== null && "password" in body ? body.password : undefined;
            if (!(await completeSignedPasswordReset(_ports, request, password))) {
              return privateJsonResponse({ error: "Invalid or expired reset link." }, { status: 403 });
            }
            return privateJsonResponse({ ok: true });
          }))),
        },`
    : "";

  const jsonVerify = plan.decisions.jsonVerification
    ? `
        "/api/v1/auth/verify-email": {
          POST: kernel.wrap("api", kernel.wrapSigned(kernel.wrapIdentity(async (request, _ports) => {
            if (!(await completeSignedEmailVerification(_ports, request))) {
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
          POST: kernel.wrapApi(kernel.wrapIdentity(async (request, _ports) => {
            const user = await _ports.auth.requireUser(request);
            await runWithLockedAccount(_ports, Number(user.id), async (record, _ports) => {
              if (!record?.is_active || record.auth_version !== user.authVersion) throw new ConflictError("Account changed. Sign in again.");
              if (!record.email_verified_at) await issueSignedAuthMail(_ports, authServices, record.email ?? "", "Verify your email", "/api/v1/auth/verify-email", AUTH_ONE_TIME_PURPOSES.emailVerify, record.id, { id: String(record.id) });
            });
            return privateJsonResponse({ ok: true });
          })),
        },`
            : ""
        }
        ${
          mfa
            ? `"/api/v1/auth/confirm-password": {
          POST: kernel.wrap("api", kernel.wrapVerified(kernel.wrapIdentity(async (request, _ports) => {
            const user = await _ports.auth.requireUser(request);
            const { password } = await parseJsonBody(request, (payload) => validateObject(payload, { password: [required(), stringRule()] }));
            return runWithLockedAccount(_ports, Number(user.id), async (record, _ports) => {
              if (!record?.is_active || record.auth_version !== user.authVersion) throw new ConflictError("Account changed. Sign in again.");
              if (!record.password || !(await verifyPassword(String(password), record.password))) return privateJsonResponse({ error: "That password is not correct." }, { status: 422 });
              const response = privateJsonResponse({ ok: true });
              response.headers.append("set-cookie", createPasswordConfirmCookie(Number(user.id), record.auth_version, authServices.config.passwordConfirmation));
              return response;
            });
          }))),
        },
        "/api/v1/auth/mfa": {
          GET: kernel.wrap("api", kernel.wrapVerified(kernel.wrapIdentity(async (request, _ports) => {
            const user = await _ports.auth.requireUser(request);
            const record = await authServices.directory(_ports).findByIdOrThrow(Number(user.id));
            const secret = generateTotpSecret();
            return privateJsonResponse({ secret, otpauth: buildOtpauthUrl({ secret, account: record.email ?? "user", issuer: authServices.config.appName }) });
          }))),
          POST: kernel.wrap("api", kernel.wrapVerified(kernel.wrapPasswordConfirm(kernel.wrapIdentity(async (request, _ports) => {
            const user = await _ports.auth.requireUser(request);
            const fields = await parseJsonBody(request, (payload) => validateObject(payload, { secret: [required(), stringRule()], code: [required(), stringRule()] }));
            const secret = String(fields.secret).trim();
            if (!verifyTotp(secret, String(fields.code).trim())) return privateJsonResponse({ error: "Could not confirm that code." }, { status: 422 });
            const recoveryCodes = await enrollMfa(_ports, authServices, user, secret);
            return privateJsonResponse({ recoveryCodes });
          })))),
        },`
            : ""
        }`
    : "";

  const csrfRoute = `
        "/api/v1/auth/csrf": {
          GET: kernel.wrap("api", async (request, _ports) => {
            return privateJsonResponse({ token: resolveCsrfTokenForRequest(request, authServices.csrf) });
          }),
        },`;

  const cookieJsonAuth = plan.decisions.cookieJsonLogin
    ? `
        "/api/v1/auth/login": {
          POST: kernel.wrap("api", kernel.wrapLogin(kernel.wrapIdentity(async (request, _ports) => {
            const { email, password, mfa_code } = await parseJsonBody(request, parseLoginCredentials);
            return runWithLoginUser(_ports, email, async (candidate, _ports) => {
            const mfaResult = await authenticatePasswordUser(_ports, authServices, candidate, password, mfa_code);
            if (!mfaResult.ok) {
              if (mfaResult.error === "invalid_credentials") {
                return privateJsonResponse({ error: "Invalid credentials" }, { status: 422 });
              }
              return privateJsonResponse({ error: mfaResult.error }, { status: mfaResult.error === "mfa_required" ? 401 : 422 });
            }
            const record = mfaResult.user;
            const sessionAuth = authServices.session(_ports);
            const { setCookie } = await sessionAuth.signIn(sessionUser(record));
            const payload = privateJsonResponse({ ok: true });
            payload.headers.append("set-cookie", setCookie);
            return payload;
            });
          }))),
        },
        "/api/v1/auth/me": {
          GET: kernel.wrapApi(kernel.wrapIdentity(async (request, _ports) => {
            const user = await _ports.auth.requireUser(request);
            const record = await authServices.directory(_ports).findByIdOrThrow(Number(user.id));
            return privateJsonResponse({
              id: record.id,
              name: record.name ?? record.email,
              email: record.email,
              role: record.role,
            });
          })),
        },
        "/api/v1/auth/logout": {
          POST: kernel.wrap("api", kernel.wrapIdentity(async (request, _ports) => {
            const sessionAuth = authServices.session(_ports);
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
          GET: kernel.wrap("api", async (_request, _ports) => {
            if (!authServices.config.samlEnabled) {
              return new Response("Not found", { status: 404 });
            }
            const issued = createSamlStateCookie(authServices.config.oauth);
            const url = await authServices.saml(_ports).authorizationUrl(issued.state);
            return new Response(null, { status: 302, headers: { location: url, "set-cookie": issued.cookie } });
          }),
        },
        "/auth/saml/acs": {
          POST: kernel.wrap("api", kernel.wrapIdentity(async (request, _ports) => {
            if (!authServices.config.samlEnabled) {
              return new Response("Not found", { status: 404 });
            }
            const form = await request.formData();
            const samlResponse = String(form.get("SAMLResponse") ?? "");
            const relayState = String(form.get("RelayState") ?? "");
            if (!verifySamlState(request, relayState, authServices.config.oauth)) {
              const denied = privateJsonResponse({ error: "Invalid SAML state." }, { status: 403 });
              denied.headers.append("set-cookie", clearSamlStateCookie());
              return denied;
            }
            const profile = await authServices.saml(_ports)
              .consumePost(samlResponse, relayState)
              .catch(() => null);
            if (!profile) {
              const failed = privateJsonResponse({ error: "Invalid SAML response." }, { status: 400 });
              failed.headers.append("set-cookie", clearSamlStateCookie());
              return failed;
            }
            const login = await completeBrowserSsoLogin(_ports, authServices, profile, "SAML");
            login.headers.append("set-cookie", clearSamlStateCookie());
            return login;
          })),
        },`
    : "";

  const githubRoutes = github
    ? `
        "/auth/github": {
          GET: kernel.wrap("api", async (_request, _ports) => {
            if (!authServices.config.oauthEnabled) {
              return new Response("Not found", { status: 404 });
            }
            const clientId = authServices.config.github.clientId;
            const clientSecret = authServices.config.github.clientSecret;
            if (!clientId || !clientSecret) {
              return new Response("Not found", { status: 404 });
            }
            const redirectUri = authServices.config.github.redirectUri;
            const issued = createOAuthStateCookie(authServices.config.oauth);
            const url = new GitHubOAuthProvider({ clientId, clientSecret, redirectUri, production: authServices.config.github.production, userAgent: authServices.config.github.userAgent }).getAuthorizationUrl(issued.state);
            return new Response(null, { status: 302, headers: { location: url, "set-cookie": issued.cookie } });
          }),
        },
        "/auth/github/callback": {
          GET: kernel.wrap("api", kernel.wrapIdentity(async (request, _ports) => {
            if (!authServices.config.oauthEnabled) {
              return new Response("Not found", { status: 404 });
            }
            const clientId = authServices.config.github.clientId;
            const clientSecret = authServices.config.github.clientSecret;
            if (!clientId || !clientSecret) {
              return new Response("Not found", { status: 404 });
            }
            const url = new URL(request.url);
            const code = url.searchParams.get("code");
            const state = url.searchParams.get("state");
            if (!code || !verifyOAuthState(request, state, authServices.config.oauth)) {
              const denied = privateJsonResponse({ error: "Invalid GitHub OAuth state." }, { status: 403 });
              denied.headers.append("set-cookie", clearOAuthStateCookie(authServices.config.oauth));
              return denied;
            }
            const redirectUri = authServices.config.github.redirectUri;
            const profile = await new GitHubOAuthProvider({ clientId, clientSecret, redirectUri, production: authServices.config.github.production, userAgent: authServices.config.github.userAgent })
              .exchangeCode(code)
              .catch(() => null);
            if (!profile) {
              const failed = privateJsonResponse({ error: "Invalid GitHub OAuth response." }, { status: 400 });
              failed.headers.append("set-cookie", clearOAuthStateCookie(authServices.config.oauth));
              return failed;
            }
            const login = await completeBrowserSsoLogin(_ports, authServices, profile, "GitHub");
            login.headers.append("set-cookie", clearOAuthStateCookie(authServices.config.oauth));
            return login;
          })),
        },`
    : "";

  const oidcRoutes = oidc
    ? `
        "/auth/oidc": {
          GET: kernel.wrap("api", async (_request, _ports) => {
            if (!authServices.config.oauthEnabled) {
              return new Response("Not found", { status: 404 });
            }
            const issuer = authServices.config.oidc.issuer;
            const clientId = authServices.config.oidc.clientId;
            const clientSecret = authServices.config.oidc.clientSecret;
            if (!issuer || !clientId || !clientSecret) {
              return new Response("Not found", { status: 404 });
            }
            const redirectUri = authServices.config.oidc.redirectUri;
            const issued = createOAuthState(authServices.config.oauth);
            const provider = new OidcProvider({ name: "oidc", issuer, clientId, clientSecret, redirectUri, networkPolicy: authServices.config.oidc.networkPolicy });
            const { url, handshake } = await provider.createAuthorization(issued.state);
            const redirect = new Response(null, { status: 302, headers: { location: url } });
            redirect.headers.append(
              "set-cookie",
              sealOidcPkceCookie({ state: issued.state, nonce: handshake.nonce, codeVerifier: handshake.codeVerifier }, authServices.config.oauth),
            );
            return redirect;
          }),
        },
        "/auth/oidc/callback": {
          GET: kernel.wrap("api", kernel.wrapIdentity(async (request, _ports) => {
            if (!authServices.config.oauthEnabled) {
              return new Response("Not found", { status: 404 });
            }
            const issuer = authServices.config.oidc.issuer;
            const clientId = authServices.config.oidc.clientId;
            const clientSecret = authServices.config.oidc.clientSecret;
            if (!issuer || !clientId || !clientSecret) {
              return new Response("Not found", { status: 404 });
            }
            const url = new URL(request.url);
            const code = url.searchParams.get("code");
            const state = url.searchParams.get("state");
            const pkce = readOidcPkceCookie(request, state, authServices.config.oauth);
            if (!code || !verifySignedOAuthStateValue(state ?? "", authServices.config.oauth) || !pkce) {
              const denied = privateJsonResponse({ error: "Invalid OIDC state." }, { status: 403 });
              denied.headers.append("set-cookie", clearOidcPkceCookie(authServices.config.oauth));
              return denied;
            }
            const redirectUri = authServices.config.oidc.redirectUri;
            const profile = await new OidcProvider({ name: "oidc", issuer, clientId, clientSecret, redirectUri, networkPolicy: authServices.config.oidc.networkPolicy })
              .exchangeCode(code, redirectUri, pkce)
              .catch(() => null);
            if (!profile) {
              const failed = privateJsonResponse({ error: "Invalid OIDC response." }, { status: 400 });
              failed.headers.append("set-cookie", clearOidcPkceCookie(authServices.config.oauth));
              return failed;
            }
            const login = await completeBrowserSsoLogin(_ports, authServices, profile, "OIDC");
            login.headers.append("set-cookie", clearOidcPkceCookie(authServices.config.oauth));
            return login;
          })),
        },`
    : "";

  const apiRoutes = plan.decisions.users
    ? `
    routes({ kernel, dependencies }) {
      const authServices = dependencies.container.resolve(STARTER_AUTH_SERVICES);${
        browserMfa
          ? `
      // Browser SSO requires only its continuation view, not general web routes.
      const views = dependencies.container.resolve(CORE_VIEW_RENDERER_TOKEN).namespace("auth", { headers: { "Cache-Control": "private, no-store" } });`
          : ""
      }
      return {${mfaContinuation}${csrfRoute}${samlRoutes}${githubRoutes}${oidcRoutes}${cookieJsonAuth}${tokenLogin}${jsonRegister}${jwtLogin}${apiUser}${jsonPassword}${jsonVerify}${jsonAccountManagement}
      };
    },`
    : "";
  return apiRoutes;
}
