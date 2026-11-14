import { describe, expect, test } from "bun:test";
import { createMysqlPool, executeMysql } from "../../src/core/database/mysqlNative";

const url = process.env.MYSQL_URL?.trim() ?? "";
const suite = url ? describe : describe.skip;
suite("MySQL exact numeric transport", () => {
  test("unsigned BIGINT and DECIMAL are transported without Number rounding", async () => {
    const pool = await createMysqlPool(url, 1);
    try {
      const rows = await executeMysql<{ big_value: string; precise: string }>(
        pool,
        "SELECT CAST('18446744073709551615' AS UNSIGNED) AS big_value, CAST('9007199254740993.12345678901234567890' AS DECIMAL(65,20)) AS precise",
        [],
      );
      expect(rows[0]).toEqual({
        big_value: "18446744073709551615",
        precise: "9007199254740993.12345678901234567890",
      });
      const bound = await executeMysql<{ big_value: string }>(
        pool,
        "SELECT CAST(? AS UNSIGNED) AS big_value",
        ["9007199254740993"],
      );
      expect(bound[0]?.big_value).toBe("9007199254740993");
    } finally {
      await pool.end();
    }
  });
});
