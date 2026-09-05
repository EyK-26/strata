import type { ServiceContainerLike } from "../contracts/serviceContainer";
import { resolveAuthUserDirectory } from "../contracts/serviceTokens";
import { readBasicCredentials } from "../http/statelessAuth";
import type { AuthUser } from "./authContext";
import type { AuthGuard } from "./guard";
import { verifyPassword } from "./password";

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

    if (typeof directory.verifyCredentials === "function") {
      return await directory.verifyCredentials(credentials.username, credentials.password);
    }

    if (typeof directory.findByEmail !== "function") {
      return null;
    }

    const record = await directory.findByEmail(credentials.username);

    if (!record?.password) {
      return null;
    }

    if (!(await verifyPassword(credentials.password, record.password))) {
      return null;
    }

    return {
      id: record.id,
      role: record.role,
      emailVerifiedAt: record.email_verified_at ?? null,
    };
  }
}

export { BasicAuthGuard };
