import { expect, test } from "bun:test";
import { createDatabaseConnection } from "@getstrata/core/database/connection";

test("public connection wrapper delegates receiver/query/default and explicit params without copying results", async () => {
  const rows = [{ id: 7, title: "delegated" }];
  const calls: Array<{ receiver: unknown; query: string; params: readonly unknown[] | undefined }> =
    [];
  const source = {
    async unsafe<Row>(query: string, params?: readonly unknown[]): Promise<Row[]> {
      calls.push({ receiver: this, query, params });
      return rows as Row[];
    },
  };
  const connection = createDatabaseConnection(source);
  expect(connection).not.toBe(source);
  expect(await connection.unsafe<{ id: number; title: string }>("SELECT default")).toBe(rows);
  expect(calls[0]).toMatchObject({ receiver: source, query: "SELECT default", params: [] });
  const params = Object.freeze([7, "literal", null]);
  const returned = await connection.unsafe<{ id: number; title: string }>("SELECT bound", params);
  expect(returned).toBe(rows);
  expect(returned[0]?.id).toBe(7);
  expect(calls[1]?.receiver).toBe(source);
  expect(calls[1]?.query).toBe("SELECT bound");
  expect(calls[1]?.params).toBe(params);
  expect(params).toEqual([7, "literal", null]);
  expect(calls).toHaveLength(2);
});

test("public connection wrapper preserves synchronous and asynchronous opaque failure identities", async () => {
  const original = new Error("source query failed");
  const synchronous = createDatabaseConnection({
    unsafe() {
      throw original;
    },
  });
  await expect(synchronous.unsafe("SELECT failure")).rejects.toBe(original);
  for (const value of [undefined, null, false, 0, ""]) {
    const asynchronous = createDatabaseConnection({
      async unsafe() {
        throw value;
      },
    });
    let failed = false;
    let actual: unknown;
    try {
      await asynchronous.unsafe("SELECT opaque failure", []);
    } catch (error) {
      failed = true;
      actual = error;
    }
    expect(failed).toBe(true);
    expect(actual).toBe(value);
  }
});
