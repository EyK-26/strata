import { importHiroappModule, readDogfoodApp } from "../../bootstrap/dogfoodApp.ts";

async function migrateFreshCommand(...args: string[]): Promise<void> {
  const shouldSeed = args.includes("--seed");
  const unknownArgs = args.filter((arg) => arg !== "--seed");

  if (unknownArgs.length > 0) {
    throw new Error(
      `Unknown arguments for migrate:fresh: ${unknownArgs.join(", ")}. Supported: --seed`,
    );
  }

  if (readDogfoodApp() === "hiroapp") {
    await importHiroappModule("src/db/fresh.ts");
    if (shouldSeed) {
      await importHiroappModule("src/db/seed.ts");
    }
    return;
  }

  const { freshDatabase } = await import("../../db/migrations/runner");
  await freshDatabase({ seed: shouldSeed });
}

export { migrateFreshCommand };
