import type { DatabaseConnection, SqlDatabaseConnection } from "./baseRepository";
import { getBoundDatabaseConnection } from "./boundConnection";
import { getDefaultDatabaseQuery } from "./defaultConnection";
import { currentSqlDialect } from "./dialect";

function resolveRepositoryConnection(): SqlDatabaseConnection {
  return (getBoundDatabaseConnection() ?? getDefaultDatabaseQuery()) as SqlDatabaseConnection;
}

function compileTaggedSql(
  strings: TemplateStringsArray,
  values: readonly unknown[],
): { query: string; params: unknown[] } {
  const dialect = currentSqlDialect();
  let query = strings[0] ?? "";
  const params: unknown[] = [];

  for (let index = 0; index < values.length; index += 1) {
    params.push(values[index]);
    query += `${dialect.placeholder(params.length)}${strings[index + 1] ?? ""}`;
  }

  return { query, params };
}

function isTaggedStrings(value: unknown): value is TemplateStringsArray {
  if (!Array.isArray(value) || typeof value[0] !== "string") {
    return false;
  }

  return typeof (value as unknown as { raw?: unknown }).raw !== "undefined";
}

function runOnConnection(connection: DatabaseConnection, args: unknown[]): unknown {
  if (typeof connection === "function") {
    return (connection as SqlDatabaseConnection)(...(args as [TemplateStringsArray, ...unknown[]]));
  }

  if (typeof connection.unsafe !== "function") {
    throw new Error("Database connection cannot run SQL.");
  }

  const strings = args[0];
  if (!isTaggedStrings(strings)) {
    throw new Error("Database connection cannot run tagged SQL.");
  }

  const compiled = compileTaggedSql(strings, args.slice(1));
  return connection.unsafe(compiled.query, compiled.params);
}

const repositoryConnection = new Proxy(
  function repositoryConnection() {} as unknown as SqlDatabaseConnection,
  {
    apply(_target, _thisArg, args) {
      return runOnConnection(resolveRepositoryConnection(), args);
    },
    get(_target, property) {
      const connection = resolveRepositoryConnection();
      const value = (connection as unknown as Record<string | symbol, unknown>)[property];

      return typeof value === "function" ? value.bind(connection) : value;
    },
  },
);

export { repositoryConnection, resolveRepositoryConnection };
