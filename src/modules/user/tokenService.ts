import { randomBytes } from "node:crypto";
import type { AuthUser } from "@getstrata/core/auth/authContext";
import { hashApiToken } from "@getstrata/core/auth/tokenHash";
import { ForbiddenError, NotFoundError } from "@getstrata/core/errors/http";
import { resolveDefaultTokenExpiryDays } from "@getstrata/core/security/tokenExpiry";
import type ApiTokenRepository from "./apiTokenRepository";
import type UserRepository from "./repository";
import type { ApiTokenRecord, ApiTokenResource, CreatedApiToken, UserRecord } from "./types";

interface CreateTokenInput {
  name: string;
  abilities?: string[];
  expiresAt?: Date | null;
  expiresInDays?: number;
}

function toApiTokenResource(record: ApiTokenRecord): ApiTokenResource {
  return {
    id: record.id,
    name: record.name,
    abilities: normalizeAbilities(record.abilities),
    last_used_at: record.last_used_at?.toISOString() ?? null,
    expires_at: record.expires_at?.toISOString() ?? null,
    created_at: record.created_at.toISOString(),
  };
}

function generatePlainTextToken(): string {
  return randomBytes(32).toString("hex");
}

function resolveExpiresAt(input: CreateTokenInput): Date | null {
  if (input.expiresAt !== undefined) {
    return input.expiresAt;
  }

  if (input.expiresInDays !== undefined) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + input.expiresInDays);
    return expiresAt;
  }

  const defaultExpiryDays = resolveDefaultTokenExpiryDays();

  if (defaultExpiryDays === null) {
    return null;
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + defaultExpiryDays);
  return expiresAt;
}

function normalizeAbilities(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }

  if (typeof value === "string") {
    return JSON.parse(value) as string[];
  }

  return ["*"];
}

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

    if (apiToken.expires_at && apiToken.expires_at.getTime() <= Date.now()) {
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
      abilities: normalizeAbilities(apiToken.abilities),
      tokenId: apiToken.id,
      emailVerifiedAt: user.email_verified_at ?? null,
    };
  }

  async createToken(userId: number, input: CreateTokenInput): Promise<CreatedApiToken> {
    await this.users.findByIdOrThrow(userId, (id) => new NotFoundError(`User ${id} not found.`));

    const plainTextToken = generatePlainTextToken();
    const record = await this.tokens.create({
      user_id: userId,
      name: input.name,
      token_hash: hashApiToken(plainTextToken),
      abilities: normalizeAbilities(input.abilities ?? ["*"]),
      expires_at: resolveExpiresAt(input),
      created_at: new Date(),
    });

    return {
      token: toApiTokenResource(record),
      plainTextToken,
    };
  }

  async listTokensForUser(userId: number): Promise<ApiTokenResource[]> {
    const records = await this.tokens.findAll({
      where: { user_id: userId },
      orderBy: { column: "created_at", direction: "DESC" },
    });

    return records.map(toApiTokenResource);
  }

  async revokeToken(userId: number, tokenId: number): Promise<void> {
    const record = await this.tokens.findById(tokenId);

    if (!record || record.user_id !== userId) {
      throw new NotFoundError(`API token ${tokenId} not found.`);
    }

    const deleted = await this.tokens.deleteById(tokenId);

    if (!deleted) {
      throw new NotFoundError(`API token ${tokenId} not found.`);
    }
  }

  tokenCan(user: AuthUser | null, ability: string): boolean {
    const abilities = user?.abilities ?? [];

    if (abilities.includes("*")) {
      return true;
    }

    return abilities.includes(ability);
  }

  requireAbility(user: AuthUser | null, ability: string): void {
    if (!this.tokenCan(user, ability)) {
      throw new ForbiddenError("Token ability required.");
    }
  }

  findByIdOrThrow(id: number): Promise<UserRecord> {
    return this.users.findByIdOrThrow(
      id,
      (userId) => new NotFoundError(`User ${userId} not found.`),
    );
  }

  async deleteUserAccount(userId: number): Promise<void> {
    await this.users.findByIdOrThrow(userId, (id) => new NotFoundError(`User ${id} not found.`));

    const tokens = await this.tokens.findAll({
      where: { user_id: userId },
    });

    for (const token of tokens) {
      await this.tokens.deleteById(token.id);
    }

    await this.users.updateByIdOrThrow(userId, {
      name: "Deleted User",
      email: `deleted-${userId}@anonymous.local`,
      password_hash: "",
      updated_at: new Date(),
    });
  }
}

export default TokenService;
export { generatePlainTextToken, normalizeAbilities, resolveExpiresAt, toApiTokenResource };
