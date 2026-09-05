import { importHiroappModule } from "../../bootstrap/dogfoodApp.ts";
import { isFixtureSchema } from "../../bootstrap/schemaTarget.ts";

async function migrateFreshCommand(...args: string[]): Promise<void> {
  const shouldSeed = args.includes("--seed");
  const unknownArgs = args.filter((arg) => arg !== "--seed");

  if (unknownArgs.length > 0) {
    throw new Error(
      `Unknown arguments for migrate:fresh: ${unknownArgs.join(", ")}. Supported: --seed`,
    );
  }

  if (isFixtureSchema()) {
    const { freshDatabase } = await import("../../db/migrations/runner");
    await freshDatabase({ seed: shouldSeed });
    return;
  }

  const fresh = await importHiroappModule<{ fresh?: () => Promise<void> }>("src/db/fresh.ts");
  if (typeof fresh.fresh === "function") {
    await fresh.fresh();
  }
  if (shouldSeed) {
    const seeded = await importHiroappModule<{ seed?: () => Promise<void> }>("src/db/seed.ts");
    if (typeof seeded.seed === "function") {
      await seeded.seed();
    }
  }
}

export { migrateFreshCommand };
