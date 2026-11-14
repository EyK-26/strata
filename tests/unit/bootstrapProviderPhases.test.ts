import { expect, test } from "bun:test";
import { createApplicationContext } from "@getstrata/bootstrap/context";
import type { ServiceProvider } from "@getstrata/bootstrap/contracts";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import { defineProvider } from "@getstrata/core/runtime/application";

function dependencies(): ServiceProvider {
  return {
    name: "fixture.dependencies",
    register({ dependencies }) {
      dependencies.cache = new CacheRepository(new SimpleCacheStore(new SimpleCache(1000, 10)));
      dependencies.storage = {
        async put(path) {
          return path;
        },
        async get() {
          return null;
        },
        async delete() {},
      };
    },
  };
}

test("canonical and legacy providers finish their phases before route assembly and transports", async () => {
  const trace: string[] = [];
  let ready = false;
  const owner = createApplicationContext([dependencies()], {
    connection: "main",
    definition: {
      providers: [
        defineProvider({
          name: "fixture.canonical",
          setup() {
            trace.push("canonical.setup");
          },
          async boot() {
            await Promise.resolve();
            ready = true;
            trace.push("canonical.boot");
          },
        }),
      ],
      transports: [
        {
          name: "fixture.http",
          setup() {
            trace.push("transport.setup");
          },
        },
      ],
    },
    providersFromScope: () => [
      {
        name: "fixture.module",
        register() {
          trace.push("legacy.register");
        },
        boot() {
          expect(ready).toBe(true);
          trace.push("legacy.boot", "routes");
        },
      },
    ],
  });
  const context = await owner.start();
  expect(trace).toEqual([
    "canonical.setup",
    "legacy.register",
    "canonical.boot",
    "legacy.boot",
    "routes",
    "transport.setup",
  ]);
  await context.dispose();
});

test("a canonical boot failure closes registered legacy and canonical resources before transport admission", async () => {
  const trace: string[] = [];
  const failure = new Error("canonical boot failed");
  const owner = createApplicationContext(
    [
      dependencies(),
      {
        name: "fixture.legacy",
        register({ onCleanup }) {
          trace.push("legacy.register");
          onCleanup(() => {
            trace.push("legacy.close");
          });
        },
        boot() {
          trace.push("legacy.boot");
        },
      },
    ],
    {
      connection: "main",
      definition: {
        providers: [
          defineProvider({
            name: "fixture.canonical",
            async setup(scope) {
              await scope.acquire({
                name: "fixture.resource",
                open: () => ({ ok: true, value: {} }),
                close() {
                  trace.push("canonical.close");
                },
              });
            },
            boot() {
              throw failure;
            },
          }),
        ],
        transports: [
          {
            name: "fixture.http",
            setup() {
              trace.push("transport.setup");
            },
          },
        ],
      },
    },
  );
  await expect(owner.start()).rejects.toBeDefined();
  const completion = await owner.application.completion;
  expect(completion.successful).toBe(true);
  expect(completion.snapshot.boot).toBe("failed");
  expect(completion.snapshot.errors.some((item) => item.error === failure)).toBe(true);
  expect(trace).toEqual(["legacy.register", "legacy.close", "canonical.close"]);
  await owner.application.stop();
  expect(trace).toEqual(["legacy.register", "legacy.close", "canonical.close"]);
});

test("legacy resources stay retained when cleanup fails after a canonical boot failure", async () => {
  const cleanupFailure = new Error("legacy close failed");
  let closes = 0;
  let transportStarts = 0;
  const owner = createApplicationContext(
    [
      dependencies(),
      {
        name: "fixture.legacy",
        register({ onCleanup }) {
          onCleanup(() => {
            closes++;
            throw cleanupFailure;
          });
        },
      },
    ],
    {
      connection: "main",
      definition: {
        providers: [
          defineProvider({
            name: "fixture.canonical",
            boot() {
              throw new Error("boot failed");
            },
          }),
        ],
        transports: [
          {
            name: "fixture.http",
            setup() {
              transportStarts++;
            },
          },
        ],
      },
    },
  );
  await expect(owner.start()).rejects.toBeDefined();
  const completion = await owner.application.completion;
  expect(completion.successful).toBe(false);
  expect(completion.snapshot.cleanup).toBe("failed");
  expect(completion.snapshot.retainedResources).toContain("bootstrap.providers");
  expect(
    completion.snapshot.errors.some(
      (item) =>
        item.kind === "cleanup" &&
        item.error instanceof AggregateError &&
        item.error.errors.includes(cleanupFailure),
    ),
  ).toBe(true);
  expect(transportStarts).toBe(0);
  await owner.application.stop();
  expect(closes).toBe(1);
});
