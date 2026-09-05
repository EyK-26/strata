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

  await importHiroappModule("src/db/fresh.ts");
  if (shouldSeed) {
    await importHiroappModule("src/db/seed.ts");
  }
}

export { migrateFreshCommand };
