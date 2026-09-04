import { join } from "node:path";

type DogfoodApp = "workhub" | "hiroapp";

function readDogfoodApp(): DogfoodApp {
  // Unset env stays WorkHub so CI, coverage, and `strata start` without a wrapper
  // cannot run HiroApp migrations against the WorkHub schema. `bun run dev` sets
  // DOGFOOD_APP=hiroapp explicitly (Wave 5). Use `bun run workhub:dev` for Jetstream/SCIM/RLS.
  const value = (process.env.DOGFOOD_APP ?? "workhub").trim().toLowerCase();
  return value === "hiroapp" ? "hiroapp" : "workhub";
}

function isHiroappDogfood(): boolean {
  return readDogfoodApp() === "hiroapp";
}

function hiroappSourcePath(...segments: string[]): string {
  return join(import.meta.dir, "../../apps/hiroapp", ...segments);
}

async function importHiroappModule<T = unknown>(relativeFromApp: string): Promise<T> {
  return (await import(hiroappSourcePath(relativeFromApp))) as T;
}

export type { DogfoodApp };
export { hiroappSourcePath, importHiroappModule, isHiroappDogfood, readDogfoodApp };
