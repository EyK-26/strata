import type { AuthRenderingContext } from "./renderingContext.ts";
import { portAuthRouteSource } from "./routePersistence.ts";

export function renderMfaChallengeRoutes(): string {
  return `        "/login/mfa": {
          GET: kernel.wrapWebGuest(async (request, _ports) => {
            const pending = authServices.pendingMfa.read(request);
            const record = pending ? await authServices.directory(_ports).findByIdOrThrow(pending.userId).catch(() => null) : null;
            if (!record?.is_active || record.auth_version !== pending?.authVersion) return redirectTo("/login");
            return views.render("mfa-challenge.eta", { layout: { title: "MFA" }, errors: {}, code: "" }, { request });
          }),
          POST: wrapWebLogin(
            kernel,
            async (request, _ports) => {
            const pending = authServices.pendingMfa.read(request);
            if (!pending) {
              return redirectTo("/login");
            }
            const { fields } = await parseFormBody(request);
            const submitted = (fields.code ?? "").trim();
            return runWithLockedAccount(_ports, pending.userId, async (record, _ports) => {
            if (!record?.is_active || record.auth_version !== pending.authVersion) {
              const failed = redirectTo("/login");
              failed.headers.append("set-cookie", authServices.pendingMfa.clearCookie());
              return failed;
            }
            const mfaResult = completePasswordLogin(record, { mfaCode: submitted });
            if (!mfaResult.ok) {
              return views.render("mfa-challenge.eta", { layout: { title: "MFA" }, errors: { code: "That code is not valid." }, code: "" }, { request });
            }
            await persistAuthRecovery(_ports, pending.userId, record.mfa_recovery_codes, mfaResult.consumedRecoveryHash);
            const signed = await authServices.session(_ports).signInRedirect(sessionUser(record), "/");
            signed.headers.append("set-cookie", authServices.pendingMfa.clearCookie());
            return signed;
            });
          },
            async (request) =>
              views.render("mfa-challenge.eta", { layout: { title: "MFA" }, errors: { code: "Too many login attempts. Try again shortly." }, code: "" }, { request, status: 429 }),
          ),
        },
`;
}

