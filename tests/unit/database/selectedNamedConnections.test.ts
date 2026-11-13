import { test } from "bun:test";
import assert from "node:assert/strict";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import type { DatabaseSession } from "@getstrata/core/database/session";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { createApplication } from "@getstrata/core/runtime/application";

test("selected same-named connections isolate owners and reject missing names and expired scopes", async () => {
  const make = () =>
    createApplication({
      providers: [],
      services: createDatabaseBindings({
        default: "main",
        connections: {
          main: { driver: "sqlite", filename: ":memory:" },
          kiosk: { driver: "sqlite", filename: ":memory:" },
        },
      }),
    });
  const a = make(),
    b = make();
  const errors: unknown[] = [];
  let expired!: DatabaseSession;
  const names = async (app: typeof a) =>
    app.run(async (scope) => {
      const database = scope.resolve(DATABASE_SESSION_TOKEN);
      const main = await database.execute<{ name: string }>({
        text: "SELECT name FROM owner_marker",
        params: [],
      });
      const kiosk = await database
        .connection("kiosk")
        .execute<{ name: string }>({ text: "SELECT name FROM owner_marker", params: [] });
      return [main.map((row) => row.name), kiosk.map((row) => row.name)];
    });
  try {
    for (const [app, owner] of [
      [a, "a"],
      [b, "b"],
    ] as const) {
      await app.start();
      await app.run(async (scope) => {
        const main = scope.resolve(DATABASE_SESSION_TOKEN);
        assert.throws(() => main.connection("missing"), { code: "DATABASE_CONNECTION_UNKNOWN" });
        for (const [database, name] of [
          [main, "main"],
          [main.connection("kiosk"), "kiosk"],
        ] as const) {
          await database.execute({
            text: "CREATE TABLE owner_marker (name TEXT NOT NULL)",
            params: [],
          });
          await database.execute({
            text: "INSERT INTO owner_marker (name) VALUES (?)",
            params: [`${owner}-${name}`],
          });
        }
        if (app === a) expired = main.connection("kiosk");
      });
    }
    assert.deepEqual(await names(a), [["a-main"], ["a-kiosk"]]);
    assert.deepEqual(await names(b), [["b-main"], ["b-kiosk"]]);
    await assert.rejects(
      () =>
        expired.execute({ text: "INSERT INTO owner_marker (name) VALUES ('expired')", params: [] }),
      { code: "APPLICATION_SCOPE_EXPIRED" },
    );
    assert.throws(() => expired.connection("kiosk"), { code: "APPLICATION_SCOPE_EXPIRED" });
    assert.deepEqual(await names(a), [["a-main"], ["a-kiosk"]]);
    assert.deepEqual(await names(b), [["b-main"], ["b-kiosk"]]);
  } catch (error) {
    errors.push(error);
  } finally {
    for (const app of [a, b]) {
      try {
        const result = await app.stop();
        if (!result.successful)
          errors.push(
            new AggregateError(
              result.snapshot.errors.map((item) => item.error),
              "Selected named owner cleanup failed",
            ),
          );
      } catch (error) {
        errors.push(error);
      }
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length)
    throw new AggregateError(errors, "Selected named connections and cleanup failed");
});
