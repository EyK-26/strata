import type { DatabaseConnection } from "./baseRepository";

const boundConnectionHolder: { connection: DatabaseConnection | null } = {
  connection: null,
};

function bindDatabaseConnection(connection: DatabaseConnection): void {
  boundConnectionHolder.connection = connection;
}

function getBoundDatabaseConnection(): DatabaseConnection | null {
  return boundConnectionHolder.connection;
}

function resetBoundDatabaseConnection(): void {
  boundConnectionHolder.connection = null;
}

export { bindDatabaseConnection, getBoundDatabaseConnection, resetBoundDatabaseConnection };
