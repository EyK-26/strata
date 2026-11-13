import { expect, test } from "bun:test";
import { compileStarterFeatures } from "../../../packages/strata-starter/src/featurePlan.ts";
import { defaultLayers } from "../../../packages/strata-starter/src/presets";
import { renderCreateAppTs } from "../../../packages/strata-starter/src/renderBootstrap";
import { renderCliOutboxWorkTs } from "../../../packages/strata-starter/src/renderCli";

for (const tenancy of ["none", "column", "rls"] as const)
  test(`generated ${tenancy} outbox uses original graph preparation and a separate owned worker mode`, () => {
    const layers = {
      ...defaultLayers(),
      tenancy,
      database: tenancy === "rls" ? ("postgres" as const) : ("sqlite" as const),
    };
    const bootstrap = renderCreateAppTs(compileStarterFeatures(layers));
    expect(() => new Bun.Transpiler({ loader: "ts" }).transformSync(bootstrap)).not.toThrow();
    expect(bootstrap).toContain(
      'import { listeners as durableListeners } from "../outbox/registry.ts";',
    );
    expect(bootstrap).toContain(
      `createSqlOutboxBindings({invoke:run,connection:"main",tenancy:"${tenancy}",listeners:durableListeners})`,
    );
    expect(bootstrap).toContain("...outbox.services");
    expect(bootstrap).toContain("preparation:[outbox.token]");
    expect(bootstrap).toContain(
      'mode==="outbox-worker"?createOutboxWorkerTransport(outbox.token):undefined',
    );
    expect(bootstrap).toContain("...(outboxWorker?[outboxWorker.transport]:[])");
    expect(bootstrap).toContain("...(outboxWorker?{outboxWorker}:{})");
    expect(bootstrap.indexOf("createSqlOutboxBindings({")).toBeLessThan(
      bootstrap.indexOf("const handle=createApplicationContext"),
    );
    expect(bootstrap).toContain('if(mode==="worker"&&!env.REDIS_URL)');
    expect(bootstrap).not.toContain('if(mode==="outbox-worker"&&!env.REDIS_URL)');
    expect(bootstrap).not.toContain("new SqlOutbox");
  });

test("generated outbox command boots the owned transport without parallel disposal", () => {
  const command = renderCliOutboxWorkTs();
  expect(() => new Bun.Transpiler({ loader: "ts" }).transformSync(command)).not.toThrow();
  expect(command).toContain('boot: () => bootstrapApp({ migrate: false, mode: "outbox-worker" })');
  for (const legacy of [
    "listeners",
    "context.drain",
    "context.flush",
    "context.dispose",
    "new SqlOutbox",
  ])
    expect(command).not.toContain(legacy);
});
