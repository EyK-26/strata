import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import * as Bootstrap from "@getstrata/bootstrap";
import { createCachedJson } from "@getstrata/bootstrap/cachedJson";
import { createCacheBindings } from "@getstrata/bootstrap/providers/cache";
import * as Core from "@getstrata/core";
import { createCacheStore } from "@getstrata/core/cache/createCacheStore";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { CORE_CACHE_TOKEN } from "@getstrata/core/cache/tokens";
import { CORE_EXECUTION_OPERATIONS_TOKEN } from "@getstrata/core/contracts/executionOperations";
import { createApplication } from "@getstrata/core/runtime/application";

assert.equal(Core.CORE_EXECUTION_OPERATIONS_TOKEN, CORE_EXECUTION_OPERATIONS_TOKEN);
assert.equal(Core.CORE_CACHE_TOKEN, CORE_CACHE_TOKEN);
assert.equal("CORE_CACHE_BACKEND_TOKEN" in Bootstrap, false);
const paths = [];
for (const entry of [
  "@getstrata/core",
  "@getstrata/core/contracts/executionOperations",
  "@getstrata/core/cache/tokens",
  "@getstrata/bootstrap",
  "@getstrata/bootstrap/providers/cache",
  "@getstrata/bootstrap/cachedJson",
]) {
  const path = await realpath(new URL(import.meta.resolve(entry)));
  assert.ok(path.startsWith(`${process.cwd()}/node_modules/@getstrata/`), path);
  paths.push(path);
}
// Constructing unused Redis declarations must not require a reachable Redis server.
const unused = createCacheBindings({
  driver: "redis",
  namespace: "packed:unused:",
  redisUrl: "redis://127.0.0.1:1",
  ttlMs: 1000,
  maxEntries: 10,
});
assert.ok(Object.isFrozen(unused));
assert.ok(unused.every(Object.isFrozen));

let release!: () => void;
let entered!: () => void;
const gate = new Promise<void>((resolve) => {
  release = resolve;
});
const started = new Promise<void>((resolve) => {
  entered = resolve;
});
const events: string[] = [];
const Resource = Core.createServiceToken<object>("packed loader resource");
const app = createApplication({
  providers: [],
  services: [
    ...Bootstrap.createCacheBindings({
      driver: "array",
      namespace: "packed:actual:",
      ttlMs: 60000,
      maxEntries: 10,
    }),
    Core.resourceService(Resource, {
      lifetime: "execution",
      dependencies: [],
      create: () => ({
        name: "packed loader resource",
        open: () => {
          events.push("open");
          return { ok: true, value: {} };
        },
        close: () => {
          events.push("close");
        },
      }),
    }),
  ],
});
let settled = false;
let nested: unknown;
let run: Promise<unknown> | undefined;
try {
  await app.start();
  run = app
    .run((scope) => {
      scope.resolve(Resource);
      const cache = scope.resolve(CORE_CACHE_TOKEN);
      const operations = scope.resolve(CORE_EXECUTION_OPERATIONS_TOKEN);
      operations.assertActive();
      void cache.remember("actual", async () => {
        events.push("loader");
        entered();
        await gate;
        nested = await cache.remember("nested", async () => 19);
        return 23;
      });
    })
    .then((value) => {
      settled = true;
      return value;
    });
  await started;
  assert.equal(settled, false);
  assert.deepEqual(events, ["open", "loader"]);
  release();
  await run;
  assert.equal(nested, 19);
  assert.deepEqual(events, ["open", "loader", "close"]);
} finally {
  release();
  await run;
  await app.stop();
}

const fake = new CacheRepository(
  createCacheStore({ driver: "array", namespace: "packed:fake:", ttlMs: 60000, maxEntries: 10 }),
);
let fakeCalls = 0;
const remember = fake.remember.bind(fake);
fake.remember = (key, loader, ttl) => {
  fakeCalls++;
  return remember(key, loader, ttl);
};
const override = createApplication({
  providers: [],
  services: createCacheBindings({
    driver: "array",
    namespace: "packed:override:",
    ttlMs: 60000,
    maxEntries: 10,
  }),
  overrides: [Core.valueService(CORE_CACHE_TOKEN, fake)],
});
let identity = false;
let responses: Response[] = [];
let loads = 0;
try {
  await override.start();
  await override.run(async (scope) => {
    const cache = scope.resolve(CORE_CACHE_TOKEN);
    identity = cache === fake;
    const policy = { etagEnabled: true };
    const json = createCachedJson(cache, policy);
    policy.etagEnabled = false;
    const first = await json(
      "json",
      async () => {
        loads++;
        return { answer: 42 };
      },
      [],
      new Request("http://packed.test"),
    );
    const second = await json(
      "json",
      async () => {
        loads++;
        return { answer: 0 };
      },
      [],
      new Request("http://packed.test", {
        headers: { "If-None-Match": first.headers.get("etag") ?? "missing" },
      }),
    );
    const disabled = await Bootstrap.createCachedJson(cache, { etagEnabled: false })(
      "json",
      async () => ({}),
      [],
      new Request("http://packed.test"),
    );
    responses = [first, second, disabled];
  });
  assert.equal(identity, true);
  assert.equal(fakeCalls, 3, "installed helper must invoke actual overridden cache");
  assert.equal(loads, 1);
  assert.equal(responses[0]?.status, 200);
  assert.ok(responses[0]?.headers.get("etag"));
  assert.equal(responses[0]?.headers.get("cache-control"), "private, must-revalidate");
  assert.match(responses[0]?.headers.get("vary") ?? "", /Authorization/i);
  assert.match(responses[0]?.headers.get("vary") ?? "", /X-Tenant-Id/i);
  assert.equal(responses[1]?.status, 304);
  assert.equal(await responses[1]?.text(), "");
  assert.equal(responses[2]?.headers.get("etag"), null);
  assert.deepEqual(await responses[0]?.json(), { answer: 42 });
} finally {
  await override.stop();
  await fake.close();
}
console.log(
  JSON.stringify({
    operationIdentity: true,
    canonicalBindings: true,
    actualLoaderJoined: true,
    fakeCalls,
    loads,
    responseStatuses: responses.map((response) => response.status),
    paths,
  }),
);
