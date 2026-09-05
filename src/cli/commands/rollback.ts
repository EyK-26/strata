import { importHiroappModule } from "../../bootstrap/dogfoodApp.ts";
import { isFixtureSchema } from "../../bootstrap/schemaTarget.ts";

async function rollbackCommand(): Promise<void> {
  if (isFixtureSchema()) {
    const { rollbackDatabase } = await import("../../db/migrations/runner");
    await rollbackDatabase();
    return;
  }

  const mod = await importHiroappModule<{ rollback?: () => Promise<void> }>("src/db/rollback.ts");
  if (typeof mod.rollback === "function") {
    await mod.rollback();
  }
}

export { rollbackCommand };
