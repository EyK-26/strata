import type { AuthRenderingContext } from "./renderingContext.ts";

export function renderBrowserAuthRoutes({
  cookie,
  mfa,
  verify,
}: Pick<AuthRenderingContext, "cookie" | "mfa" | "verify">) {
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
            const recoveryCodes = await enrollMfa(user, secret);
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
  return cookieRoutes;
}
