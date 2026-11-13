import type { AuthRenderingContext } from "./renderingContext.ts";

export function renderAuthHelpers({
  plan,
  cookie,
  mfa,
  verify,
  tenantCreateField,
  samlTenantCreateField,
}: Pick<
  AuthRenderingContext,
  "plan" | "cookie" | "mfa" | "verify" | "tenantCreateField" | "samlTenantCreateField"
>) {
  const helpers = `
function withAuthDatabase(ports: BusinessRequestPorts, database: SelectedSession): BusinessRequestPorts {
  return { ...ports, database };
}
function runAuthTransaction<T>(ports: BusinessRequestPorts, work: (child: BusinessRequestPorts) => T | Promise<T>): Promise<T> {
  return ports.database.transaction(database => work(withAuthDatabase(ports, database)));
}
function runWithLockedAccount<T>(ports: BusinessRequestPorts, id: number, work: (record: StarterAuthUserRecord | null, child: BusinessRequestPorts) => Promise<T>): Promise<T> {
  return runWithLockedAuthUser(ports, id, (record, child) => work(record, withAuthDatabase(ports, child.database)));
}
function authTimestamp(ports: BusinessRequestPorts, value = new Date()): string {
  return ports.database.dialect.timestampValue(value);
}
async function deferAuthEffect(ports: BusinessRequestPorts, work: () => void | Promise<void>): Promise<void> {
  if ("afterCommit" in ports.database) ports.database.afterCommit(work);
  else await work();
}
${
  !plan.decisions.tenantTable
    ? ""
    : `function establishedTenantId(ports: BusinessRequestPorts): number {
  const id = ports.established.tenant?.id;
  if (!Number.isSafeInteger(id) || id! <= 0) throw new Error("Established tenant identity is required.");
  return id!;
}
`
}
type StarterPasswordLoginResult =
  | { ok: false; error: "invalid_credentials" }
  | (PasswordLoginResult & { user: StarterAuthUserRecord });

async function authenticatePasswordUser(ports: BusinessRequestPorts,
  user: StarterAuthUserRecord | null,
  password: string,
  mfaCode: string | undefined,
): Promise<StarterPasswordLoginResult> {
  if (!user?.password || !(await verifyPassword(password, user.password))) {
    return { ok: false, error: "invalid_credentials" };
  }
  const result = completePasswordLogin(user, { mfaCode });
  if (!result.ok) return { ...result, user };
  await persistAuthRecovery(ports, user.id, user.mfa_recovery_codes, result.consumedRecoveryHash);
  return { ...result, user };
}

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

async function runWithLoginUser<T>(ports: BusinessRequestPorts, email: string, operation: (record: StarterAuthUserRecord | null, ports: BusinessRequestPorts) => Promise<T>): Promise<T> {
  const candidate = await createStarterAuthDirectory(ports).findByEmail(email);
  if (!candidate) return operation(null, ports);
  return runWithLockedAccount(ports, candidate.id, async (record, ports) => {
    // Recheck identity after locking: provisioning may have changed the email.
    return operation(record?.email === email.trim().toLowerCase() ? record : null, ports);
  });
}

async function runAuthWrite<T>(ports: BusinessRequestPorts, identifier: string | number, callback: (ports: BusinessRequestPorts) => Promise<T>): Promise<T> {
  return withAuthIdentifier(ports, identifier, database => callback(withAuthDatabase(ports, database)));
}

async function prepareSignedAuthMail(ports: BusinessRequestPorts, services: StarterAuthServices, to: string, subject: string, path: string, purpose: string, userId: number, extra: Record<string, string> = {}) {
  const issued = generateOneTimeToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await runAuthWrite(ports, userId, async (ports) => {
    await ports.database.model(AuthOneTimeToken).create({
      purpose,
      user_id: userId,
      token_hash: issued.hash,
      expires_at: authTimestamp(ports, expiresAt),
    });
  });
  const link = absoluteTemporarySignedUrl(path, 3600, { ...extra, token: issued.plain }, services.config.appUrl, services.config.signatureSecret);
  return { to, subject, body: \`\${subject}\\n\\n\${link}\\n\` };
}

async function issueSignedAuthMail(ports: BusinessRequestPorts, services: StarterAuthServices, to: string, subject: string, path: string, purpose: string, userId: number, extra: Record<string, string> = {}) {
  const message = await prepareSignedAuthMail(ports, services, to, subject, path, purpose, userId, extra);
  await deferAuthEffect(ports, () => services.mail.send(message));
}

async function createRegistration(ports: BusinessRequestPorts, services: StarterAuthServices, credentials: { name: string; email: string; password: string }${verify ? ", verificationPath: string" : ""}) {
  const { email } = credentials;
  try {
    return await runAuthWrite(ports, email, (ports) => runAuthTransaction(ports, async (ports) => {
      ${verify ? "const created = " : ""}await ports.database.model(User).create({
        ...credentials,
        is_admin: false,${tenantCreateField}
      });
      ${verify ? `return prepareSignedAuthMail(ports, services, email, "Verify your email", verificationPath, AUTH_ONE_TIME_PURPOSES.emailVerify, Number(created.get("id")), { id: String(created.get("id")) });` : ""}
    }));
  } catch (error) {
    // The failed transaction/savepoint is already rolled back before readback.
    // Only an actual account race is neutral; unrelated persistence failures propagate.
    if (!isUniqueConstraintError(error) || !(await createStarterAuthDirectory(ports).findByEmail(email))) throw error;
    return undefined;
  }
}

async function consumeSignedAuthToken(ports: BusinessRequestPorts, request: Request, purpose: string): Promise<number | null> {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!token) {
    return null;
  }
  return await runAuthWrite(ports, hashOneTimeToken(token), async (ports) => consumeOneTimeToken(ports.database, purpose, token));
}

async function revokeUserSessions(ports: BusinessRequestPorts, userId: number) {
  await runAuthWrite(ports, userId, async (ports) => {
    await revokeStoredUserSessions(ports.database, userId, { incrementAuthVersion: true });
  });
}

${
  verify
    ? `
async function completeSignedEmailVerification(ports: BusinessRequestPorts, request: Request): Promise<boolean> {
  return await runAuthTransaction(ports, async (ports) => {
    const userId = await consumeSignedAuthToken(ports, request, AUTH_ONE_TIME_PURPOSES.emailVerify);
    if (!userId) return false;
    await runAuthWrite(ports, userId, async (ports) => {
      const user = await ports.database.model(User).find(userId);
      if (!user) throw new Error("Verification account no longer exists.");
      await user.update({ email_verified_at: authTimestamp(ports) });
    });
    return true;
  });
}
`
    : ""
}

async function completeSignedPasswordReset(ports: BusinessRequestPorts, request: Request, password: unknown): Promise<boolean> {
  if (typeof password !== "string" || password.length < 8) return false;
  return await runAuthTransaction(ports, async (ports) => {
    const userId = await consumeSignedAuthToken(ports, request, AUTH_ONE_TIME_PURPOSES.passwordReset);
    if (!userId) return false;
    await runAuthWrite(ports, userId, async (ports) => {
      const user = await ports.database.model(User).where({ id: userId })${plan.decisions.rowLocks ? ".lockForUpdate()" : ""}.first();
      if (!user) throw new Error("Reset account no longer exists.");
      await user.update({ password: await hashPassword(password) });
      await revokeStoredUserSessions(ports.database, userId, { incrementAuthVersion: true });
    });
    return true;
  });
}

async function persistAuthRecovery(ports: BusinessRequestPorts,
  userId: number,
  currentRaw: string | null | undefined,
  consumedHash: string | undefined,
) {
  await runAuthWrite(ports, userId, async (ports) => {
    await persistConsumedRecoveryHash(ports.database, userId, currentRaw, consumedHash);
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
  ports: BusinessRequestPorts,
  services: StarterAuthServices,
  profile: { email: string; name: string },
  label: string,
): Promise<Response> {
  const email = profile.email.trim().toLowerCase();
  let record = await createStarterAuthDirectory(ports).findByEmail?.(email);
  if (!record) {
    if (!services.config.registrationEnabled) {
      return privateJsonResponse({ error: \`\${label} user is not provisioned.\` }, { status: 403 });
    }
    const hashed = await hashPassword(randomBytes(18).toString("hex"));
    try {
      await runAuthWrite(ports, email, async (ports) => {
        await ports.database.model(User).create({
          name: profile.name,
          email,
          password: hashed,
          is_admin: false,${samlTenantCreateField}
        });
      });
    } catch (error) {
      // Only a verified uniqueness race is neutral; transaction failures propagate.
      if (!isUniqueConstraintError(error)) throw error;
    }
    record = await createStarterAuthDirectory(ports).findByEmail?.(email);
  }
  if (!record) {
    return privateJsonResponse({ error: \`Could not complete \${label} login.\` }, { status: 500 });
  }
  return runWithLockedAccount(ports, record.id, async (record, ports) => {
    if (!record?.is_active || record.email !== email) return privateJsonResponse({ error: "Account unavailable." }, { status: 403 });
  ${
    mfa
      ? `if (record.mfa_enabled) {
    const pending = redirectTo("/login/mfa");
    pending.headers.append("set-cookie", services.pendingMfa.setCookie(record.id, record.auth_version));
    return pending;
  }
  `
      : ""
  }const auth = services.session(ports);
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
async function enrollMfa(ports: BusinessRequestPorts, user: { id: string | number; authVersion?: number }, secret: string) {
  const recoveryCodes = generateRecoveryCodes();
  const stored = protectMfaSecret(secret);
  const previous = await runAuthWrite(ports, Number(user.id), (ports) => ports.database.model(User).find(Number(user.id)));
  if (!previous || previous.get("auth_version") !== user.authVersion || !(previous.get("is_active") === true || previous.get("is_active") === 1)) throw new ConflictError("MFA configuration changed. Reload and confirm again.");
  await runAuthTransaction(ports, async (ports) => {
    await runAuthWrite(ports, Number(user.id), async (ports) => {
      // Trusted, pre-protected security fields: atomically replace only the state we read.
      const changed = await ports.database.model(User).repository().updateWhere({
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
    await revokeUserSessions(ports, Number(user.id));
  });
  return recoveryCodes;
}
`
    : "";
}
