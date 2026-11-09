import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { CORE_CACHE_TOKEN as bootstrapCacheToken } from "@getstrata/bootstrap/config";
import { createServiceToken as bootstrapToken } from "@getstrata/bootstrap/contracts";
import * as Root from "@getstrata/core";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import { CORE_CACHE_TOKEN as cacheToken } from "@getstrata/core/cache/tokens";
import { configInteger, parseApplicationConfig } from "@getstrata/core/config/applicationConfig";
import * as Container from "@getstrata/core/contracts/container";
import * as Services from "@getstrata/core/contracts/services";
import { CORE_CACHE_TOKEN as serviceToken } from "@getstrata/core/contracts/serviceTokens";
import * as Tokens from "@getstrata/core/contracts/token";
import { createApplication } from "@getstrata/core/runtime/application";

assert.equal(Root.createServiceToken, Tokens.createServiceToken);
assert.equal(Container.createServiceToken, Tokens.createServiceToken);
assert.equal(bootstrapToken, Tokens.createServiceToken);
assert.equal(Root.ServiceContainer, Container.ServiceContainer);
assert.equal(Root.service, Services.service);
assert.equal(Root.valueService, Services.valueService);
assert.equal(Root.aliasService, Services.aliasService);
for (const token of [Root.CORE_CACHE_TOKEN, serviceToken, bootstrapCacheToken])
  assert.equal(token, cacheToken);
assert.equal(Tokens.isServiceToken(cacheToken), true);

const paths = [];
for (const entry of [
  "@getstrata/core",
  "@getstrata/core/contracts/token",
  "@getstrata/core/contracts/services",
  "@getstrata/core/cache/tokens",
  "@getstrata/bootstrap/contracts",
  "@getstrata/bootstrap/config",
]) {
  const resolved = await realpath(new URL(import.meta.resolve(entry)));
  assert.ok(
    resolved.startsWith(`${process.cwd()}/node_modules/@getstrata/`),
    `Public entry resolved outside installed archives: ${resolved}`,
  );
  paths.push(resolved);
}
assert.equal(
  await realpath(join(process.cwd(), "node_modules/@getstrata/core")),
  join(process.cwd(), "node_modules/@getstrata/core"),
);
const first = Root.createServiceToken<number>("same-label");
const second = bootstrapToken<number>("same-label");
const Alias = Tokens.createServiceToken<number>("alias");
const Result = Tokens.createServiceToken<number>("result");
const settings = parseApplicationConfig(
  { PORT: { required: true, integer: true } },
  { PORT: "42" },
  (input) => ({ port: configInteger("PORT", input.PORT) }),
);
const Settings = Tokens.createServiceToken<typeof settings>("settings");
const cache = new Root.CacheRepository(new SimpleCacheStore(new SimpleCache()));
const app = createApplication({
  providers: [],
  services: [
    Root.valueService(first, 1),
    Services.valueService(second, 2),
    Services.valueService(Settings, settings),
    Root.aliasService(Alias, first),
    Services.valueService(cacheToken, cache),
    Root.service(Result, {
      lifetime: "application",
      dependencies: [Alias, second, Settings],
      create: (a, b, config) => a + b + config.port,
    }),
  ],
  overrides: [Services.valueService(first, 5)],
});
let saved: Parameters<Parameters<typeof app.run>[0]>[0] | undefined;
try {
  await app.start();
  await app.run(async (scope) => {
    saved = scope;
    assert.equal(scope.resolve(Alias), 5);
    assert.equal(scope.resolve(second), 2);
    assert.equal(scope.resolve(Result), 49);
    assert.equal(scope.resolve(Root.CORE_CACHE_TOKEN), cache);
    assert.equal(scope.resolve(bootstrapCacheToken), cache);
    assert.equal(await scope.resolve(serviceToken).remember("identity", async () => 7), 7);
  });
  assert.throws(() => saved?.resolve(Result));
  assert.equal((await app.stop()).successful, true);
  console.log(
    JSON.stringify({
      mixedFactoryIdentity: true,
      mixedCacheIdentity: true,
      resolved: 49,
      expiredResolver: true,
      paths,
    }),
  );
} finally {
  await app.stop();
  await cache.close();
}
