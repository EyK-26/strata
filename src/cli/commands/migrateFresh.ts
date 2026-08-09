import { freshDatabase } from "../../db/migrations/runner";

async function migrateFreshCommand(...args: string[]): Promise<void> {
  const shouldSeed = args.includes("--seed");
  const unknownArgs = args.filter((arg) => arg !== "--seed");

  if (unknownArgs.length > 0) {
    throw new Error(
      `Unknown arguments for migrate:fresh: ${unknownArgs.join(", ")}. Supported: --seed`,
    );
  }

  await freshDatabase({ seed: shouldSeed });
}

export { migrateFreshCommand };
