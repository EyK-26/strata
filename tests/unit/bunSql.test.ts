import { describe, expect, test } from "bun:test";
import { createBunSqlPool } from "@getstrata/core/database/bunSql";

describe("explicit Bun SQL pool constructor", () => {
  test("createBunSqlPool requires a url", () => {
    expect(() => createBunSqlPool({ url: "" })).toThrow("DATABASE_URL is not configured");
  });

  test("createBunSqlPool returns a Bun SQL client", async () => {
    const sql = createBunSqlPool({
      url: "postgres://postgres:postgres@127.0.0.1:1/strata_pool_test",
      max: 2,
      idleTimeout: 5,
      maxLifetime: 30,
      connectionTimeout: 1,
    });

    expect(typeof sql.unsafe).toBe("function");
    await sql.close();
  });

  test("createBunSqlPool uses pool defaults when options are omitted", async () => {
    const sql = createBunSqlPool({
      url: "postgres://postgres:postgres@127.0.0.1:1/strata_pool_defaults",
    });

    expect(typeof sql.unsafe).toBe("function");
    await sql.close();
  });
});
