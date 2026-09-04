import { randomBytes } from "node:crypto";
import { hashApiToken } from "@getstrata/core/auth/tokenHash";
import { NotFoundError } from "@getstrata/core/errors/http";
import { iso } from "../../lib/serialize.ts";
import { type ApiTokenRecord, apiTokens } from "./tokenRepository.ts";

export interface ApiTokenResource {
  id: number;
  name: string;
  abilities: string[];
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string | null;
}

export interface CreatedApiToken {
  token: ApiTokenResource;
  plainTextToken: string;
}

function normalizeAbilities(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : ["*"];
    } catch {
      return ["*"];
    }
  }
  return ["*"];
}

function toApiTokenResource(record: ApiTokenRecord): ApiTokenResource {
  return {
    id: Number(record.id),
    name: record.name,
    abilities: normalizeAbilities(record.abilities),
    last_used_at: iso(record.last_used_at),
    expires_at: iso(record.expires_at),
    created_at: iso(record.created_at),
  };
}

export class TokenService {
  async createToken(
    userId: number,
    input: { name: string; abilities?: string[]; expiresInDays?: number },
  ): Promise<CreatedApiToken> {
    const plainTextToken = randomBytes(32).toString("hex");
    const expiresAt =
      input.expiresInDays === undefined
        ? null
        : new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);
    const record = await apiTokens.create({
      user_id: userId,
      name: input.name,
      token_hash: hashApiToken(plainTextToken),
      abilities: input.abilities && input.abilities.length > 0 ? input.abilities : ["*"],
      last_used_at: null,
      expires_at: expiresAt,
      created_at: new Date(),
    });
    return { token: toApiTokenResource(record), plainTextToken };
  }

  async listTokens(userId: number): Promise<ApiTokenResource[]> {
    return (await apiTokens.forUser(userId)).map(toApiTokenResource);
  }

  async revokeToken(userId: number, tokenId: number): Promise<void> {
    const record = await apiTokens.findById(tokenId);
    if (!record || Number(record.user_id) !== userId) {
      throw new NotFoundError(`API token ${tokenId} not found.`);
    }
    await apiTokens.deleteById(tokenId);
  }

  async revokeOtherTokens(userId: number, exceptTokenId?: number): Promise<number> {
    const records = await apiTokens.forUser(userId);
    let revoked = 0;
    for (const record of records) {
      if (exceptTokenId !== undefined && Number(record.id) === exceptTokenId) {
        continue;
      }
      if (await apiTokens.deleteById(record.id)) {
        revoked += 1;
      }
    }
    return revoked;
  }
}

export const tokenService = new TokenService();
