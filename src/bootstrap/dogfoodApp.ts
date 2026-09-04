import { join } from "node:path";

type DogfoodApp = "workhub" | "hiroapp";

function readDogfoodApp(): DogfoodApp {
  const value = (process.env.DOGFOOD_APP ?? "hiroapp").trim().toLowerCase();
  return value === "workhub" ? "workhub" : "hiroapp";
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
