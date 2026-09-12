import type { ServiceContainerLike } from "../contracts/serviceContainer";
import { resolveAuthUserDirectory } from "../contracts/serviceTokens";
import { getBoundDatabaseConnection } from "../database/boundConnection";
import { getDefaultDatabasePool } from "../database/defaultConnection";
import { readBasicCredentials } from "../http/statelessAuth";
import type { AuthUser } from "./authContext";
import type { AuthGuard } from "./guard";
import { verifyPassword } from "./password";
import { completePasswordLogin, persistConsumedRecoveryHash } from "./passwordLogin";

class BasicAuthGuard implements AuthGuard {
  constructor(private readonly container: ServiceContainerLike) {}

  async resolve(request: Request): Promise<AuthUser | null> {
    const credentials = readBasicCredentials(request);

    if (!credentials) {
      return null;
    }

    const directory = resolveAuthUserDirectory(this.container);

    if (!directory) {
      return null;
    }

    const record =
      typeof directory.findByEmail === "function"
        ? await directory.findByEmail(credentials.username)
        : null;

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
        await persistConsumedRecoveryHash(
          getBoundDatabaseConnection() ?? getDefaultDatabasePool(),
          record.id,
          record.mfa_recovery_codes,
          mfa.consumedRecoveryHash,
        );
      }

      return {
        id: record.id,
        role: record.role,
        emailVerifiedAt: record.email_verified_at ?? null,
      };
    }

    if (typeof directory.verifyCredentials === "function") {
      return await directory.verifyCredentials(credentials.username, credentials.password);
    }

    return null;
  }
}

export { BasicAuthGuard };
