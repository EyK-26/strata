import type { AuthRenderingContext } from "./renderingContext.ts";

export function renderAuthHelpers({
  layers,
  cookie,
  mfa,
  verify,
  tenantCreateField,
  samlTenantCreateField,
}: Pick<
  AuthRenderingContext,
  "layers" | "cookie" | "mfa" | "verify" | "tenantCreateField" | "samlTenantCreateField"
>) {
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
  return helpers;
}

export function renderMfaEnrollment(mfa: boolean): string {
  return mfa
    ? `
async function enrollMfa(user: { id: string | number; authVersion?: number }, secret: string) {
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
  return recoveryCodes;
}
`
    : "";
}
