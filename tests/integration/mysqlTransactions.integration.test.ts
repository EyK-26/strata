import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  bindDatabaseConnection,
  getBoundDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import { resetSqlDialect, useSqlDialect } from "@getstrata/core/database/dialect";
import { createMysqlConnection } from "@getstrata/core/database/mysqlConnection";
import { repositoryConnection as db } from "@getstrata/core/database/repositoryConnection";
import { runInTransaction } from "@getstrata/core/database/transaction";

const url = process.env.MYSQL_URL;
describe.skipIf(!url)("real MySQL transaction pinning", () => {
  const table = `tx_${crypto.randomUUID().replaceAll("-", "")}`;
  let connection: ReturnType<typeof createMysqlConnection>;
  let previous: ReturnType<typeof getBoundDatabaseConnection>;
  beforeAll(async () => {
    if (!url) throw new Error("Dedicated MySQL test URL required.");
    connection = createMysqlConnection(url);
    await connection.unsafe(`CREATE TABLE ${table} (value INTEGER PRIMARY KEY) ENGINE=InnoDB`);
    previous = getBoundDatabaseConnection();
    bindDatabaseConnection(connection);
    useSqlDialect("mysql");
  });
  afterAll(async () => {
    if (previous) bindDatabaseConnection(previous);
    else resetBoundDatabaseConnection();
    resetSqlDialect();
    await connection?.unsafe(`DROP TABLE IF EXISTS ${table}`);
    await connection?.close();
  });
  test("rollback and nested savepoints use the actual reserved session", async () => {
    await expect(
      runInTransaction(async () => {
        await connection.unsafe(`INSERT INTO ${table} VALUES (?)`, [1]);
        await Bun.sleep(5);
        await db.unsafe(`INSERT INTO ${table} VALUES (?)`, [2]);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await connection.unsafe(`SELECT * FROM ${table}`)).toEqual([]);
    await runInTransaction(async () => {
      await db.unsafe(`INSERT INTO ${table} VALUES (?)`, [1]);
      await expect(
        runInTransaction(async () => {
          await db.unsafe(`INSERT INTO ${table} VALUES (?)`, [2]);
          throw new Error("savepoint");
        }),
      ).rejects.toThrow("savepoint");
      await db.unsafe(`INSERT INTO ${table} VALUES (?)`, [3]);
    });
    expect(await connection.unsafe(`SELECT value FROM ${table} ORDER BY value`)).toEqual([
      { value: 1 },
      { value: 3 },
    ]);
  });
  test("concurrent roots have distinct sessions and outsiders cannot read uncommitted writes", async () => {
    await connection.unsafe(`DELETE FROM ${table}`);
    let ready: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let session: number | undefined;
    const first = runInTransaction(async () => {
      session = Number((await db.unsafe<{ id: number }>("SELECT CONNECTION_ID() AS id"))[0]?.id);
      await db.unsafe(`INSERT INTO ${table} VALUES (?)`, [4]);
      ready?.();
      await Bun.sleep(30);
    });
    await entered;
    await runInTransaction(async () => {
      const second = Number(
        (await db.unsafe<{ id: number }>("SELECT CONNECTION_ID() AS id"))[0]?.id,
      );
      expect(second).not.toBe(session);
      expect(await db.unsafe(`SELECT * FROM ${table}`)).toEqual([]);
    });
    await first;
    expect(await connection.unsafe(`SELECT value FROM ${table}`)).toEqual([{ value: 4 }]);
  });
});
