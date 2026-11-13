import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  createSqlSamlAssertionReplayStore,
  type SamlAssertionReplayStore,
} from "@getstrata/core/auth/saml/samlServiceProvider";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { createApplication } from "@getstrata/core/runtime/application";

test("BP7 explicit SQL SAML replay stores isolate the same assertion between apps and reject expired authority", async () => {
  const apps = [0, 1].map(() =>
    createApplication({
      providers: [],
      services: createDatabaseBindings({
        default: "main",
        connections: { main: { driver: "sqlite", filename: ":memory:" } },
      }),
    }),
  );
  const stores: SamlAssertionReplayStore[] = [];
  await Promise.all(apps.map((app) => app.start()));
  try {
    await Promise.all(
      apps.map((app, index) =>
        app.run(async (scope) => {
          const db = scope.resolve(DATABASE_SESSION_TOKEN);
          await db.execute({
            text: "CREATE TABLE auth_saml_assertions (assertion_id TEXT PRIMARY KEY, consumed_at TEXT)",
            params: [],
          });
          const store = createSqlSamlAssertionReplayStore(db);
          stores[index] = store;
          await store.consume("same-signed-assertion");
          await assert.rejects(store.consume("same-signed-assertion"), /replay/);
          await assert.rejects(
            db.transaction(async (tx) => {
              await createSqlSamlAssertionReplayStore(tx).consume("rolled-back");
              throw new Error("outer rollback");
            }),
            /outer rollback/,
          );
          await db.transaction(async (tx) => {
            await assert.rejects(
              tx.transaction(async (child) => {
                await createSqlSamlAssertionReplayStore(child).consume("savepoint-rollback");
                throw new Error("child rollback");
              }),
              /child rollback/,
            );
            const nested = createSqlSamlAssertionReplayStore(tx);
            await nested.consume(`child-${index}`);
          });
          assert.deepEqual(
            await db.execute({
              text: "SELECT assertion_id FROM auth_saml_assertions ORDER BY assertion_id",
              params: [],
            }),
            [{ assertion_id: `child-${index}` }, { assertion_id: "same-signed-assertion" }],
          );
        }),
      ),
    );
    for (const store of stores) await assert.rejects(store.consume("expired-invocation"));
    await Promise.all(
      apps.map((app) =>
        app.run(async (scope) => {
          assert.deepEqual(
            await scope.resolve(DATABASE_SESSION_TOKEN).execute({
              text: "SELECT assertion_id FROM auth_saml_assertions WHERE assertion_id = 'expired-invocation'",
              params: [],
            }),
            [],
          );
        }),
      ),
    );
  } finally {
    for (const app of apps) assert.equal((await app.stop()).successful, true);
  }
});

test("selected SQL replay retention is atomic with consume, including a failing cleanup", async () => {
  const app = createApplication({
    providers: [],
    services: createDatabaseBindings({
      default: "main",
      connections: { main: { driver: "sqlite", filename: ":memory:" } },
    }),
  });
  await app.start();
  try {
    await app.run(async (scope) => {
      const db = scope.resolve(DATABASE_SESSION_TOKEN);
      await db.execute({
        text: "CREATE TABLE auth_saml_assertions (assertion_id TEXT PRIMARY KEY, consumed_at TEXT)",
        params: [],
      });
      await db.execute({
        text: "INSERT INTO auth_saml_assertions VALUES (?,?)",
        params: ["expired", new Date(Date.now() - 7200000).toISOString()],
      });
      await createSqlSamlAssertionReplayStore(db).consume("fresh");
      assert.deepEqual(
        await db.execute({ text: "SELECT assertion_id FROM auth_saml_assertions", params: [] }),
        [{ assertion_id: "fresh" }],
      );
      await db.execute({
        text: "INSERT INTO auth_saml_assertions VALUES (?,?)",
        params: ["expired-again", new Date(Date.now() - 7200000).toISOString()],
      });
      await db.execute({
        text: "CREATE TRIGGER fail_cleanup BEFORE DELETE ON auth_saml_assertions BEGIN SELECT RAISE(ABORT,'cleanup failure'); END",
        params: [],
      });
      await assert.rejects(createSqlSamlAssertionReplayStore(db).consume("must-roll-back"));
      assert.deepEqual(
        await db.execute({
          text: "SELECT assertion_id FROM auth_saml_assertions ORDER BY assertion_id",
          params: [],
        }),
        [{ assertion_id: "expired-again" }, { assertion_id: "fresh" }],
      );
    });
  } finally {
    assert.equal((await app.stop()).successful, true);
  }
});
