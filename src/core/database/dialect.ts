import { createAsyncContextStore } from "../runtime/asyncContextStore";
import { type DatabaseDriver, resolveDatabaseDriver } from "./schema/driver.ts";

import { dialectFor, type SqlDialect } from "./sqlDialects";

const dialectContext = createAsyncContextStore<SqlDialect>("@getstrata/sqlDialect");

let dialectOverride: SqlDialect | null = null;

function currentSqlDialect(): SqlDialect {
  return dialectContext.getStore() ?? dialectOverride ?? dialectFor(resolveDatabaseDriver());
}

function useSqlDialect(driver: DatabaseDriver): SqlDialect {
  dialectOverride = dialectFor(driver);
  return dialectOverride;
}

/** Format a timestamp parameter for whichever engine is active. */
function sqlTimestamp(value: Date = new Date()): string {
  return currentSqlDialect().timestampValue(value);
}

function resetSqlDialect(): void {
  dialectOverride = null;
}

function runWithSqlDialect<T>(
  driver: DatabaseDriver,
  callback: () => T | Promise<T>,
): T | Promise<T> {
  return dialectContext.run(dialectFor(driver), callback);
}

export type { SqlDialect };
export {
  currentSqlDialect,
  dialectFor,
  resetSqlDialect,
  runWithSqlDialect,
  sqlTimestamp,
  useSqlDialect,
};
