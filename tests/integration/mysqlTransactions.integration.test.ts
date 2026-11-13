import { expect, test } from "bun:test";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { createApplication } from "@getstrata/core/runtime/application";

async function bounded<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 3000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function gate() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const url = process.env.MYSQL_URL;
test.skipIf(!url)(
  "canonical MySQL overlapping roots have distinct sessions and hide uncommitted writes",
  async () => {
    if (!url) throw Error("Dedicated MySQL test URL required");
    const app = createApplication({
      providers: [],
      services: createDatabaseBindings({
        default: "main",
        connections: { main: { driver: "mysql", url, max: 2 } },
      }),
    });
    const table = `owned_tx_${crypto.randomUUID().replaceAll("-", "")}`;
    const entered = gate();
    const release = gate();
    const failures: unknown[] = [];
    const pending: Promise<unknown>[] = [];
    let created = false;
    let firstSession: number | undefined;
    try {
      await app.start();
      await app.run(async (scope) => {
        await scope.resolve(DATABASE_SESSION_TOKEN).execute({
          text: `CREATE TABLE ${table}(value INTEGER PRIMARY KEY) ENGINE=InnoDB`,
          params: [],
        });
        created = true;
      });
      const first = app.run((scope) =>
        scope.resolve(DATABASE_SESSION_TOKEN).transaction(async (selected) => {
          firstSession = Number(
            (
              await selected.execute<{ id: number }>({
                text: "SELECT CONNECTION_ID() AS id",
                params: [],
              })
            )[0]?.id,
          );
          expect(Number.isFinite(firstSession)).toBe(true);
          await selected.execute({ text: `INSERT INTO ${table} VALUES (?)`, params: [4] });
          entered.resolve();
          await release.promise;
          expect(
            Number(
              (
                await selected.execute<{ id: number }>({
                  text: "SELECT CONNECTION_ID() AS id",
                  params: [],
                })
              )[0]?.id,
            ),
          ).toBe(firstSession);
        }),
      );
      pending.push(first);
      void first.catch(() => entered.resolve());
      await bounded(entered.promise, "first MySQL writer");
      const secondRun = app.run((scope) =>
        scope.resolve(DATABASE_SESSION_TOKEN).transaction(async (selected) => {
          const second = Number(
            (
              await selected.execute<{ id: number }>({
                text: "SELECT CONNECTION_ID() AS id",
                params: [],
              })
            )[0]?.id,
          );
          expect(Number.isFinite(second)).toBe(true);
          expect(second).not.toBe(firstSession);
          expect(
            await selected.execute({ text: `SELECT value FROM ${table}`, params: [] }),
          ).toEqual([]);
        }),
      );
      pending.push(secondRun);
      await bounded(secondRun, "overlapping MySQL transaction");
      release.resolve();
      await bounded(first, "first MySQL commit");
      expect(
        await app.run((scope) =>
          scope
            .resolve(DATABASE_SESSION_TOKEN)
            .execute({ text: `SELECT value FROM ${table}`, params: [] }),
        ),
      ).toEqual([{ value: 4 }]);
    } catch (error) {
      failures.push(error);
    } finally {
      release.resolve();
      const outcomes = await Promise.allSettled(pending);
      for (const outcome of outcomes)
        if (outcome.status === "rejected") failures.push(outcome.reason);
      if (created)
        try {
          await app.run((scope) =>
            scope
              .resolve(DATABASE_SESSION_TOKEN)
              .execute({ text: `DROP TABLE ${table}`, params: [] }),
          );
          expect(
            await app.run((scope) =>
              scope.resolve(DATABASE_SESSION_TOKEN).execute({
                text: "SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?",
                params: [table],
              }),
            ),
          ).toEqual([]);
        } catch (error) {
          failures.push(error);
        }
      try {
        const stopped = await app.stop();
        if (!stopped.successful)
          failures.push(new Error("MySQL overlap cleanup failed", { cause: stopped }));
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, "MySQL overlap and cleanup failed");
  },
  30000,
);
