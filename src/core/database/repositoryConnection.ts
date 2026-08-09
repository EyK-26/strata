import db from "../../db/connection";
import type { DatabaseConnection } from "./baseRepository";
import { getBoundDatabaseConnection } from "./boundConnection";

function resolveRepositoryConnection(): DatabaseConnection {
  return getBoundDatabaseConnection() ?? db;
}

const repositoryConnection = new Proxy({} as DatabaseConnection, {
  get(_target, property) {
    const connection = resolveRepositoryConnection();
    const value = (connection as unknown as Record<string | symbol, unknown>)[property];
    return typeof value === "function" ? value.bind(connection) : value;
  },
});

export { repositoryConnection, resolveRepositoryConnection };
