import { rollbackDatabase } from "../../db/migrations/runner";

async function rollbackCommand(): Promise<void> {
  await rollbackDatabase();
}

export { rollbackCommand };
