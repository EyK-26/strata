import { importHiroappModule } from "../../bootstrap/dogfoodApp.ts";
import { isFixtureSchema } from "../../bootstrap/schemaTarget.ts";

async function rollbackCommand(): Promise<void> {
  if (isFixtureSchema()) {
    const { rollbackDatabase } = await import("../../db/migrations/runner");
    await rollbackDatabase();
    return;
  }

  await importHiroappModule("src/db/rollback.ts");
}

export { rollbackCommand };
