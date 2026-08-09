import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadSeedersFromDirectory,
  runSeedersFromDirectory,
} from "../../src/core/database/seeders/runner.ts";
import type { SeederDatabase } from "../../src/core/database/seeders/types.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createSeederDirectory(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "strata-seeders-"));
  tempDirs.push(dir);
  return dir;
}

describe("seeders runner", () => {
  test("returns zero when a directory has no seeders", async () => {
    const dir = await createSeederDirectory();
    const db = { unsafe: async () => [] } satisfies SeederDatabase;

    expect(await runSeedersFromDirectory(dir, db)).toBe(0);
    expect(await loadSeedersFromDirectory(dir)).toEqual([]);
  });

  test("loads and runs seeders in sorted order", async () => {
    const dir = await createSeederDirectory();
    const db = { unsafe: async () => [] } satisfies SeederDatabase;
    const seeded: string[] = [];
    const onSeeder = (name: string) => seeded.push(name);

    await writeFile(
      join(dir, "002_second.ts"),
      `export default { name: "second", async run() {} };`,
    );
    await writeFile(join(dir, "001_first.ts"), `export default { name: "first", async run() {} };`);
    await writeFile(join(dir, "types.ts"), `export {};`);

    const seeders = await loadSeedersFromDirectory(dir);

    expect(seeders.map((seeder) => seeder.name)).toEqual(["first", "second"]);

    const count = await runSeedersFromDirectory(dir, db, { onSeeder });

    expect(count).toBe(2);
    expect(seeded).toEqual(["first", "second"]);
  });
});
