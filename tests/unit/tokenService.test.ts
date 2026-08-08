import { beforeAll, describe, expect, test } from "bun:test";
import { hashApiToken } from "../../src/core/auth/tokenHash";
import ApiTokenRepository from "../../src/modules/user/apiTokenRepository";
import UserRepository from "../../src/modules/user/repository";
import TokenService from "../../src/modules/user/tokenService";

beforeAll(async () => {
  const { freshDatabase } = await import("../../src/db/migrations/runner");
  await freshDatabase({ seed: true });
});

describe("TokenService", () => {
  test("createToken returns a plain token and persists a hash", async () => {
    const users = new UserRepository();
    const tokens = new ApiTokenRepository();
    const service = new TokenService(users, tokens);

    const created = await service.createToken(1, {
      name: "ci-token",
      abilities: ["*"],
    });

    expect(created.plainTextToken).toMatch(/^[a-f0-9]{64}$/);
    expect(created.token.name).toBe("ci-token");
    expect(created.token.abilities).toEqual(["*"]);

    const resolved = await service.resolveUserFromToken(created.plainTextToken);
    expect(resolved).toEqual({
      id: 1,
      role: "admin",
      abilities: ["*"],
      tokenId: created.token.id,
    });

    const stored = await tokens.findByTokenHash(hashApiToken(created.plainTextToken));
    expect(stored?.user_id).toBe(1);
  });

  test("resolveUserFromToken returns null for expired tokens", async () => {
    const users = new UserRepository();
    const tokens = new ApiTokenRepository();
    const service = new TokenService(users, tokens);

    const created = await service.createToken(1, {
      name: "expired",
      expiresAt: new Date(Date.now() - 60_000),
    });

    expect(await service.resolveUserFromToken(created.plainTextToken)).toBeNull();
  });

  test("listTokensForUser excludes token hashes", async () => {
    const service = new TokenService(new UserRepository(), new ApiTokenRepository());
    const created = await service.createToken(1, { name: "listed" });

    const listed = await service.listTokensForUser(1);
    expect(listed.some((token) => token.id === created.token.id)).toBe(true);
    expect(listed.every((token) => !("token_hash" in token))).toBe(true);
  });

  test("revokeToken removes access for the token owner", async () => {
    const service = new TokenService(new UserRepository(), new ApiTokenRepository());
    const created = await service.createToken(2, { name: "revoke-me" });

    await service.revokeToken(2, created.token.id);

    expect(await service.resolveUserFromToken(created.plainTextToken)).toBeNull();
  });
});
