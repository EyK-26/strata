type SqlDriver = "pgsql" | "mysql" | "sqlite";

interface SqlDialect {
  readonly driver: SqlDriver;
  placeholder(index: number): string;
  quoteIdentifier(identifier: string): string;
  nowExpression(): string;
  /** Authoritative database wall clock for persisted lease/retry deadlines. */
  epochMillisecondsExpression(): string;
  /** Current reads/row locks; SQLite serializes writes at transaction admission. */
  rowLockClause(skipLocked?: boolean): string;
  /** Render a Date as a literal this engine accepts for a timestamp column. */
  timestampValue(value: Date): string;
  returningClause(columns: string): string;
  ilikeOperator(): "ILIKE" | "LIKE";
  nullsLastSuffix(): string;
  castToText(expression: string): string;
  /** Conflict handling appended to an INSERT. Empty updates mean "do nothing". */
  upsertSuffix(conflictColumns: readonly string[], updateColumns: readonly string[]): string;
}

function assertSafeIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }

  return identifier;
}

function quoteIdentifierFor(
  dialect: { quoteIdentifier(value: string): string },
  column: string,
): string {
  return dialect.quoteIdentifier(column);
}

const postgresDialect: SqlDialect = Object.freeze({
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
  epochMillisecondsExpression(): string {
    return "CAST(EXTRACT(EPOCH FROM clock_timestamp()) * 1000 AS BIGINT)";
  },
  rowLockClause(skipLocked = false): string {
    return ` FOR UPDATE${skipLocked ? " SKIP LOCKED" : ""}`;
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
  upsertSuffix(conflictColumns: readonly string[], updateColumns: readonly string[]): string {
    const target = conflictColumns.map((column) => quoteIdentifierFor(this, column)).join(", ");

    if (updateColumns.length === 0) {
      return ` ON CONFLICT (${target}) DO NOTHING`;
    }

    const assignments = updateColumns
      .map((column) => {
        const quoted = quoteIdentifierFor(this, column);
        return `${quoted} = excluded.${quoted}`;
      })
      .join(", ");

    return ` ON CONFLICT (${target}) DO UPDATE SET ${assignments}`;
  },
});

const mysqlDialect: SqlDialect = Object.freeze({
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
  epochMillisecondsExpression(): string {
    return "CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000 AS UNSIGNED)";
  },
  rowLockClause(skipLocked = false): string {
    return ` FOR UPDATE${skipLocked ? " SKIP LOCKED" : ""}`;
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
  upsertSuffix(conflictColumns: readonly string[], updateColumns: readonly string[]): string {
    if (updateColumns.length === 0) {
      const anchor = quoteIdentifierFor(this, conflictColumns[0] ?? "");
      return ` ON DUPLICATE KEY UPDATE ${anchor} = ${anchor}`;
    }

    const assignments = updateColumns
      .map((column) => {
        const quoted = quoteIdentifierFor(this, column);
        return `${quoted} = VALUES(${quoted})`;
      })
      .join(", ");

    return ` ON DUPLICATE KEY UPDATE ${assignments}`;
  },
});

const sqliteDialect: SqlDialect = Object.freeze({
  driver: "sqlite",
  placeholder(): string {
    return "?";
  },
  quoteIdentifier(identifier: string): string {
    return `"${assertSafeIdentifier(identifier)}"`;
  },
  nowExpression(): string {
    // Same ISO-8601 text shape as timestampValue(); SQLite compares timestamps as strings.
    return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
  },
  epochMillisecondsExpression(): string {
    return "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";
  },
  rowLockClause(): string {
    return "";
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
  upsertSuffix(conflictColumns: readonly string[], updateColumns: readonly string[]): string {
    const target = conflictColumns.map((column) => quoteIdentifierFor(this, column)).join(", ");

    if (updateColumns.length === 0) {
      return ` ON CONFLICT (${target}) DO NOTHING`;
    }

    const assignments = updateColumns
      .map((column) => {
        const quoted = quoteIdentifierFor(this, column);
        return `${quoted} = excluded.${quoted}`;
      })
      .join(", ");

    return ` ON CONFLICT (${target}) DO UPDATE SET ${assignments}`;
  },
});

const dialects: Readonly<Record<SqlDriver, SqlDialect>> = Object.freeze({
  pgsql: postgresDialect,
  mysql: mysqlDialect,
  sqlite: sqliteDialect,
});

function dialectFor(driver: SqlDriver): SqlDialect {
  if (!Object.hasOwn(dialects, driver)) throw new TypeError("Unsupported SQL driver.");
  return dialects[driver];
}

export type { SqlDialect, SqlDriver };
export { dialectFor };
