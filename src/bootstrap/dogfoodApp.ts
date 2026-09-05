import { join } from "node:path";

type DogfoodApp = "hiroapp";

function readDogfoodApp(): DogfoodApp {
  return "hiroapp";
}

function isHiroappDogfood(): boolean {
  return true;
}

function hiroappSourcePath(...segments: string[]): string {
  return join(import.meta.dir, "../../apps/hiroapp", ...segments);
}

async function importHiroappModule<T = unknown>(relativeFromApp: string): Promise<T> {
  return (await import(hiroappSourcePath(relativeFromApp))) as T;
}

export type { DogfoodApp };
export { hiroappSourcePath, importHiroappModule, isHiroappDogfood, readDogfoodApp };
