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

test("event helper subscribes only during application lifetime and releases on stop", async () => {
  const { defineEventListener } = await import("../../src/bootstrap/discoverListeners");
  const { EventBus } = await import("@getstrata/core/events");
  const { APPLICATION_EVENT_BUS_TOKEN } = await import("../../src/bootstrap/providers/events");
  const { valueService } = await import("@getstrata/core/contracts/services");
  const { createApplication } = await import("@getstrata/core/runtime/application");
  const bus = new EventBus();
  const seen: unknown[] = [];
  const declarations = defineEventListener("order.paid", (payload) => {
    seen.push(payload);
  });
  const app = createApplication({
    providers: [],
    services: [valueService(APPLICATION_EVENT_BUS_TOKEN, bus), ...declarations.services],
  });
  await bus.emit("order.paid", 1);
  expect(seen).toEqual([]);
  await app.start();
  await bus.emit("order.paid", 2);
  expect(seen).toEqual([2]);
  await app.stop();
  await bus.emit("order.paid", 3);
  expect(seen).toEqual([2]);
});
