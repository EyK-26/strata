import { createPersistenceInvocation } from "@getstrata/bootstrap/persistenceInvocation";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import { createSqlOutboxBindings } from "@getstrata/core/events/outbox";
import { createApplication } from "@getstrata/core/runtime/application";
import { SQL } from "bun";

const workerUrl = process.env.OUTBOX_TEST_DATABASE_URL;
if (!workerUrl) throw new Error("Dedicated restricted-role database URL required.");
let application!: ReturnType<typeof createApplication>;
const adminUrl = process.env.OUTBOX_TEST_ADMIN_URL;
if (!adminUrl) throw new Error("Dedicated test admin URL required.");
const admin = new SQL(adminUrl);
const bindings = createSqlOutboxBindings({
  invoke: (input, work) => createPersistenceInvocation(application, "main")(input, work),
  connection: "main",
  tenancy: "rls",
  leaseMs: 300,
  resolveTenant: async () => ({ id: 101, slug: "outbox", plan: "free", region: "eu" as const }),
  listeners: [
    {
      name: "effect",
      event: "order",
      handle: async (event) => {
        await admin.unsafe("INSERT INTO effects VALUES ($1, $2) ON CONFLICT DO NOTHING", [
          event.id,
          101,
        ]);
        console.log("EXTERNAL_EFFECT_COMMITTED");
        await new Promise<void>(() => {});
      },
    },
  ],
});
application = createApplication({
  providers: [],
  services: [
    ...createDatabaseBindings({
      default: "main",
      connections: { main: { driver: "pgsql", url: workerUrl, max: 5 } },
      preparation: [bindings.token],
    }),
    ...bindings.services,
  ],
});
await application.start();
const outbox = await application.run((scope) => scope.resolve(bindings.token));
const failures: unknown[] = [];
try {
  await outbox.processNext();
} catch (error) {
  failures.push(error);
}
try {
  await admin.close();
} catch (error) {
  failures.push(error);
}
try {
  const stopped = await application.stop();
  if (!stopped.successful) throw new Error("Crash fixture shutdown was not confirmed clean.");
} catch (error) {
  failures.push(error);
}
if (failures.length) throw new AggregateError(failures, "Crash fixture failed.");
