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
    const { resetDiscoverListenersForTests } = await import(
      "../../src/bootstrap/discoverListeners"
    );
    resetDiscoverListenersForTests();
    while (tempDirectories.length > 0) {
      const directory = tempDirectories.pop();
      if (directory) {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });

  test("returns no registrars when src/listeners is absent", async () => {
    const { discoverListeners, resetDiscoverListenersForTests } = await import(
      "../../src/bootstrap/discoverListeners"
    );
    resetDiscoverListenersForTests();

    const listeners = discoverListeners();

    expect(listeners).toEqual([]);
  });

  test("loads listeners from cwd on the first discoverListeners call", async () => {
    const root = await tempDir();
    const listenersDirectory = join(root, "src", "listeners");
    await mkdir(listenersDirectory, { recursive: true });
    await writeFile(
      join(listenersDirectory, "sample.ts"),
      `export default function registerSampleListener(): void {
  (globalThis as { sampleListenerLoaded?: boolean }).sampleListenerLoaded = true;
}
`,
    );

    process.chdir(repoRoot);
    await import("../../packages/strata-bootstrap/entries/discoverListeners.ts");

    process.chdir(root);
    const { discoverListeners, resetDiscoverListenersForTests } = await import(
      "../../src/bootstrap/discoverListeners"
    );
    resetDiscoverListenersForTests();

    const listeners = discoverListeners();

    expect(listeners).toHaveLength(1);
    const [registerSampleListener] = listeners;
    if (typeof registerSampleListener !== "function") {
      throw new Error("expected a listener registrar");
    }
    registerSampleListener();
    expect((globalThis as { sampleListenerLoaded?: boolean }).sampleListenerLoaded).toBe(true);
  });
});
