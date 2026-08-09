import type { DatabaseConnection } from "./baseRepository";
import { bindDatabaseConnection as setBoundConnection } from "./boundConnection";

function bindDatabaseConnection(connection: DatabaseConnection): void {
  setBoundConnection(connection);
}

export { bindDatabaseConnection };
