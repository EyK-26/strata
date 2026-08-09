import { importHiroappModule } from "../../bootstrap/dogfoodApp.ts";
import { isFixtureSchema } from "../../bootstrap/schemaTarget.ts";

async function seedCommand(): Promise<void> {
  if (isFixtureSchema()) {
    const { seedDatabase } = await import("../../db/seeders/runner");
    await seedDatabase();
    return;
  }

  const mod = await importHiroappModule<{ seed?: () => Promise<void> }>("src/db/seed.ts");
  if (typeof mod.seed === "function") {
    await mod.seed();
  }
}

export { seedCommand };
