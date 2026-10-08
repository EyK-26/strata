import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

interface InfrastructureDiscoveryOptions {
  directory?: string;
  /** Relative paths or basenames; exclusions apply before importing. */
  exclude?: readonly string[];
}

async function infrastructureFiles(
  directory: string,
  exclude: readonly string[] = [],
): Promise<string[]> {
  const excluded = new Set([
    "index.ts",
    "index.js",
    "index.mts",
    "index.mjs",
    "register.ts",
    "register.js",
    "register.mts",
    "register.mjs",
    ...exclude,
  ]);
  const files: string[] = [];
  async function visit(path: string): Promise<void> {
    const entries = await readdir(path, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const file = join(path, entry.name);
      const key = relative(directory, file).replaceAll("\\", "/");
      if (excluded.has(entry.name) || excluded.has(key)) continue;
      if (entry.isDirectory()) await visit(file);
      else if (
        entry.isFile() &&
        /\.(ts|js|mts|mjs)$/.test(entry.name) &&
        !/\.(d|test|spec)\.[cm]?[jt]s$/.test(entry.name)
      )
        files.push(file);
    }
  }
  try {
    await visit(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // Only an absent root is optional; a disappearing nested file is a startup failure.
    if ((error as NodeJS.ErrnoException).path !== directory) throw error;
  }
  return files;
}

async function importInfrastructure(file: string): Promise<Record<string, unknown>> {
  try {
    return await import(pathToFileURL(file).href);
  } catch (error) {
    throw new Error(`Cannot load infrastructure module ${file}`, { cause: error });
  }
}

export type { InfrastructureDiscoveryOptions };
export { importInfrastructure, infrastructureFiles };
