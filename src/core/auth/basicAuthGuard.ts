import { UnprocessableEntityError } from "@getstrata/core/errors/http";
import type { AuthUserDirectory, AuthUserRecord } from "../contracts/authUserDirectory";
import { readBasicCredentials } from "../http/statelessAuth";
import { isAccountActive, isAuthUserActive } from "./accountState";
import type { AuthUser } from "./authContext";
import type { AuthGuard } from "./guard";
import { verifyPassword } from "./password";
import { completePasswordLogin } from "./passwordLogin";

class BasicAuthGuard implements AuthGuard {
  constructor(
    private readonly options: {
      directory: AuthUserDirectory;
      persistRecovery(record: AuthUserRecord, hash: string): Promise<boolean>;
    },
  ) {}

  private async persistRecovery(record: AuthUserRecord, hash: string): Promise<boolean> {
    try {
      return await this.options.persistRecovery(record, hash);
    } catch (error) {
      if (error instanceof UnprocessableEntityError && error.message === "mfa_invalid")
        return false;
      throw error;
    }
  }

  async resolve(request: Request): Promise<AuthUser | null> {
    const credentials = readBasicCredentials(request);

    if (!credentials) {
      return null;
    }

    const directory = this.options.directory;

    if (!directory) {
      return null;
    }

    const record =
      typeof directory.findByEmail === "function"
        ? await directory.findByEmail(credentials.username)
        : null;

    if (record && !isAccountActive(record)) return null;
    if (record?.password) {
      if (!(await verifyPassword(credentials.password, record.password))) {
        return null;
      }

      const mfa = completePasswordLogin(record, {
        mfaCode: request.headers.get("x-mfa-code"),
      });
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

    if (typeof directory.verifyCredentials === "function") {
      const user = await directory.verifyCredentials(credentials.username, credentials.password);
      if (!user || !isAuthUserActive(user)) {
        return null;
      }

      let record =
        typeof directory.findByEmail === "function"
          ? await directory.findByEmail(credentials.username)
          : null;
      if (!record) {
        try {
          record = await directory.findByIdOrThrow(Number(user.id));
        } catch {
          return null;
        }
      }

      const mfa = completePasswordLogin(record, {
        mfaCode: request.headers.get("x-mfa-code"),
      });
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

export { BasicAuthGuard };
