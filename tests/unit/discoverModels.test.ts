import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { discoverModels } from "@getstrata/bootstrap/discoverModels";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "strata-model-discovery-"));
  directories.push(path);
  return path;
}
const modelUrl = pathToFileURL(join(import.meta.dir, "../../src/core/database/model.ts")).href;
const tableUrl = pathToFileURL(join(import.meta.dir, "../../src/core/database/table.ts")).href;
const imports = `import { defineModel } from ${JSON.stringify(modelUrl)};
import { defineTable } from ${JSON.stringify(tableUrl)};
const table = defineTable({ name: "discovered", primaryKey: "id", columns: ["id"] });`;

describe("model discovery", () => {
  test("loads nested named/default exports, deduplicates classes, and boots after all names exist", async () => {
    const path = await directory();
    await mkdir(join(path, "nested"));
    await writeFile(
      join(path, "Parent.ts"),
      `${imports}
export class DiscoveredParent extends defineModel(table) {
  static boots = 0;
  static boot() {
    this.boots++;
    this.newFromRecord({ id: 1 }).hasMany("discovered-child");
  }
}
export default DiscoveredParent;
export const notAModel = () => {};
`,
    );
    await writeFile(
      join(path, "nested/Child.ts"),
      `${imports}
export class DiscoveredChild extends defineModel(table) { static $morphClass = "discovered-child"; }
`,
    );
    // The generated caller awaits discovery; importing it again would deadlock.
    await writeFile(
      join(path, "register.ts"),
      `import { discoverModels } from ${JSON.stringify(pathToFileURL(join(import.meta.dir, "../../src/bootstrap/discoverModels.ts")).href)};
export const models = await discoverModels(import.meta.dir);
`,
    );
    await writeFile(join(path, "types.d.ts"), 'throw new Error("declarations must not execute");');
    await writeFile(join(path, "types.d.mts"), 'throw new Error("declarations must not execute");');
    await writeFile(join(path, "index.ts"), 'throw new Error("barrel must not execute");');
    await writeFile(join(path, "ignored.txt"), 'throw new Error("not JavaScript");');
    await symlink(join(path, "register.ts"), join(path, "linked.ts"));
    const loaded = await import(pathToFileURL(join(path, "register.ts")).href);
    expect(loaded.models).toHaveLength(2);
    const parent = await import(pathToFileURL(join(path, "Parent.ts")).href);
    expect(parent.DiscoveredParent.boots).toBe(1);
    await Promise.all([discoverModels(path), discoverModels(path)]);
    expect(parent.DiscoveredParent.boots).toBe(1);
    expect(parent.DiscoveredParent.repository().getTable().name).toBe("discovered");
  });

  test("defaults to the application models directory", async () => {
    const path = await directory();
    await mkdir(join(path, "src/models"), { recursive: true });
    const previous = process.cwd();
    try {
      process.chdir(path);
      expect(await discoverModels()).toEqual([]);
    } finally {
      process.chdir(previous);
    }
  });

  test("supports explicit exclusions and propagates import and missing-directory errors", async () => {
    const path = await directory();
    await writeFile(join(path, "bad.ts"), 'throw new Error("model import failed");');
    expect(await discoverModels(path, { exclude: ["bad.ts"] })).toEqual([]);
    await expect(discoverModels(path)).rejects.toThrow("model import failed");
    await expect(discoverModels(join(path, "missing"))).rejects.toThrow();
  });

  test("rejects ambiguous relationship names before running boot hooks", async () => {
    const path = await directory();
    for (const file of ["First.ts", "Second.ts"]) {
      await writeFile(
        join(path, file),
        `${imports}
export class AmbiguousModel extends defineModel(table) { static boot() { throw new Error("boot should not run"); } }
`,
      );
    }
    await expect(discoverModels(path)).rejects.toThrow("Duplicate model name [AmbiguousModel]");
  });

  test("unconfigured exported models fail startup rather than disappear silently", async () => {
    const path = await directory();
    await writeFile(
      join(path, "Legacy.ts"),
      `import { Model } from ${JSON.stringify(modelUrl)};
export class UnconfiguredModel extends Model {}`,
    );
    await expect(discoverModels(path)).rejects.toThrow(
      "UnconfiguredModel.repository() is not implemented",
    );
  });
});
