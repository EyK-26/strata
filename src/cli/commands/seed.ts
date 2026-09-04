import { importHiroappModule, readDogfoodApp } from "../../bootstrap/dogfoodApp.ts";

async function seedCommand(): Promise<void> {
  if (readDogfoodApp() === "hiroapp") {
    await importHiroappModule("src/db/seed.ts");
    return;
  }

  const { seedDatabase } = await import("../../db/seeders/runner");
  await seedDatabase();
}

export { seedCommand };
