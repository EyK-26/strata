import type { AuthUser } from "../../core/auth/authContext";
import { hashApiToken } from "../../core/auth/tokenHash";
import { NotFoundError } from "../../core/errors/http";
import ApiTokenRepository from "./apiTokenRepository";
import UserRepository from "./repository";
import type { UserRecord } from "./types";

class TokenService {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: ApiTokenRepository,
  ) {}

  async resolveUserFromToken(token: string): Promise<AuthUser | null> {
    const tokenHash = hashApiToken(token);
    const apiToken = await this.tokens.findByTokenHash(tokenHash);

    if (!apiToken) {
      return null;
    }

    const user = await this.users.findById(apiToken.user_id);

    if (!user) {
      return null;
    }

    await this.tokens.touchLastUsedAt(apiToken.id);

    return {
      id: user.id,
      role: user.role,
    };
  }

  findByIdOrThrow(id: number): Promise<UserRecord> {
    return this.users.findByIdOrThrow(id, (userId) =>
      new NotFoundError(`User ${userId} not found.`),
    );
  }
}

export default TokenService;
