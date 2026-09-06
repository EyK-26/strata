import { createAsyncContextStore } from "../runtime/asyncContextStore";
import { type DatabaseDriver, resolveDatabaseDriver } from "./schema/driver.ts";

interface SqlDialect {
  readonly driver: DatabaseDriver;
  placeholder(index: number): string;
  quoteIdentifier(identifier: string): string;
  nowExpression(): string;
  /** Render a Date as a literal this engine accepts for a timestamp column. */
  timestampValue(value: Date): string;
  returningClause(columns: string): string;
  ilikeOperator(): "ILIKE" | "LIKE";
  nullsLastSuffix(): string;
  castToText(expression: string): string;
}

function assertSafeIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }

  return identifier;
}

const postgresDialect: SqlDialect = {
  driver: "pgsql",
  placeholder(index: number): string {
    return `$${index}`;
  },
  quoteIdentifier(identifier: string): string {
    return `"${assertSafeIdentifier(identifier)}"`;
  },
  nowExpression(): string {
    return "NOW()";
  },
  timestampValue(value: Date): string {
    return value.toISOString();
  },
  returningClause(columns: string): string {
    return ` RETURNING ${columns}`;
  },
  ilikeOperator(): "ILIKE" {
    return "ILIKE";
  },
  nullsLastSuffix(): string {
    return " NULLS LAST";
  },
  castToText(expression: string): string {
    return `${expression}::text`;
  },
};

const mysqlDialect: SqlDialect = {
  driver: "mysql",
  placeholder(): string {
    return "?";
  },
  quoteIdentifier(identifier: string): string {
    return `\`${assertSafeIdentifier(identifier)}\``;
  },
  nowExpression(): string {
    return "CURRENT_TIMESTAMP";
  },
  timestampValue(value: Date): string {
    return value.toISOString().slice(0, 19).replace("T", " ");
  },
  returningClause(): string {
    return "";
  },
  ilikeOperator(): "LIKE" {
    return "LIKE";
  },
  nullsLastSuffix(): string {
    return "";
  },
  castToText(expression: string): string {
    return `CAST(${expression} AS CHAR)`;
  },
};

const sqliteDialect: SqlDialect = {
  driver: "sqlite",
  placeholder(): string {
    return "?";
  },
  quoteIdentifier(identifier: string): string {
    return `"${assertSafeIdentifier(identifier)}"`;
  },
  nowExpression(): string {
    return "CURRENT_TIMESTAMP";
  },
  timestampValue(value: Date): string {
    return value.toISOString();
  },
  returningClause(columns: string): string {
    return ` RETURNING ${columns}`;
  },
  ilikeOperator(): "LIKE" {
    return "LIKE";
  },
  nullsLastSuffix(): string {
    return "";
  },
  castToText(expression: string): string {
    return `CAST(${expression} AS TEXT)`;
  },
};

const dialects: Record<DatabaseDriver, SqlDialect> = {
  pgsql: postgresDialect,
  mysql: mysqlDialect,
  sqlite: sqliteDialect,
};

const dialectContext = createAsyncContextStore<SqlDialect>("@getstrata/sqlDialect");

let dialectOverride: SqlDialect | null = null;

function dialectFor(driver: DatabaseDriver): SqlDialect {
  return dialects[driver];
}

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
