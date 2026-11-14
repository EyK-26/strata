import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { createOutboxMigration } from "@getstrata/core/events/outbox";
import { compileStarterFeatures } from "../../../packages/strata-starter/src/featurePlan.ts";
import { defaultLayers } from "../../../packages/strata-starter/src/presets";
import {
  renderConfigTs,
  renderCreateAppTs,
} from "../../../packages/strata-starter/src/renderBootstrap";
import {
  type ApplicationAuthServices,
  type BootstrappedApp,
  defineApp,
} from "../../../src/bootstrap/application";
import { withMigrationDatabase } from "../../../src/bootstrap/databaseCommands";

for (const tenancy of ["none", "column", "rls"] as const)
  test(`generated ${tenancy} outbox delegates ownership with explicit tenancy and listeners`, () => {
    const plan = compileStarterFeatures({
      ...defaultLayers(),
      tenancy,
      database: tenancy === "rls" ? "postgres" : "sqlite",
    });
    const bootstrap = renderCreateAppTs(plan);
    expect(() => new Bun.Transpiler({ loader: "ts" }).transformSync(bootstrap)).not.toThrow();
    expect(bootstrap).toContain('import { listeners } from "../outbox/registry.ts";');
    expect(bootstrap).toContain('from "@getstrata/bootstrap/application"');
    expect(bootstrap).toContain("outbox: { listeners }");
    expect(renderConfigTs(plan, "outbox-app")).toContain(`"tenancy": "${tenancy}"`);
    expect(bootstrap).not.toContain("new SqlOutbox");
  });

test("packaged outbox keeps its original application transaction and worker shutdown owner", async () => {
  const previous = { ...process.env };
  const directory = await mkdtemp(join(tmpdir(), "strata-outbox-assembly-"));
  const apps: BootstrappedApp[] = [];
  try {
    for (const key of [
      "DATABASE_URL",
      "APP_DATABASE_URL",
      "MIGRATION_DATABASE_URL",
      "FRONTEND_MODE",
      "TENANCY_DRIVER",
      "REDIS_URL",
    ])
      delete process.env[key];
    Object.assign(process.env, {
      APP_ENV: "local",
      NODE_ENV: "test",
      CACHE_DRIVER: "array",
      QUEUE_DRIVER: "sync",
    });
    for (let index = 0; index < 2; index++) {
      const connection = {
        driver: "sqlite" as const,
        filename: join(directory, `${index}.sqlite`),
      };
      const factory = defineApp({
        root: directory,
        database: () => connection,
        models: [],
        repositories: [],
        tenancy: "none",
        frontend: "api",
        defaults: { DATABASE_URL: `sqlite:${connection.filename}` },
        outbox: {
          listeners: [
            { name: "example-listener", event: "example.created", handle: async () => {} },
          ],
        },
        migrate: () =>
          withMigrationDatabase(connection, (db) =>
            createOutboxMigration("outbox", "sqlite").up(db),
          ),
        auth: {
          token: createServiceToken<ApplicationAuthServices>(`auth-${index}`),
          create: () => ({
            metadata: () => ({
              authenticate: async () =>
                ({ status: "absent", user: null, credentialSource: null }) as const,
              memberships: async () => [],
              userTenantId: async () => 1,
              tenant: async () => null,
            }),
            config: {
              signatureSecret: "fixture-secret",
              sessionCookie: { cookieName: "fixture", production: false },
              passwordConfirmation: {
                secret: "fixture-secret",
                cookieName: "confirm",
                ttlSeconds: 60,
              },
            },
          }),
        },
      });
      apps.push(
        await factory.bootstrapApp({
          migrate: true,
          ...(index === 0 ? { mode: "outbox-worker" as const } : {}),
        }),
      );
    }
    const [first, second] = apps;
    if (!first?.outboxWorker || !second) throw new Error("Missing original applications.");
    await first.invoke(
      { kind: "command", actor: { kind: "system", policy: "test.publish" } },
      ({ database }) =>
        database.transaction((tx) =>
          first.outbox.publish(tx, "example.created", { id: 1 }, { tenantId: null }),
        ),
    );
    await expect(
      second.invoke(
        { kind: "command", actor: { kind: "system", policy: "test.cross-owner" } },
        ({ database }) =>
          database.transaction((tx) =>
            first.outbox.publish(tx, "example.created", { id: 2 }, { tenantId: null }),
          ),
      ),
    ).rejects.toThrow();
    expect(second.outboxWorker).toBeUndefined();
    const running = first.outboxWorker.start();
    const stopped = await first.application.stop();
    expect(stopped).toMatchObject({ successful: true });
    await running;
    await first.outboxWorker.completion;
  } finally {
    for (const app of apps) await app.application.stop();
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    await rm(directory, { recursive: true, force: true });
  }
});
