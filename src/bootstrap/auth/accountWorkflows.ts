import { verifyPassword } from "@getstrata/core/auth/password";
import {
  completePasswordLogin,
  type PasswordLoginResult,
} from "@getstrata/core/auth/passwordLogin";
import type { AuthUserRecord } from "@getstrata/core/contracts/authUserDirectory";
import type { MfaSecretCodec } from "@getstrata/core/crypto/mfaSecret";
import {
  emailRule,
  minLength,
  required,
  stringRule,
  validateObject,
} from "@getstrata/core/validation/rules";

export function parseLoginCredentials(payload: unknown) {
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
export function parseRegisterCredentials(payload: unknown) {
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
export function parseForgotPasswordEmail(payload: unknown) {
  const body = validateObject(payload, { email: [required(), stringRule(), emailRule()] });
  return String(body.email).toLowerCase();
}

/** Directory and locking callbacks retain the application's established tenant and cancellation scope. */
export async function withLoginAccount<
  Ports,
  Record extends { id: number; email?: string | null },
  Result,
>(
  ports: Ports,
  email: string,
  directory: (ports: Ports) => { findByEmail(email: string): Promise<Record | null> },
  lock: (
    ports: Ports,
    id: number,
    work: (record: Record | null, child: Ports) => Promise<Result>,
  ) => Promise<Result>,
  operation: (record: Record | null, child: Ports) => Promise<Result>,
): Promise<Result> {
  const candidate = await directory(ports).findByEmail(email);
  if (!candidate) return operation(null, ports);
  return lock(ports, candidate.id, (record, child) =>
    operation(record?.email === email.trim().toLowerCase() ? record : null, child),
  );
}

export type PasswordAccountResult<User> =
  | { ok: false; error: "invalid_credentials" }
  | (PasswordLoginResult & { user: User });
export async function authenticatePasswordAccount<
  User extends Pick<
    AuthUserRecord,
    "is_active" | "mfa_enabled" | "mfa_secret" | "mfa_recovery_codes"
  > & { password?: string | null },
>(
  user: User | null,
  password: string,
  mfaCode: string | undefined,
  secrets: MfaSecretCodec,
  persistRecovery: (user: User, consumedHash: string | undefined) => Promise<void>,
): Promise<PasswordAccountResult<User>> {
  if (!user?.password || !(await verifyPassword(password, user.password)))
    return { ok: false, error: "invalid_credentials" };
  const result = completePasswordLogin(user, { mfaCode }, secrets);
  if (!result.ok) return { ...result, user };
  await persistRecovery(user, result.consumedRecoveryHash);
  return { ...result, user };
}

/** A uniqueness race is neutral only after rollback and a scoped account readback. */
export async function registerAccount<Ports, Result>(
  ports: Ports,
  email: string,
  options: {
    write: <T>(ports: Ports, identifier: string, work: (child: Ports) => Promise<T>) => Promise<T>;
    transaction: <T>(ports: Ports, work: (child: Ports) => Promise<T>) => Promise<T>;
    create: (child: Ports) => Promise<Result>;
    isUniqueViolation: (error: unknown) => boolean;
    accountExists: (ports: Ports, email: string) => Promise<boolean>;
  },
): Promise<Result | undefined> {
  try {
    return await options.write(ports, email, (child) => options.transaction(child, options.create));
  } catch (error) {
    if (!options.isUniqueViolation(error) || !(await options.accountExists(ports, email)))
      throw error;
    return undefined;
  }
}

/** Consume and mutate atomically so failed account changes leave the token usable. */
export async function completeAccountToken<Ports>(
  ports: Ports,
  request: Request,
  purpose: string,
  options: {
    transaction: <T>(ports: Ports, work: (child: Ports) => Promise<T>) => Promise<T>;
    consume: (child: Ports, request: Request, purpose: string) => Promise<number | null>;
    update: (child: Ports, userId: number) => Promise<void>;
  },
): Promise<boolean> {
  return options.transaction(ports, async (child) => {
    const userId = await options.consume(child, request, purpose);
    if (!userId) return false;
    await options.update(child, userId);
    return true;
  });
}

export async function prepareAccountMail<Ports>(
  ports: Ports,
  message: {
    to: string;
    subject: string;
    path: string;
    purpose: string;
    userId: number;
    extra?: Record<string, string>;
  },
  options: {
    issue: () => { plain: string; hash: string };
    store: (
      ports: Ports,
      token: { purpose: string; userId: number; hash: string; expiresAt: Date },
    ) => Promise<void>;
    sign: (path: string, ttl: number, parameters: Record<string, string>) => string;
  },
) {
  const issued = options.issue();
  await options.store(ports, {
    purpose: message.purpose,
    userId: message.userId,
    hash: issued.hash,
    expiresAt: new Date(Date.now() + 3600 * 1000),
  });
  const link = options.sign(message.path, 3600, { ...message.extra, token: issued.plain });
  return { to: message.to, subject: message.subject, body: `${message.subject}\n\n${link}\n` };
}
