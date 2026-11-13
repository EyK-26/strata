import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type AnyModelDefinition, assertDefinition } from "@getstrata/core/database/definitions";

/** Import trusted application model modules, then collect their immutable exported definitions. */
interface DiscoverModelsOptions {
  /** Startup orchestration files are not model modules; avoids importing the awaiting caller. */
  exclude?: readonly string[];
}

async function discoverModels(
  directory = join(process.cwd(), "src", "models"),
  options: DiscoverModelsOptions = {},
): Promise<AnyModelDefinition[]> {
  const excluded = new Set([
    "register.ts",
    "register.js",
    "index.ts",
    "index.js",
    ...(options.exclude ?? []),
  ]);
  const models = new Set<AnyModelDefinition>();
  async function visit(path: string): Promise<void> {
    const entries = await readdir(path, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (
        !excluded.has(entry.name) &&
        entry.isFile() &&
        /\.(ts|js|mts|mjs)$/.test(entry.name) &&
        !/\.d\.[cm]?ts$/.test(entry.name)
      ) {
        const exports = await import(pathToFileURL(file).href);
        for (const value of Object.values(exports)) {
          if (
            value &&
            typeof value === "object" &&
            Object.getOwnPropertyDescriptor(value, "kind")?.value === "model"
          ) {
            assertDefinition(value, "model");
            models.add(value);
          }
        }
      }
    }
  }
  await visit(directory);
  const result = [...models];
  return result;
}

export type { DiscoverModelsOptions };
export { discoverModels };
