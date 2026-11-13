import {
  type AuthOutcome,
  authenticateProof,
  authUserFromOutcome,
} from "@getstrata/core/auth/authOutcome";
import { UnprocessableEntityError } from "@getstrata/core/errors/http";
import type {
  AuthAccountLookup,
  AuthCredentialVerifier,
  AuthEmailLookup,
  AuthUserRecord,
} from "../contracts/authUserDirectory";
import type { MfaSecretCodec } from "../crypto/mfaSecret";
import { authorizationScheme, readBasicCredentials } from "../http/statelessAuth";
import { isAccountActive, isAuthUserActive } from "./accountState";
import type { AuthUser } from "./authContext";
import type { AuthGuard } from "./guard";
import { verifyPassword } from "./password";
import { completePasswordLogin } from "./passwordLogin";
import { requireAuthCapability } from "./requireAuthCapability";

type BasicAuthGuardOptions = {
  accounts: AuthAccountLookup;
  mfaSecrets: MfaSecretCodec;
  persistRecovery(record: AuthUserRecord, hash: string): Promise<boolean>;
} & (
  | { emailLookup: AuthEmailLookup; credentials?: AuthCredentialVerifier }
  | { emailLookup?: AuthEmailLookup; credentials: AuthCredentialVerifier }
);

class BasicAuthGuard implements AuthGuard {
  constructor(private readonly options: BasicAuthGuardOptions) {
    requireAuthCapability<AuthAccountLookup>(
      options.accounts,
      ["findByIdOrThrow"],
      "Basic account",
    );
    requireAuthCapability<Pick<BasicAuthGuardOptions, "persistRecovery">>(
      options,
      ["persistRecovery"],
      "Basic recovery",
    );
    requireAuthCapability<MfaSecretCodec>(
      options.mfaSecrets,
      ["revealMfaSecret"],
      "Basic MFA codec",
    );
    if (options.emailLookup !== undefined) {
      requireAuthCapability<AuthEmailLookup>(
        options.emailLookup,
        ["findByEmail"],
        "Basic email lookup",
      );
    }
    if (options.credentials !== undefined) {
      requireAuthCapability<AuthCredentialVerifier>(
        options.credentials,
        ["verifyCredentials"],
        "Basic credentials",
      );
    }
    if (!options.emailLookup && !options.credentials) {
      throw new TypeError("Basic authentication requires an email lookup or credential verifier.");
    }
  }

  private async persistRecovery(record: AuthUserRecord, hash: string): Promise<boolean> {
    try {
      return (await this.options.persistRecovery(record, hash)) === true;
    } catch (error) {
      if (error instanceof UnprocessableEntityError && error.message === "mfa_invalid")
        return false;
      throw error;
    }
  }

  authenticate(request: Request): Promise<AuthOutcome> {
    return authenticateProof("basic", authorizationScheme(request) === "basic", () =>
      this.resolveUser(request),
    );
  }
  async resolve(request: Request): Promise<AuthUser | null> {
    return authUserFromOutcome(await this.authenticate(request));
  }
  private async resolveUser(request: Request): Promise<AuthUser | null> {
    const credentials = readBasicCredentials(request);

    if (!credentials) {
      return null;
    }

    const record = this.options.emailLookup
      ? await this.options.emailLookup.findByEmail(credentials.username)
      : null;

    if (record && !isAccountActive(record)) return null;
    if (record?.password) {
      if (!(await verifyPassword(credentials.password, record.password))) {
        return null;
      }

      const mfa = completePasswordLogin(
        record,
        {
          mfaCode: request.headers.get("x-mfa-code"),
        },
        this.options.mfaSecrets,
      );
      if (!mfa.ok) {
        return null;
      }

      if (mfa.consumedRecoveryHash) {
        if (!(await this.persistRecovery(record, mfa.consumedRecoveryHash))) return null;
      }

      return {
        id: record.id,
        role: record.role,
        ...(record.auth_version !== undefined ? { authVersion: record.auth_version } : {}),
        emailVerifiedAt: record.email_verified_at ?? null,
      };
    }

    if (this.options.credentials) {
      const user = await this.options.credentials.verifyCredentials(
        credentials.username,
        credentials.password,
      );
      if (!user || !isAuthUserActive(user)) {
        return null;
      }

      const userId =
        typeof user.id === "number" ? user.id : typeof user.id === "string" ? Number(user.id) : NaN;
      if (!Number.isSafeInteger(userId) || userId <= 0) return null;

      let record = this.options.emailLookup
        ? await this.options.emailLookup.findByEmail(credentials.username)
        : null;
      if (!record) {
        record = await this.options.accounts.findByIdOrThrow(userId);
      }

      if (record.id !== userId) return null;

      const mfa = completePasswordLogin(
        record,
        {
          mfaCode: request.headers.get("x-mfa-code"),
        },
        this.options.mfaSecrets,
      );
      if (!mfa.ok) {
        return null;
      }

      if (mfa.consumedRecoveryHash) {
        if (!(await this.persistRecovery(record, mfa.consumedRecoveryHash))) return null;
      }

      return user;
    }

    return null;
  }
}

export type { BasicAuthGuardOptions };
export { BasicAuthGuard };
