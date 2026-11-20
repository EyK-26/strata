import { expect, test } from "bun:test";
import { createSystemQueueServices } from "@getstrata/core/queue/queueServices";
import { bounded, deferred } from "../fixtures/applicationOwnershipSupport";
import { withQueuePersistence } from "../helpers/queuePersistence";

test("application stop drains queue SQL through a copying runner but cancels ordinary jobs", async () => {
  await withQueuePersistence(async ({ application, invoke, run }) => {
    const services = createSystemQueueServices((envelope, work, options) =>
      invoke({ ...envelope }, work, options),
    );
    await run((database) =>
      database.execute({ text: "CREATE TABLE drain_effects (id INTEGER PRIMARY KEY)", params: [] }),
    );
    const entered = deferred();
    const release = deferred();
    const ordinaryEntered = deferred<AbortSignal>();
    const ordinary = application.run(
      {
        kind: "job",
        actor: { kind: "system", policy: "queue.job" },
        metadata: { jobName: "drain" },
      },
      async (scope) => {
        ordinaryEntered.resolve(scope.signal);
        await release.promise;
      },
    );
    void ordinary.catch(() => {});
    const running = services.runAttempt(
      { name: "drain", attempts: 0, payload: {} },
      { jobId: "drain", signal: new AbortController().signal },
      async ({ database }) => {
        entered.resolve();
        await release.promise;
        if (!database) throw new Error("Expected a queue database session");
        await database.execute({ text: "INSERT INTO drain_effects VALUES (1)", params: [] });
        expect(
          await database.execute({ text: "SELECT id FROM drain_effects", params: [] }),
        ).toEqual([{ id: 1 }]);
      },
    );
    void running.catch(() => {});
    try {
      await bounded(entered.promise);
      const signal = await bounded(ordinaryEntered.promise);
      const stop = application.stop();
      expect(signal.reason).toMatchObject({ code: "APPLICATION_START_CANCELLED" });
      await expect(application.run(() => {})).rejects.toMatchObject({
        code: "APPLICATION_NOT_READY",
      });
      release.resolve();
      await running;
      expect((await stop).successful).toBe(true);
    } finally {
      release.resolve();
      await Promise.allSettled([ordinary, running]);
    }
  });
});

test("caller cancellation still interrupts an admitted queue attempt during drain", async () => {
  await withQueuePersistence(async ({ application, services }) => {
    const entered = deferred();
    const release = deferred();
    const caller = new AbortController();
    const cancelled = new Error("Caller cancelled the attempt");
    const running = services.runAttempt(
      { name: "drain", attempts: 0, payload: {} },
      { jobId: "drain", signal: caller.signal },
      async ({ database }) => {
        entered.resolve();
        await release.promise;
        if (!database) throw new Error("Expected a queue database session");
        await database.execute({ text: "SELECT 1", params: [] });
      },
    );
    void running.catch(() => {});
    try {
      await bounded(entered.promise);
      const stop = application.stop();
      caller.abort(cancelled);
      release.resolve();
      await expect(running).rejects.toBe(cancelled);
      expect((await stop).successful).toBe(true);
    } finally {
      release.resolve();
      await Promise.allSettled([running]);
    }
  });
});