export function renderBrowserAuthRoutes({
  cookie,
  mfa,
  verify,
}: Pick<AuthRenderingContext, "cookie" | "mfa" | "verify">) {
  const mfaLoginBranch = `if (!mfaResult.ok) {
                ${
                  mfa
                    ? `if (mfaResult.error === "mfa_required") {
                  const pending = redirectTo("/login/mfa");
                  pending.headers.append("set-cookie", authServices.pendingMfa.setCookie(mfaResult.user.id, mfaResult.user.auth_version));
                  return pending;
                }`
                    : ""
                }
                return views.render("login.eta", { layout: { title: "Sign in" }, errors: { email: "These credentials do not match our records." }, email, password: "" }, { request });
              }`;

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
      const authServices = dependencies.container.resolve(STARTER_AUTH_SERVICES);
      const views = dependencies.container.resolve(CORE_VIEW_RENDERER_TOKEN).namespace("auth", { headers: { "Cache-Control": "private, no-store" } });
      return {
        "/login": {
          GET: kernel.wrapWebGuest(async (request) =>
            views.render("login.eta", { layout: { title: "Sign in" }, errors: {}, email: "", password: "" }, { request }),
          ),
          POST: wrapWebLogin(
            kernel,
            async (request, _ports) => {
              const { fields } = await parseFormBody(request);
              const { email, password, mfa_code } = parseLoginCredentials(fields);
              return runWithLoginUser(_ports, email, async (candidate, _ports) => {
              const mfaResult = await authenticatePasswordUser(_ports, candidate, password, mfa_code);
              ${mfaLoginBranch}
              const user = mfaResult.user;
              return authServices.session(_ports).signInRedirect(sessionUser(user), "/");
              });
            },
            async (request) =>
              views.render("login.eta", { layout: { title: "Sign in" }, errors: { email: "Too many login attempts. Try again shortly." }, email: "", password: "" }, { request, status: 429 }),
          ),
        },
        "/register": {
          GET: kernel.wrapWebGuest(async (request, _ports) => {
            if (!authServices.config.registrationEnabled) {
              return new Response("Not found", { status: 404 });
            }
            return views.render("register.eta", { layout: { title: "Create account" }, errors: {}, name: "", email: "", password: "" }, { request });
          }),
          POST: wrapWebRegister(
            kernel,
            async (request, _ports) => {
              if (!authServices.config.registrationEnabled) {
                return new Response("Not found", { status: 404 });
              }
              const { fields } = await parseFormBody(request);
              const { name, email, password } = parseRegisterCredentials(fields);
              const existing = await authServices.directory(_ports).findByEmail?.(email);
              await hashPassword(password);
              if (existing) {
                ${registerSuccessExisting}
              }
              const hashed = await hashPassword(password);
              ${verify ? "const verificationMail = " : ""}await createRegistration(_ports, authServices, { name, email, password: hashed }${verify ? ', "/email/verify"' : ""});
              ${verify ? "// SMTP follows the outermost commit, including request RLS.\n              if (verificationMail) await deferAuthEffect(_ports, () => authServices.mail.send(verificationMail));" : ""}
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
          POST: kernel.wrapWeb(async (request, _ports) => {
            const { fields } = await parseFormBody(request);
            const email = parseForgotPasswordEmail(fields);
            const user = await authServices.directory(_ports).findByEmail?.(email);
            if (user) {
              await issueSignedAuthMail(_ports, authServices, email, "Reset your password", "/reset-password", AUTH_ONE_TIME_PURPOSES.passwordReset, user.id, { email });
            }
            return flashResponse(redirectTo("/forgot-password"), {
              level: "success",
              message: "If that account exists, a reset link is on its way.",
            });
          }),
        },
        "/reset-password": {
          GET: kernel.wrapWeb(kernel.wrapSigned(async (request, _ports) => {
            const email = new URL(request.url).searchParams.get("email") ?? "";
            return views.render("reset-password.eta", { layout: { title: "Reset password" }, errors: {}, password: "", email, action: \`\${new URL(request.url).pathname}\${new URL(request.url).search}\` }, { request });
          })),
          POST: kernel.wrapWeb(kernel.wrapSigned(async (request, _ports) => {
            const { fields } = await parseFormBody(request);
            const email = new URL(request.url).searchParams.get("email") ?? fields.email ?? "";
            const password = fields.password ?? "";
            if (!email || !(await completeSignedPasswordReset(_ports, request, password))) {
              return views.render("reset-password.eta", { layout: { title: "Reset password" }, errors: { password: "Invalid or expired reset link." }, password: "", email, action: \`\${new URL(request.url).pathname}\${new URL(request.url).search}\` }, { request });
            }
            return flashResponse(redirectTo("/login"), { level: "success", message: "Password updated. Sign in." });
          })),
        },
        "/logout": {
          POST: kernel.wrapWebAuthenticatedAllowUnverified(async (request, _ports) => { return authServices.session(_ports).signOutRedirect(request, "/"); }),
        },${
          verify
            ? `
        "/email/verify": {
          GET: kernel.wrapWeb(async (request, _ports) => {
            const url = new URL(request.url);
            if (url.searchParams.get("signature")) {
              assertValidSignature(request, authServices.config.signatureSecret);
              if (await completeSignedEmailVerification(_ports, request)) {
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
          POST: kernel.wrapWebAuthenticatedAllowUnverified(async (request, _ports) => {
            const user = await _ports.auth.user(request);
            if (user) {
              const record = await authServices.directory(_ports).findByIdOrThrow(Number(user.id));
              await issueSignedAuthMail(_ports, authServices, record.email ?? "", "Verify your email", "/email/verify", AUTH_ONE_TIME_PURPOSES.emailVerify, Number(record.id), { id: String(record.id) });
            }
            return flashResponse(redirectTo("/email/verify"), { level: "info", message: "Verification link sent." });
          }),
        },`
            : ""
        }${
          mfa
            ? `
${renderMfaChallengeRoutes()}        "/confirm-password": {
          GET: kernel.wrapWebAuthenticated(async (request) =>
            views.render("confirm-password.eta", { layout: { title: "Confirm password" }, errors: {}, password: "" }, { request }),
          ),
          POST: kernel.wrapWebAuthenticated(async (request, _ports) => {
            const user = await _ports.auth.user(request);
            if (!user) {
              return redirectTo("/login");
            }
            const { fields } = await parseFormBody(request);
            const password = fields.password ?? "";
            return runWithLockedAccount(_ports, Number(user.id), async (record, _ports) => {
            if (!record?.is_active || record.auth_version !== user.authVersion) return redirectTo("/login");
            if (!record.password || !(await verifyPassword(password, record.password))) {
              return views.render("confirm-password.eta", { layout: { title: "Confirm password" }, errors: { password: "That password is not correct." }, password: "" }, { request });
            }
            const next = sanitizeInternalPath(new URL(request.url).searchParams.get("redirect") ?? "/account/mfa");
            const confirmed = redirectTo(next);
            confirmed.headers.append("set-cookie", createPasswordConfirmCookie(Number(user.id), record.auth_version, authServices.config.passwordConfirmation));
            return confirmed;
            });
          }),
        },
        "/account/mfa": {
          GET: kernel.wrapWebAuthenticated(async (request, _ports) => {
            const secret = generateTotpSecret();
            const user = await _ports.auth.user(request);
            const record = user ? await authServices.directory(_ports).findByIdOrThrow(Number(user.id)) : null;
            const otpauth = buildOtpauthUrl({
              secret,
              account: record?.email ?? "user",
              issuer: authServices.config.appName,
            });
            return views.render("mfa-setup.eta", { layout: { title: "MFA" }, errors: {}, code: "", secret, otpauth }, { request });
          }),
          POST: kernel.wrapWebPasswordConfirm(async (request, _ports) => {
            const user = await _ports.auth.user(request);
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
                  otpauth: buildOtpauthUrl({ secret, account: "user", issuer: authServices.config.appName }),
                }, { request });
            }
            const recoveryCodes = await enrollMfa(_ports, user, secret);
            return views.render("mfa-setup.eta", {
                layout: { title: "MFA" },
                errors: {},
                code: "",
                secret,
                otpauth: buildOtpauthUrl({ secret, account: "user", issuer: authServices.config.appName }),
                recoveryCodes,
              }, { request });
          }),
        },`
            : ""
        }
      };
    },`
    : "";
  return portAuthRouteSource(cookieRoutes);
}
