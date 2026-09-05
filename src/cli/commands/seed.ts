import { importHiroappModule } from "../../bootstrap/dogfoodApp.ts";
import { isFixtureSchema } from "../../bootstrap/schemaTarget.ts";

async function seedCommand(): Promise<void> {
  if (isFixtureSchema()) {
    const { seedDatabase } = await import("../../db/seeders/runner");
    await seedDatabase();
    return;
  }

  await importHiroappModule("src/db/seed.ts");
}

export { seedCommand };
