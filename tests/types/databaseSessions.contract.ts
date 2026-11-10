/** Canonical public session surface; compiled, never executed. */
import { DATABASE_SESSION_TOKEN as RootToken } from "@getstrata/core";
import type { ServiceDeclaration } from "@getstrata/core/contracts/services";
import type { ServiceToken } from "@getstrata/core/contracts/token";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import type {
  DatabaseCapabilities,
  DatabaseDefinition,
  DatabaseSession,
  SqlStatement,
  TransactionOptions,
  TransactionSession,
} from "@getstrata/core/database/session";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import type { CommandScope } from "@getstrata/core/runtime/application";

export function databaseSessionContracts(
  scope: CommandScope,
  definition: DatabaseDefinition,
  statement: SqlStatement,
  options: TransactionOptions,
) {
  const token: ServiceToken<DatabaseSession> = RootToken;
  const db: DatabaseSession = scope.resolve(DATABASE_SESSION_TOKEN);
  const declarations: readonly ServiceDeclaration[] = createDatabaseBindings(definition);
  const named: DatabaseSession = db.connection("analytics");
  const rows: Promise<readonly { id: number }[]> = named.execute<{ id: number }>(statement);
  const transaction: Promise<number> = db.transaction(async (tx) => {
    const child: TransactionSession = tx;
    const capabilities: DatabaseCapabilities = child.capabilities;
    const registration: void = child.afterCommit(async () => {});
    const rollback: void = child.requestRollback();
    const nested: Promise<string> = child.transaction(() => "child");
    void [capabilities, registration, rollback, nested];
    // @ts-expect-error Transactions cannot switch connection/pool.
    tx.connection("other");
    // @ts-expect-error Transactions expose no physical release authority.
    tx.release();
    // @ts-expect-error Rollback is explicit no-argument intent, not an error/reason heuristic.
    tx.requestRollback("reason");
    // @ts-expect-error Nested transactions do not accept checkout settings.
    tx.transaction(() => 1, options);
    // @ts-expect-error Observer callback receives no implicit session/resolver authority.
    tx.afterCommit((session: DatabaseSession) => session.execute(statement));
    return 7;
  }, options);
  void [token, declarations, rows, transaction];
  // @ts-expect-error SQL statements require an explicit immutable parameter array.
  db.execute({ text: "SELECT 1" });
  // @ts-expect-error Session exposes no unsafe SQL/global routing facade.
  db.unsafe("SELECT 1");
  // @ts-expect-error Session exposes no backend close authority.
  db.close();
  // @ts-expect-error Execution session has no rollback outside a transaction branch.
  db.requestRollback();
  // @ts-expect-error Dialect snapshot is readonly.
  db.dialect = named.dialect;
  // @ts-expect-error Capabilities are driver proof, never mutable caller assertions.
  db.capabilities.savepoints = false;
  // @ts-expect-error Unsupported isolation option is not silently accepted.
  db.transaction(() => 1, { isolation: "serializable" });
  // @ts-expect-error Named binding definitions require explicit default selection.
  createDatabaseBindings({ connections: { main: { driver: "sqlite", filename: ":memory:" } } });
  createDatabaseBindings({
    default: "main",
    // @ts-expect-error SQLite does not accept PostgreSQL native pool fields.
    connections: { main: { driver: "sqlite", filename: ":memory:", max: 2 } },
  });
  createDatabaseBindings({
    default: "main",
    // @ts-expect-error MySQL options do not accept PostgreSQL idleTimeout.
    connections: { main: { driver: "mysql", url: "mysql://localhost/db", idleTimeout: 2 } },
  });
  // @ts-expect-error Config snapshot remains readonly at public boundary.
  definition.default = "other";
  // @ts-expect-error Statement parameter snapshot cannot be edited through its contract.
  statement.params.push(1);
}
