import { seed } from "./migrate.ts";

export { seed };

if (import.meta.main) {
  await seed();
  console.log("Database seeded.");
  process.exit(0);
}
