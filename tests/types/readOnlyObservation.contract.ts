/** Compiled against source and packed exports. */

import { createMysqlConnection } from "@getstrata/core/database/mysqlConnection";
import type { DatabaseSession, SqlStatement } from "@getstrata/core/database/session";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import type {
  FailedJobObservation,
  ReadOnlyObservationExecutor,
} from "@getstrata/core/queue/failedJobMetrics";
export async function readOnlyObservationContract(observe: FailedJobObservation) {
  const value: number = await observe(1000, async (executor) => {
    const rows = await executor.execute<{ id: number }>({
      text: "SELECT id FROM source LIMIT 1",
      params: [],
    });
    return rows[0]?.id ?? 0;
  });
  const options = { signal: AbortSignal.timeout(1000), timeoutMs: 1000 };
  const mysql = createMysqlConnection("mysql://fixture/local");
  await mysql.observeReadOnly(async () => value, options);
  const sqlite = createSqliteConnection("app.sqlite");
  await sqlite.observeReadOnly(async () => value, options);
  // @ts-expect-error Observation requires an explicit interruption signal and deadline.
  sqlite.observeReadOnly(async () => 1, {});
  // @ts-expect-error A bounded observer cannot manufacture canonical transaction authority.
  const session: DatabaseSession = {} as ReadOnlyObservationExecutor;
  void session;
}
/** Session execution keeps the same statement contract as the narrow observer. */
export function repositoryConnectionCompatibility(
  root: DatabaseSession,
  observer: ReadOnlyObservationExecutor,
  statement: SqlStatement,
): [Promise<readonly unknown[]>, Promise<readonly unknown[]>] {
  return [root.execute(statement), observer.execute(statement)];
}
