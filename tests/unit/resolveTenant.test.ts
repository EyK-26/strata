import { describe, expect, test } from "bun:test";
import { resolveTenant } from "@getstrata/core/tenant/resolveTenant";
import { withBoundDatabase } from "../helpers/boundRepositoryHarness";

describe("resolveTenant", () => {
  test("loads an explicit selected database row and returns null for a missing identity", async () => {
    await withBoundDatabase(
      {
        definition: {
          default: "main",
          connections: { main: { driver: "sqlite", filename: ":memory:" } },
        },
      },
      async (database) => {
        await database.execute({
          text: "CREATE TABLE tenant (id INTEGER PRIMARY KEY,slug TEXT)",
          params: [],
        });
        await database.execute({ text: "INSERT INTO tenant VALUES (?,?)", params: [1, "default"] });
        expect(await resolveTenant(database, 1)).toEqual({ id: 1, slug: "default" });
        expect(await resolveTenant(database, 999)).toBeNull();
      },
    );
  });
});
