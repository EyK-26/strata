import type { DatabaseConnection } from "./baseRepository";

const BOUND_CONNECTION_KEY = Symbol.for("@getstrata/boundDatabaseConnection");

type BoundConnectionState = {
  connection: DatabaseConnection | null;
};

function boundConnectionState(): BoundConnectionState {
  const globalRecord = globalThis as Record<symbol, BoundConnectionState | undefined>;
  const existing = globalRecord[BOUND_CONNECTION_KEY];
  if (existing) {
    return existing;
  }

  const created: BoundConnectionState = { connection: null };
  globalRecord[BOUND_CONNECTION_KEY] = created;
  return created;
}

function bindDatabaseConnection(connection: DatabaseConnection): void {
  boundConnectionState().connection = connection;
}

function getBoundDatabaseConnection(): DatabaseConnection | null {
  return boundConnectionState().connection;
}

function resetBoundDatabaseConnection(): void {
  boundConnectionState().connection = null;
}

export { bindDatabaseConnection, getBoundDatabaseConnection, resetBoundDatabaseConnection };
