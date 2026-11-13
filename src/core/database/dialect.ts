import { createAsyncContextStore } from "../runtime/asyncContextStore";
import type { DatabaseDriver } from "./schema/driver.ts";

import { dialectFor, type SqlDialect } from "./sqlDialects";

const dialectContext = createAsyncContextStore<SqlDialect>("@getstrata/sqlDialect");

/** Resolve only the explicitly owned async SQL context. */
function currentSqlDialect(): SqlDialect {
  const dialect = dialectContext.getStore();
  if (!dialect) {
    throw new Error("SQL dialect context is required. Use runWithSqlDialect(driver, callback).");
  }
  return dialect;
}

/** Format a timestamp parameter for whichever engine is active. */
function sqlTimestamp(value: Date = new Date()): string {
  return currentSqlDialect().timestampValue(value);
}

function runWithSqlDialect<T>(driver: DatabaseDriver, callback: () => T): T {
  return dialectContext.run(dialectFor(driver), callback);
}

export type { SqlDialect };
export { currentSqlDialect, dialectFor, runWithSqlDialect, sqlTimestamp };
