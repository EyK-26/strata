import { describe, expect, test } from "bun:test";
import { hashApiToken } from "@getstrata/core/auth/tokenHash";
import ApiTokenRepository from "../../src/modules/user/apiTokenRepository";
import UserRepository from "../../src/modules/user/repository";
import TokenService, {
  generatePlainTextToken,
  normalizeAbilities,
  resolveExpiresAt,
  toApiTokenResource,
} from "../../src/modules/user/tokenService";

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

    const withExpiry = await service.createToken(1, {
      name: "expiring",
      expiresInDays: 7,
    });
    expect(withExpiry.token.expires_at).not.toBeNull();

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

  test("tokenCan and requireAbility enforce token scopes", () => {
    const service = new TokenService(new UserRepository(), new ApiTokenRepository());

    expect(
      service.tokenCan({ id: 1, role: "member", abilities: ["tasks:read"] }, "tasks:read"),
    ).toBe(true);
    expect(service.tokenCan({ id: 1, role: "member", abilities: ["*"] }, "anything")).toBe(true);
    expect(service.tokenCan(null, "tasks:read")).toBe(false);

    expect(() => service.requireAbility(null, "tasks:read")).toThrow("Token ability required.");
  });

  test("deleteUserAccount anonymizes the user and revokes tokens", async () => {
    const service = new TokenService(new UserRepository(), new ApiTokenRepository());
    const first = await service.createToken(2, { name: "delete-me" });
    const second = await service.createToken(2, { name: "delete-me-too" });

    await service.deleteUserAccount(2);

    expect(await service.resolveUserFromToken(first.plainTextToken)).toBeNull();
    expect(await service.resolveUserFromToken(second.plainTextToken)).toBeNull();
    const user = await new UserRepository().findById(2);
    expect(user?.email).toContain("deleted-2@anonymous.local");
  });

  test("revokeToken rejects tokens that do not belong to the user", async () => {
    const service = new TokenService(new UserRepository(), new ApiTokenRepository());
    const created = await service.createToken(1, { name: "owned-by-admin" });

    await expect(service.revokeToken(2, created.token.id)).rejects.toThrow(
      `API token ${created.token.id} not found.`,
    );
  });

  test("findByIdOrThrow returns the requested user", async () => {
    const service = new TokenService(new UserRepository(), new ApiTokenRepository());

    await expect(service.findByIdOrThrow(1)).resolves.toMatchObject({ id: 1 });
  });

  test("toApiTokenResource maps stored records to API resources", () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");

    expect(
      toApiTokenResource({
        id: 3,
        user_id: 1,
        name: "cli",
        token_hash: "hash",
        abilities: ["tasks:read"],
        last_used_at: null,
        expires_at: null,
        created_at: createdAt,
      }),
    ).toEqual({
      id: 3,
      name: "cli",
      abilities: ["tasks:read"],
      last_used_at: null,
      expires_at: null,
      created_at: createdAt.toISOString(),
    });
  });

  test("covers token helper utilities", () => {
    expect(generatePlainTextToken()).toMatch(/^[a-f0-9]{64}$/);
    expect(normalizeAbilities(["*"])).toEqual(["*"]);
    expect(normalizeAbilities('["tasks:read"]')).toEqual(["tasks:read"]);
    expect(
      resolveExpiresAt({ name: "demo", expiresAt: new Date("2030-01-01T00:00:00.000Z") }),
    ).toEqual(new Date("2030-01-01T00:00:00.000Z"));
    expect(resolveExpiresAt({ name: "demo", expiresInDays: 3 })).toBeInstanceOf(Date);
    expect(resolveExpiresAt({ name: "demo" })).toBeNull();
    expect(normalizeAbilities(null)).toEqual(["*"]);
  });

  test("rejects missing users when creating tokens or deleting accounts", async () => {
    const service = new TokenService(new UserRepository(), new ApiTokenRepository());

    await expect(service.createToken(999, { name: "missing-user" })).rejects.toThrow(
      "User 999 not found.",
    );
    await expect(service.deleteUserAccount(999)).rejects.toThrow("User 999 not found.");
    await expect(service.findByIdOrThrow(999)).rejects.toThrow("User 999 not found.");
  });

  test("requireAbility succeeds when the token has the requested ability", () => {
    const service = new TokenService(new UserRepository(), new ApiTokenRepository());

    expect(() =>
      service.requireAbility({ id: 1, role: "member", abilities: ["tasks:read"] }, "tasks:read"),
    ).not.toThrow();
  });
});
