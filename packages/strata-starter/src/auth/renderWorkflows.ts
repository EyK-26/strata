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
function authenticatePasswordUser(ports: BusinessRequestPorts, services: StarterAuthServices, user: StarterAuthUserRecord | null, password: string, mfaCode: string | undefined) {
  return authenticatePasswordAccount(user, password, mfaCode, services.mfaSecrets,
    (account, hash) => persistAuthRecovery(ports, account.id, account.mfa_recovery_codes, hash));
}
function runWithLoginUser<T>(ports: BusinessRequestPorts, email: string, operation: (record: StarterAuthUserRecord | null, child: BusinessRequestPorts) => Promise<T>): Promise<T> {
  return withLoginAccount(ports, email, createStarterAuthDirectory, runWithLockedAccount, operation);
}

async function runAuthWrite<T>(ports: BusinessRequestPorts, identifier: string | number, callback: (ports: BusinessRequestPorts) => Promise<T>): Promise<T> {
  return withAuthIdentifier(ports, identifier, database => callback(withAuthDatabase(ports, database)));
}

async function prepareSignedAuthMail(ports: BusinessRequestPorts, services: StarterAuthServices, to: string, subject: string, path: string, purpose: string, userId: number, extra: Record<string, string> = {}) {
  return prepareAccountMail(ports, { to, subject, path, purpose, userId, extra }, {
    issue: generateOneTimeToken,
    store: (ports, token) => runAuthWrite(ports, token.userId, async (ports) => {
      await ports.database.model(AuthOneTimeToken).create({ purpose: token.purpose, user_id: token.userId, token_hash: token.hash, expires_at: authTimestamp(ports, token.expiresAt) });
    }),
    sign: (path, ttl, parameters) => absoluteTemporarySignedUrl(path, ttl, parameters, services.config.appUrl, services.config.signatureSecret),
  });
}

async function issueSignedAuthMail(ports: BusinessRequestPorts, services: StarterAuthServices, to: string, subject: string, path: string, purpose: string, userId: number, extra: Record<string, string> = {}) {
  const message = await prepareSignedAuthMail(ports, services, to, subject, path, purpose, userId, extra);
  await deferAuthEffect(ports, () => services.mail.send(message));
}

async function createRegistration(ports: BusinessRequestPorts, services: StarterAuthServices, credentials: { name: string; email: string; password: string }${verify ? ", verificationPath: string" : ""}) {
  const { email } = credentials;
  return registerAccount(ports, email, {
    write: runAuthWrite, transaction: runAuthTransaction,
    create: async (ports) => {
      ${verify ? "const created = " : ""}await ports.database.model(User).create({
        ...credentials,
        is_admin: false,${tenantCreateField}
      });
      ${verify ? `return prepareSignedAuthMail(ports, services, email, "Verify your email", verificationPath, AUTH_ONE_TIME_PURPOSES.emailVerify, Number(created.get("id")), { id: String(created.get("id")) });` : ""}
    },
    isUniqueViolation: isUniqueConstraintError,
    accountExists: async (ports, email) => Boolean(await createStarterAuthDirectory(ports).findByEmail(email)),
  });
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
  return completeAccountToken(ports, request, AUTH_ONE_TIME_PURPOSES.emailVerify, {
    transaction: runAuthTransaction, consume: consumeSignedAuthToken,
    update: (ports, userId) => runAuthWrite(ports, userId, async (ports) => {
      const user = await ports.database.model(User).find(userId);
      if (!user) throw new Error("Verification account no longer exists.");
      await user.update({ email_verified_at: authTimestamp(ports) });
    }),
  });
}
`
    : ""
}

async function completeSignedPasswordReset(ports: BusinessRequestPorts, request: Request, password: unknown): Promise<boolean> {
  if (typeof password !== "string" || password.length < 8) return false;
  return completeAccountToken(ports, request, AUTH_ONE_TIME_PURPOSES.passwordReset, {
    transaction: runAuthTransaction, consume: consumeSignedAuthToken,
    update: (ports, userId) => runAuthWrite(ports, userId, async (ports) => {
      const user = await ports.database.model(User).where({ id: userId })${plan.decisions.rowLocks ? ".lockForUpdate()" : ""}.first();
      if (!user) throw new Error("Reset account no longer exists.");
      await user.update({ password: await hashPassword(password) });
      await revokeStoredUserSessions(ports.database, userId, { incrementAuthVersion: true });
    }),
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
async function enrollMfa(ports: BusinessRequestPorts, services: StarterAuthServices, user: { id: string | number; authVersion?: number }, secret: string) {
  const recoveryCodes = generateRecoveryCodes();
  const stored = services.mfaSecrets.protectMfaSecret(secret);
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
