import db from "../../db/connection";
import type { DatabaseConnection } from "./baseRepository.ts";
import { createDatabaseConnection } from "./connection.ts";

async function runInTransaction<TValue>(
  operation: (connection: DatabaseConnection) => Promise<TValue>,
): Promise<TValue> {
  return await db.begin(async (transaction) => {
    return await operation(createDatabaseConnection(transaction));
  });
}

export { runInTransaction };
