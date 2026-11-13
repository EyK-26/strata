import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../..");
const tempDirectories: string[] = [];

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "strata-discover-listeners-"));
  tempDirectories.push(directory);
  return directory;
}

describe("discoverListeners", () => {
  afterEach(async () => {
    process.chdir(repoRoot);
    while (tempDirectories.length > 0) {
      const directory = tempDirectories.pop();
      if (directory) {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });

  test("returns no declarations when src/listeners is absent", async () => {
    const { discoverListeners } = await import("../../src/bootstrap/discoverListeners");
    process.chdir(await tempDir());

    const listeners = await discoverListeners();

    expect(listeners).toEqual([]);
  });

  test("loads listeners from cwd on the first discoverListeners call", async () => {
    const root = await tempDir();
    const listenersDirectory = join(root, "src", "listeners");
    await mkdir(listenersDirectory, { recursive: true });
    await writeFile(
      join(listenersDirectory, "sample.ts"),
      `export default Object.freeze({services:Object.freeze([]),repositoryEffects:Object.freeze([])});`,
    );

    process.chdir(repoRoot);
    await import("../../packages/strata-bootstrap/entries/discoverListeners.ts");

    process.chdir(root);
    const { discoverListeners } = await import("../../src/bootstrap/discoverListeners");

    const listeners = await discoverListeners();

    expect(listeners).toHaveLength(1);
    expect(listeners[0]?.services).toEqual([]);
    expect(listeners[0]?.repositoryEffects).toEqual([]);
    expect(Object.isFrozen(listeners[0])).toBe(true);
  });
});
