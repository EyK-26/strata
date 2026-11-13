import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { failedJobRepository } from "@getstrata/core/queue/failedJobRepository";
import { createSystemQueueServices } from "@getstrata/core/queue/queueServices";
import { createApplication } from "@getstrata/core/runtime/application";

async function createQueuePersistenceFixture() {
  const application = createApplication({
    providers: [],
    services: createDatabaseBindings({
      default: "test",
      connections: { test: { driver: "sqlite", filename: ":memory:" } },
      repositories: [failedJobRepository],
    }),
  });
  await application.start();
  const run = <T>(
    work: (database: import("@getstrata/core/database/session").DatabaseSession) => T | Promise<T>,
  ) => application.run((scope) => work(scope.resolve(DATABASE_SESSION_TOKEN)));
  await run((db) =>
    db.execute({
      text: "CREATE TABLE failed_job(id INTEGER PRIMARY KEY,job_name TEXT NOT NULL,job_id TEXT,handoff TEXT,payload TEXT NOT NULL,exception TEXT NOT NULL,failed_at DATETIME NOT NULL)",
      params: [],
    }),
  );
  const invoke: import("@getstrata/core/queue/queueServices").QueueInvocation = (envelope, work) =>
    application.run(envelope, (scope) => work({ database: scope.resolve(DATABASE_SESSION_TOKEN) }));
  const services = createSystemQueueServices(invoke);
  return { application, run, services, invoke };
}

export { createQueuePersistenceFixture };

async function withQueuePersistence<T>(
  work: (fixture: Awaited<ReturnType<typeof createQueuePersistenceFixture>>) => T | Promise<T>,
): Promise<T> {
  const fixture = await createQueuePersistenceFixture();
  let value: T | undefined;
  const errors: unknown[] = [];
  try {
    value = await work(fixture);
  } catch (error) {
    errors.push(error);
  }
  try {
    const result = await fixture.application.stop();
    if (!result.successful)
      errors.push(new Error("Queue fixture application did not close cleanly."));
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, "Queue fixture execution or cleanup failed.");
  return value as T;
}
function overrideQueueRecorder(
  fixture: Awaited<ReturnType<typeof createQueuePersistenceFixture>>,
  recorder: {
    recordFailure(input: Parameters<typeof fixture.services.recordFailure>[0]): Promise<unknown>;
  },
) {
  return {
    ...fixture.services,
    recordFailure: (input: Parameters<typeof fixture.services.recordFailure>[0]) =>
      fixture.invoke(
        { kind: "command", actor: { kind: "system", policy: "queue.test-recovery" } },
        () => recorder.recordFailure(input),
      ) as ReturnType<typeof fixture.services.recordFailure>,
  };
}

export { overrideQueueRecorder, withQueuePersistence };
