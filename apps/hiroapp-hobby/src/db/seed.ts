import { close, seed } from "./migrate.ts";

export { seed };

if (import.meta.main) {
  try {
    await seed();
    console.log("Demo database seeded.");
  } finally {
    await close();
  }
}
