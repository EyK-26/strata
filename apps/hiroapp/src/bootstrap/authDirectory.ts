import type { AuthUser } from "@getstrata/core/auth/authContext";
import { verifyPassword } from "@getstrata/core/auth/password";
import { hashApiToken } from "@getstrata/core/auth/tokenHash";
import type { AuthUserDirectory } from "@getstrata/core/contracts/authUserDirectory";
import { roleName } from "../../lib/roles.ts";
import { apiTokens } from "../../modules/account/tokenRepository.ts";
import { normalizeAbilities } from "../../modules/account/tokenService.ts";
import { users } from "../../modules/users/repository.ts";

function expired(value: Date | string | null | undefined): boolean {
  if (!value) {
    return false;
  }

  const timestamp = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

export const hiroAuthDirectory: AuthUserDirectory = {
  async resolveUserFromToken(token: string): Promise<AuthUser | null> {
    if (!token || token.split(".").length === 3) {
      return null;
    }

    const record = await apiTokens.findByTokenHash(hashApiToken(token));
    if (!record || expired(record.expires_at)) {
      return null;
    }

    const user = await users.findById(Number(record.user_id));
    if (!user) {
      return null;
    }

    await apiTokens.updateById(record.id, { last_used_at: new Date() });

    return {
      id: Number(user.id),
      role: roleName(user.role_id),
      abilities: normalizeAbilities(record.abilities),
      tokenId: Number(record.id),
      emailVerifiedAt: user.email_verified_at ?? null,
    };
  },

  async findByIdOrThrow(id: number) {
    const user = await users.findByIdOrThrow(id);
    return {
      id: Number(user.id),
      email: user.email,
      role: roleName(user.role_id),
      email_verified_at: user.email_verified_at ?? null,
      session_valid_after: user.session_valid_after ?? null,
      password: user.password,
    };
  },

  async findByEmail(email: string) {
    const user = await users.findByEmail(email);
    if (!user) {
      return null;
    }
    return {
      id: Number(user.id),
      email: user.email,
      role: roleName(user.role_id),
      email_verified_at: user.email_verified_at ?? null,
      session_valid_after: user.session_valid_after ?? null,
      password: user.password,
    };
  },

  async verifyCredentials(email: string, password: string): Promise<AuthUser | null> {
    const user = await users.findByEmail(email);
    if (!user || !(await verifyPassword(password, user.password))) {
      return null;
    }
    return {
      id: Number(user.id),
      role: roleName(user.role_id),
      emailVerifiedAt: user.email_verified_at ?? null,
    };
  },
};
