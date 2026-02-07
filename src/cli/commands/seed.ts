import { seedDatabase } from "../../db/seeders/runner";

async function seedCommand(): Promise<void> {
  await seedDatabase();
}

export { seedCommand };
