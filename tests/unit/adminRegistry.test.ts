import { describe, expect, test } from "bun:test";
import { AdminResourceRegistry } from "../../src/core/admin/registry";

const usersResource = {
  name: "users",
  label: "User",
  labelPlural: "Users",
  columns: [{ key: "id" as const, label: "ID", type: "number" as const }],
  handlers: {
    paginate: async () => ({
      data: [{ id: 1 }],
      meta: { page: 1, per_page: 10, total: 1, last_page: 1 },
    }),
    findById: async (id: number) => ({ id }),
  },
};

describe("AdminResourceRegistry", () => {
  test("registers and lists resources", () => {
    const registry = new AdminResourceRegistry();
    registry.register(usersResource);

    expect(registry.list()).toEqual([
      {
        name: "users",
        label: "User",
        labelPlural: "Users",
        columns: [{ key: "id" as const, label: "ID", type: "number" as const }],
      },
    ]);
  });

  test("gets, lists all, and clears resources", () => {
    const registry = new AdminResourceRegistry();
    registry.register(usersResource);

    expect(registry.get("users")).toBeDefined();
    expect(registry.get("missing")).toBeUndefined();
    expect(registry.all()).toHaveLength(1);

    registry.clear();
    expect(registry.list()).toEqual([]);
  });

  test("rejects duplicate resource names", () => {
    const registry = new AdminResourceRegistry();
    registry.register(usersResource);

    expect(() => registry.register(usersResource)).toThrow(
      'Admin resource "users" is already registered.',
    );
  });
});
