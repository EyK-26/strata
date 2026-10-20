/** Compiled against source and packed exports. */
import type { DatabaseConnection } from "@getstrata/core";
import { createMysqlConnection } from "@getstrata/core/database/mysqlConnection";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";

export async function readOnlyObservationContract(connection: DatabaseConnection) {
  const options = { signal: AbortSignal.timeout(1000), timeoutMs: 1000 };
  const value: number | undefined = await connection.observeReadOnly?.(async (session) => {
    const rows = await session.unsafe<{ id: number }>("SELECT id FROM source LIMIT 1");
    return rows[0]?.id ?? 0;
  }, options);
  const mysql = createMysqlConnection("mysql://fixture/local");
  await mysql.observeReadOnly(async () => value, options);
  const sqlite = createSqliteConnection("app.sqlite");
  await sqlite.observeReadOnly(async () => value, options);
  // @ts-expect-error Observation requires an explicit interruption signal and deadline.
  sqlite.observeReadOnly(async () => 1, {});
}

// Existing root and repository subpaths must retain the same capability contract.
export function repositoryConnectionCompatibility(
  root: DatabaseConnection,
  repository: import("@getstrata/core/database/baseRepository").DatabaseConnection,
  sql: import("@getstrata/core/database/baseRepository").SqlDatabaseConnection,
): [DatabaseConnection, import("@getstrata/core/database/baseRepository").DatabaseConnection] {
  const tagged: Promise<unknown[]> = sql`SELECT ${1}`;
  void tagged;
  return [repository, root];
}
