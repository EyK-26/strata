/** Real MySQL work; only delivery of a successful CREATE USER result is held. */
import { mock } from "bun:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const parent = process.argv[2];
assert.ok(parent);
const mysql = await import("mysql2/promise");
const realCreateConnection = mysql.createConnection;
const release = new Response(Bun.stdin.stream()).text();
void release.catch(() => undefined);
let signalled = false,
  databaseName = "";
const emit = (record: Record<string, unknown>) => console.log(JSON.stringify(record));
const terminate = () => {
  signalled = true;
  emit({ event: "cancel-observed" });
};
process.once("SIGTERM", terminate);
mock.module("mysql2/promise", () => ({
  ...mysql,
  createConnection: async (url: string) => {
    const connection = await realCreateConnection(url);
    const query = connection.query.bind(connection) as (
      sql: string,
      values?: unknown[],
    ) => Promise<unknown>;
    connection.query = (async (sql: string, values?: unknown[]) => {
      if (sql.startsWith("GRANT ")) emit({ event: "grant-admitted" });
      const result = await query(sql, values);
      const database = /^CREATE DATABASE (generated_security_[a-f0-9]{32})$/.exec(sql);
      if (database) databaseName = database[1] as string;
      const user = /^CREATE USER '(q01_[a-f0-9]{18})'@'%' IDENTIFIED BY /.exec(sql);
      if (user) {
        assert.match(databaseName, /^generated_security_[a-f0-9]{32}$/);
        const roots = (await readdir(parent)).filter((name) => name.startsWith("strata-security-"));
        assert.equal(roots.length, 1);
        const root = join(parent, roots[0] as string);
        emit({ event: "successful-result-held", databaseName, mysqlUser: user[1], root });
        assert.equal((await release).trim(), "release");
        emit({ event: "successful-result-released" });
      }
      return result;
    }) as typeof connection.query;
    return connection;
  },
}));
try {
  const { createGeneratedSecurityApp } = await import("../helpers/generatedSecurityApp");
  const fixture = await createGeneratedSecurityApp(
    "mysql",
    [
      "--frontend=api",
      "--auth=headers",
      "--tenancy=column",
      "--cache=array",
      "--queue=sync",
      "--mail=log",
      "--no-docker",
      "--no-mfa",
      "--no-email-verification",
      "--no-scim",
      "--no-metrics",
    ],
    { parentDirectory: parent },
  );
  emit({ event: "unexpected-ready" });
  await fixture.close();
  process.exitCode = 1;
} catch (error) {
  const expectedCancellation =
    signalled &&
    error instanceof Error &&
    error.constructor === Error &&
    error.name === "Error" &&
    error.message === "Generated security setup interrupted by SIGTERM.";
  // Driver errors can carry SQL/passwords. Preserve them in-process; emit no raw objects.
  emit({
    event: "setup-rejected",
    expectedCancellation,
    kind:
      error instanceof AggregateError
        ? "aggregate"
        : error instanceof Error
          ? "error"
          : "non-error",
  });
  process.exitCode = expectedCancellation ? 143 : 1;
} finally {
  process.removeListener("SIGTERM", terminate);
}
