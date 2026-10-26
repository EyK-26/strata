import assert from "node:assert/strict";
import { appContext, collectProviders } from "@getstrata/bootstrap/context";
import { startGuardedApplication } from "@getstrata/bootstrap/m1";
import { routeRegistry } from "@getstrata/bootstrap/routeRegistry";

const providers = collectProviders([]).filter((provider) =>
  ["core.config", "core.cache", "core.storage", "core.auth", "core.policy"].includes(provider.name),
);
routeRegistry.clear();
routeRegistry.register({ method: "GET", path: "/previous", middleware: [] });
for (let attempt = 0; attempt < 2; attempt++) {
  const app = await startGuardedApplication({
    providers,
    modules: [{ name: "installed", routes: () => ({ "/context": () => new Response("ok") }) }],
  });
  try {
    assert.ok(app.server.port, "Native listener must be bound.");
    assert.equal(
      appContext.container,
      app.context.container,
      "M1 must use the existing public context owner.",
    );
    assert.equal(appContext.config, app.context.config);
    assert.equal(appContext.dependencies, app.context.dependencies);
    assert.ok(routeRegistry.list().some((route) => route.path === "/context"));
  } finally {
    assert.equal((await app.shutdown()).successful, true);
    await app.server.stop(true);
  }
  assert.throws(() => appContext.container, /not ready/);
  assert.deepEqual(routeRegistry.list(), [{ method: "GET", path: "/previous", middleware: [] }]);
}
console.log(
  "Installed M1 public context identity, disposal, corrected restart and metadata restoration passed.",
);
