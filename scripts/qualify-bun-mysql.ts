/** Opt-in qualification; temporary tables only. Run with MYSQL_URL against a test database. */
import assert from "node:assert/strict";
import { SQL } from "bun";
import { createMysqlPool, executeMysql } from "../src/core/database/mysqlNative";

const url = process.env.MYSQL_URL?.trim();
if (!url) throw new Error("MYSQL_URL is required for native MySQL qualification.");
const native = new SQL({ url, max: 2, connectionTimeout: 2 });
const legacy = await createMysqlPool(url, 1);
const report: Record<string, unknown> = { bun: Bun.version };
try {
  const one = await native.reserve();
  const two = await native.reserve();
  try {
    const oneId = (await one.unsafe("SELECT CONNECTION_ID() AS id"))[0].id;
    const twoId = (await two.unsafe("SELECT CONNECTION_ID() AS id"))[0].id;
    await one.unsafe(
      "CREATE TEMPORARY TABLE strata_bun_qualification (id INT PRIMARY KEY, value INT)",
    );
    await one.unsafe("BEGIN");
    await one.unsafe("INSERT INTO strata_bun_qualification VALUES (?, ?)", [1, 2]);
    await one.unsafe("SAVEPOINT before_update");
    await one.unsafe("UPDATE strata_bun_qualification SET value = ? WHERE id = ?", [3, 1]);
    await one.unsafe("ROLLBACK TO SAVEPOINT before_update");
    assert.equal((await one.unsafe("SELECT value FROM strata_bun_qualification"))[0].value, 2);
    const noOp = await one.unsafe("UPDATE strata_bun_qualification SET value = 2 WHERE id = 1");
    report.nativeUnchangedAffectedRows = Reflect.get(noOp, "affectedRows");
    await one.unsafe("ROLLBACK");
    assert.equal(
      (await one.unsafe("SELECT COUNT(*) AS count FROM strata_bun_qualification"))[0].count,
      0,
    );
    report.boundQueriesSavepointsRollback = "passed";

    const controller = new AbortController();
    const reason = new Error("qualification checkout cancellation");
    const blocked = native.reserve({ signal: controller.signal }).then(
      (connection) => {
        connection.release();
        return "acquired";
      },
      (error) => error,
    );
    controller.abort(reason);
    const cancellation = await Promise.race([blocked, Bun.sleep(1000).then(() => "timeout")]);
    report.cancellableCheckout = cancellation === reason;
    await one.close({ timeout: 0 });
    assert.equal((await two.unsafe("SELECT CONNECTION_ID() AS id"))[0].id, twoId);
    const replacement = await native.reserve();
    try {
      assert.notEqual((await replacement.unsafe("SELECT CONNECTION_ID() AS id"))[0].id, oneId);
    } finally {
      replacement.release();
    }
    await blocked;
    report.isolatedDiscard = "passed";
  } finally {
    one.release();
    two.release();
  }

  if (!legacy.getConnection) throw new Error("mysql2 did not expose connection checkout");
  const connection = await legacy.getConnection();
  try {
    await executeMysql(
      connection,
      "CREATE TEMPORARY TABLE strata_mysql2_qualification (id INT PRIMARY KEY, value INT)",
      [],
    );
    await executeMysql(connection, "INSERT INTO strata_mysql2_qualification VALUES (?, ?)", [1, 2]);
    const rows = await executeMysql<{ affectedRows: number }>(
      connection,
      "UPDATE strata_mysql2_qualification SET value = 2 WHERE id = 1",
      [],
    );
    report.currentUnchangedAffectedRows = rows[0]?.affectedRows;
  } finally {
    connection.release();
  }
  const query =
    "SELECT CAST('18446744073709551615' AS UNSIGNED) AS big_value, CAST('9007199254740993.12345678901234567890' AS DECIMAL(65,20)) AS precise";
  const expected = {
    big_value: "18446744073709551615",
    precise: "9007199254740993.12345678901234567890",
  };
  assert.deepEqual((await native.unsafe(query))[0], expected);
  assert.deepEqual((await executeMysql(legacy, query, []))[0], expected);
  report.exactNumbers = "passed";
  report.unchangedMutationContractMatches =
    report.nativeUnchangedAffectedRows === report.currentUnchangedAffectedRows;
  report.defaultReplacementApproved = false;
  report.decision =
    "Retain mysql2: unchanged-update result compatibility, read-only observation integration and representative performance qualification are required before replacing the adapter.";
  console.log(JSON.stringify(report, null, 2));
} finally {
  await native.close({ timeout: 0 });
  await legacy.end();
}
