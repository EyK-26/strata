import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPersistenceInvocation } from "@getstrata/bootstrap/persistenceInvocation";
import { runOutboxWorkerCommand } from "@getstrata/cli/outboxWorker";
import type { ResourceSpec } from "@getstrata/core/contracts/application";
import { resourceService } from "@getstrata/core/contracts/services";
import type { ServiceToken } from "@getstrata/core/contracts/token";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import type { RawPool } from "@getstrata/core/database/driverPorts";
import {
  createOutboxMigration,
  createOutboxWorkerTransport,
  createSqlOutboxBindings,
} from "@getstrata/core/events/outbox";
import { createApplication } from "@getstrata/core/runtime/application";
import { currentTenant } from "@getstrata/core/tenant/tenantContext";

if (process.argv.includes("--boot-failure")) {
  const failure = new Error("native boot failure after SIGTERM");
  await runOutboxWorkerCommand({
    boot: () =>
      new Promise<never>((_resolve, reject) => {
        process.once("SIGTERM", () => reject(failure));
        console.log("BOOTING");
      }),
  });
  throw new Error("Rejected boot unexpectedly completed");
}

const directory = await mkdtemp(join(tmpdir(), "strata-outbox-sigterm-"));
const filename = join(directory, "outbox.sqlite");
const tenant = { id: 42, slug: "configured", metadata: { plan: "custom", region: "test" } };
let settled = false;
let app!: ReturnType<typeof createApplication>;
const bindings = createSqlOutboxBindings({
  invoke: (input, work) => createPersistenceInvocation(app, "main")(input, work),
  connection: "main",
  tenancy: "column",
  leaseMs: 500,
  resolveTenant: async () => tenant,
  listeners: [
    {
      name: "shutdown-regression",
      event: "test.created",
      async handle(_event, { signal, database }) {
        if (JSON.stringify(currentTenant()) !== JSON.stringify(tenant))
          throw new Error("Configured tenant resolver must be preserved");
        await database.execute({ text: "SELECT 1", params: [] });
        console.log("ACTIVE");
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        await Bun.sleep(30);
        settled = true;
        console.log("FINISHED");
      },
    },
  ],
});
const worker = createOutboxWorkerTransport(bindings.token);
const database = createDatabaseBindings({
  default: "main",
  connections: { main: { driver: "sqlite", filename } },
  preparation: [bindings.token],
});
const pool = database.find((declaration) => declaration.kind === "resource");
if (pool?.kind !== "resource") throw new Error("Missing native pool");
app = createApplication({
  services: [...bindings.services, ...database],
  transports: [worker.transport],
  providers: [
    {
      name: "shutdown-observer",
      async setup(scope) {
        await scope.acquire({
          name: "shutdown-observer",
          open: () => ({ ok: true, value: {} }),
          drain: () => {
            if (!settled)
              throw new Error("Infrastructure drained before actual listener settlement");
            const inspection = new Database(filename, { readonly: true });
            try {
              const row = inspection.query("SELECT status FROM strata_outbox_delivery").get() as {
                status: string;
              };
              if (row.status !== "processing")
                throw new Error("Aborted delivery must retain its recoverable lease");
            } finally {
              inspection.close();
            }
            console.log("DRAINED");
          },
          flush: () => {
            console.log("FLUSHED");
          },
          close: () => {},
        });
      },
    },
  ],
  overrides: [
    resourceService(pool.token as ServiceToken<RawPool>, {
      lifetime: "application",
      dependencies: pool.dependencies,
      create: (...dependencies) => {
        const resource = pool.create(...(dependencies as never[])) as ResourceSpec<RawPool>;
        return {
          ...resource,
          async open(signal) {
            const opened = await resource.open(signal);
            if (!opened.ok) return opened;
            const native = opened.value;
            return {
              ok: true,
              value: {
                ...native,
                async close() {
                  await native.close();
                  await rm(directory, { recursive: true, force: true });
                  console.log("CLOSED");
                },
              },
            };
          },
        };
      },
    }),
  ],
});
await runOutboxWorkerCommand({
  boot: async () => {
    await app.start();
    const invoke = createPersistenceInvocation(app, "main");
    const outbox = await app.run((scope) => scope.resolve(bindings.token));
    await invoke({ kind: "command", tenant }, async ({ database }) => {
      await createOutboxMigration("outbox", "sqlite").up({
        unsafe: async <T>(text: string, params: readonly unknown[] = []) =>
          Array.from(await database.execute<T>({ text, params })),
      });
      await database.transaction((selected) =>
        outbox.publish(selected, "test.created", {}, { tenantId: tenant.id }),
      );
    });
    return { application: app, outboxWorker: worker };
  },
});
