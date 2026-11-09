import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as BootstrapRoot from "@getstrata/bootstrap";
import * as BootstrapConfig from "@getstrata/bootstrap/config";
import { CORE_CACHE_TOKEN as bootstrapCacheToken } from "@getstrata/bootstrap/config";
import { createServiceToken as bootstrapToken } from "@getstrata/bootstrap/contracts";
import { createViewProvider as granularViewProvider } from "@getstrata/bootstrap/providers/view";
import * as Root from "@getstrata/core";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import { CORE_CACHE_TOKEN as cacheToken } from "@getstrata/core/cache/tokens";
import { configInteger, parseApplicationConfig } from "@getstrata/core/config/applicationConfig";
import * as Container from "@getstrata/core/contracts/container";
import * as Services from "@getstrata/core/contracts/services";
import * as ServiceTokens from "@getstrata/core/contracts/serviceTokens";
import { CORE_CACHE_TOKEN as serviceToken } from "@getstrata/core/contracts/serviceTokens";
import * as Tokens from "@getstrata/core/contracts/token";
import { createApplication } from "@getstrata/core/runtime/application";
import * as Views from "@getstrata/core/view";

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

// Compare every built-in constant on every SUPPORTED public path that exports it.
// Keep opaque identities explicit so a newly added constant cannot silently disappear.
const publicModules: Record<string, Record<string, unknown>> = {
  core: Root,
  serviceTokens: ServiceTokens,
  view: Views,
  bootstrap: BootstrapRoot,
  bootstrapConfig: BootstrapConfig,
};
const opaqueConstants = new Map<string, Array<{ path: string; value: unknown }>>();
for (const [path, module] of Object.entries(publicModules)) {
  for (const [name, value] of Object.entries(module)) {
    if (!name.endsWith("_TOKEN")) continue;
    if (name in ServiceTokens)
      assert.equal(value, Reflect.get(ServiceTokens, name), `${name} differs on ${path}`);
    if (Tokens.isServiceToken(value)) {
      const entries = opaqueConstants.get(name) ?? [];
      entries.push({ path, value });
      opaqueConstants.set(name, entries);
    }
  }
}
const expectedOpaque = [
  "CORE_CACHE_TOKEN",
  "CORE_HTTP_CLEANUP_TOKEN",
  "CORE_PUBLIC_TENANCY_TOKEN",
  "CORE_TENANT_RESOLVER_TOKEN",
  "CORE_THROTTLE_QUOTA_POLICY_TOKEN",
  "CORE_VIEW_RENDERER_TOKEN",
];
for (const name of expectedOpaque)
  assert.ok(opaqueConstants.has(name), `${name} missing from public inventory`);
for (const [name, entries] of opaqueConstants) {
  assert.ok(entries.length >= 2, `${name} needs a real cross-path identity comparison`);
  for (const entry of entries)
    assert.equal(entry.value, entries[0]?.value, `${name} differs on ${entry.path}`);
}

const viewsDirectory = await mkdtemp(join(process.cwd(), "owned-view-identity-"));
let viewProvidersResolved = 0;
try {
  await writeFile(join(viewsDirectory, "identity.eta"), "<p><%= it.label %></p>");
  for (const create of [granularViewProvider]) {
    const container = new Container.ServiceContainer();
    const config = new Container.ConfigStore();
    const provider = create({
      enabled: true,
      directory: viewsDirectory,
      layout: false,
      data: { loadUser: async () => null },
    });
    await provider.register?.({ container, config, dependencies: { container }, onCleanup() {} });
    const renderer = container.resolve(Root.CORE_VIEW_RENDERER_TOKEN);
    assert.equal(container.resolve(Views.CORE_VIEW_RENDERER_TOKEN), renderer);
    assert.equal(
      await (await renderer.render("identity", { label: "provider-token-identity" })).text(),
      "<p>provider-token-identity</p>",
    );
    viewProvidersResolved++;
  }
  // New canonical paths are compared when advertised; old archives do not invent APIs.
  const manifest = await Bun.file(
    join(process.cwd(), "node_modules/@getstrata/core/package.json"),
  ).json();
  if (manifest.exports?.["./view/tokens"]) {
    const entry = "@getstrata/core/view/tokens";
    const canonical = await import(entry);
    assert.equal(canonical.CORE_VIEW_RENDERER_TOKEN, Root.CORE_VIEW_RENDERER_TOKEN);
  }
} finally {
  await rm(viewsDirectory, { recursive: true, force: true });
}

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
      opaqueConstants: [...opaqueConstants.keys()].sort(),
      serviceConstants: Object.keys(ServiceTokens)
        .filter((name) => name.endsWith("_TOKEN"))
        .sort(),
      viewProvidersResolved,
      resolved: 49,
      expiredResolver: true,
      paths,
    }),
  );
} finally {
  await app.stop();
  await cache.close();
}
