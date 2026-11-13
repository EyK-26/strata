import { test } from "bun:test";
import assert from "node:assert/strict";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import type { DatabaseSession } from "@getstrata/core/database/session";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { createApplication } from "@getstrata/core/runtime/application";
import { createPersistenceInvocation } from "../../src/bootstrap/persistenceInvocation";
import { bounded, deferred } from "../fixtures/applicationOwnershipSupport";

// This proves actual invocation selection; transport/worker/CLI witnesses remain separate.
test("BP7 configured invocation captures one application and selected pool across overlap", async () => {
  const apps = [0, 1].map(() =>
    createApplication({
      providers: [],
      services: createDatabaseBindings({
        default: "main",
        connections: {
          main: { driver: "sqlite", filename: ":memory:" },
          selected: { driver: "sqlite", filename: ":memory:" },
        },
      }),
    }),
  );
  await Promise.all(apps.map((app) => app.start()));
  const entered = [deferred(), deferred()];
  const saved: DatabaseSession[] = [];
  try {
    const outcomes = await Promise.all(
      apps.map((app, index) => {
        const invoke = createPersistenceInvocation(app, "selected");
        return invoke({ kind: "command" }, async ({ database }) => {
          saved[index] = database;
          await database.execute({
            text: "CREATE TABLE invocation_rows (value INTEGER)",
            params: [],
          });
          await database.execute({
            text: "INSERT INTO invocation_rows VALUES (?)",
            params: [index + 11],
          });
          present(entered[index]).resolve();
          await bounded(present(entered[1 - index]).promise);
          return database.execute<{ value: number }>({
            text: "SELECT value FROM invocation_rows",
            params: [],
          });
        });
      }),
    );
    assert.deepEqual(outcomes, [[{ value: 11 }], [{ value: 12 }]]);
    for (const [index, app] of apps.entries()) {
      await assert.rejects(
        present(saved[index]).execute({ text: "SELECT value FROM invocation_rows", params: [] }),
      );
      await app.run(async (scope) => {
        const unselected = scope.resolve(DATABASE_SESSION_TOKEN);
        await assert.rejects(
          unselected.execute({ text: "SELECT value FROM invocation_rows", params: [] }),
        );
      });
    }
  } finally {
    entered.forEach((item) => {
      item.resolve();
    });
    await Promise.all(apps.map((app) => app.stop()));
  }
});

function present<T>(value: T | undefined | null): T {
  assert.ok(value !== undefined && value !== null);
  return value;
}

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResourceSpec } from "@getstrata/core/contracts/application";
import { resourceService } from "@getstrata/core/contracts/services";
import type { ServiceToken } from "@getstrata/core/contracts/token";
import type { RawPool } from "@getstrata/core/database/driverPorts";
import { DATABASE_MANAGER_TOKEN } from "@getstrata/core/database/tokens";

test("configured connections cannot alias one physical pool into two persistence authorities", async () => {
  const directory = mkdtempSync(join(tmpdir(), "duplicate-configured-pool-"));
  const filename = join(directory, "original.sqlite");
  const unopened = join(directory, "must-not-open.sqlite");
  const declarations = createDatabaseBindings({
    default: "main",
    connections: {
      main: { driver: "sqlite", filename },
      other: { driver: "sqlite", filename: unopened },
    },
  });
  const resources = declarations.filter((entry) => entry.kind === "resource");
  const original = present(resources[0]);
  const alias = present(resources[1]);
  assert.equal(original.kind, "resource");
  assert.equal(alias.kind, "resource");
  if (original.kind !== "resource" || alias.kind !== "resource")
    throw new Error("Missing original resources");
  let nativeOpens = 0;
  let nativeCloses = 0;
  let aliasCloses = 0;
  let transports = 0;
  const app = createApplication({
    providers: [
      {
        name: "require.original.manager",
        setup(scope) {
          scope.resolve(DATABASE_MANAGER_TOKEN);
        },
      },
    ],
    services: declarations,
    transports: [
      {
        name: "must-not-admit-alias",
        setup() {
          transports++;
        },
      },
    ],
    overrides: [
      resourceService(original.token as ServiceToken<RawPool>, {
        lifetime: "application",
        dependencies: original.dependencies,
        create: (...dependencies) => {
          const descriptor = original.create(...(dependencies as never[])) as ResourceSpec<RawPool>;
          return {
            ...descriptor,
            open(signal) {
              nativeOpens++;
              return descriptor.open(signal);
            },
            async close(pool, context) {
              nativeCloses++;
              await descriptor.close?.(pool, context);
            },
          };
        },
      }),
      resourceService(alias.token as ServiceToken<RawPool>, {
        lifetime: "application",
        dependencies: [original.token] as const,
        // Explicit provider alias fault: this declaration borrows the original value and
        // acquires no second native handle. Its cleanup must never double-close the owner.
        create: (originalPool) => ({
          name: "borrowed-pool-alias-control",
          open: () => ({ ok: true, value: originalPool as RawPool }),
          close: () => {
            aliasCloses++;
          },
        }),
      }),
    ],
  });
  try {
    await assert.rejects(app.start());
    const result = await app.stop();
    assert.ok(
      result.snapshot.errors.some(
        (entry) =>
          entry.error instanceof Error &&
          Reflect.get(entry.error, "code") === "DATABASE_CONFIG_INVALID",
      ),
    );
    assert.equal(
      transports,
      0,
      "Duplicate physical identity must not reach ready transport admission",
    );
    assert.equal(result.successful, true);
    assert.deepEqual(result.snapshot.retainedResources, []);
    assert.deepEqual(
      { nativeOpens, nativeCloses, aliasCloses },
      { nativeOpens: 1, nativeCloses: 1, aliasCloses: 1 },
    );
    assert.equal(
      existsSync(filename),
      true,
      "The original resource really opened a native SQLite database",
    );
    assert.equal(existsSync(unopened), false, "Aliasing never acquires a second physical database");
    await app.stop();
    assert.equal(nativeCloses, 1);
  } finally {
    await app.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineModel, defineRepository } from "@getstrata/core/database/definitions";
import { Model } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";
import { createNativePersistenceApplication } from "../helpers/nativePersistenceApplication";

test("published managers accept only their genuine configured pools and keep both applications usable", async () => {
  const apps = [0, 1].map(() =>
    createApplication({
      providers: [],
      services: createDatabaseBindings({
        default: "main",
        connections: {
          main: { driver: "sqlite", filename: ":memory:" },
          named: { driver: "sqlite", filename: ":memory:" },
        },
      }),
    }),
  );
  await Promise.all(apps.map((app) => app.start()));
  try {
    await present(apps[0]).run(async (a) => {
      await present(apps[1]).run(async (b) => {
        const managerA = a.resolve(DATABASE_MANAGER_TOKEN);
        const managerB = b.resolve(DATABASE_MANAGER_TOKEN);
        const identities = new Set<object>();
        for (const manager of [managerA, managerB]) {
          assert.equal(manager.connection(), manager.connection("main"));
          const main = manager.configuredPool(manager.connection());
          assert.equal(main, manager.configuredPool(manager.connection("main")));
          identities.add(main);
          identities.add(manager.configuredPool(manager.connection("named")));
          for (const connection of [undefined, "named"]) {
            assert.deepEqual(
              await manager
                .connection(connection)
                .execute({ text: "SELECT 19 AS value", params: [] }),
              [{ value: 19 }],
            );
          }
        }
        assert.equal(identities.size, 4, "Every real app/configured pool owns a distinct identity");
        for (const [owner, foreign] of [
          [managerA, managerB],
          [managerB, managerA],
        ] as const) {
          for (const connection of [undefined, "named"]) {
            assert.throws(
              () => owner.configuredPool(foreign.connection(connection)),
              (error: unknown) =>
                error instanceof Error && Reflect.get(error, "code") === "DATABASE_CONFIG_INVALID",
            );
          }
          assert.deepEqual(
            await owner.connection().execute({ text: "SELECT 23 AS value", params: [] }),
            [{ value: 23 }],
          );
        }
      });
    });
  } finally {
    const stopped = await Promise.all(apps.map((app) => app.stop()));
    assert.ok(
      stopped.every(
        (result) => result.successful && result.snapshot.retainedResources.length === 0,
      ),
    );
  }
});

test("eager model loads and related repository reads reject foreign app, pool and live branch before native SQL", async () => {
  type Row = { id: number; title: string };
  class Entry extends Model<Row, "id"> {}
  const entries = defineRepository({
    name: "CompositionEntries",
    table: defineTable<Row, "id">({
      name: "composition_entries",
      primaryKey: "id",
      columns: ["id", "title"],
    }),
    dependencies: [],
    create: (binding) => new BaseRepository(binding),
  });
  const entry = defineModel({
    name: "CompositionEntry",
    repository: entries,
    dependencies: [],
    attributes: { timestamps: false },
    construct: (state, binding) => new Entry(state, binding),
  });
  let sql = 0;
  const definition = {
    default: "main",
    repositories: [entries],
    models: [entry],
    connections: {
      main: { driver: "sqlite" as const, filename: ":memory:" },
      other: { driver: "sqlite" as const, filename: ":memory:" },
    },
  };
  const a = await createNativePersistenceApplication(definition, () => {
    sql++;
  });
  const b = await createNativePersistenceApplication(definition, () => {
    sql++;
  });
  const many = {
    type: "hasMany" as const,
    name: "entries",
    localKey: "id" as const,
    foreignKey: "id" as const,
  };
  const belongs = {
    type: "belongsTo" as const,
    name: "entries",
    foreignKey: "id" as const,
    ownerKey: "id" as const,
  };
  try {
    for (const app of [a, b])
      await app.run(async (db) => {
        for (const connection of ["main", "other"]) {
          const selected = db.connection(connection);
          await selected.execute({
            text: "CREATE TABLE composition_entries (id INTEGER PRIMARY KEY, title TEXT)",
            params: [],
          });
          await selected.execute({
            text: "INSERT INTO composition_entries VALUES (1,'original')",
            params: [],
          });
        }
      });
    await a.run(async (db) => {
      const repository = db.repository(entries);
      const model = db.model(entry).hydrate({ id: 1, title: "original" });
      const deny = async (
        foreign: BaseRepository<Row, "id">,
        expected: RegExp = /exact same live session/,
      ) => {
        const before = sql;
        await assert.rejects(
          repository.loadBelongsToForParents([{ id: 1, title: "child" }], belongs, foreign),
          expected,
        );
        await assert.rejects(
          model.loadHasMany("children", many, foreign),
          expected.source === "exact same live session" ? /exact active session/ : expected,
        );
        assert.equal(
          sql,
          before,
          "Neither rejection reaches either real application's SQL adapter",
        );
        assert.equal(model.loaded("children"), undefined);
      };
      await deny(db.connection("other").repository(entries));
      await b.run((foreign) => deny(foreign.repository(entries)));
      await a.run((otherBranch) =>
        deny(otherBranch.repository(entries), /APPLICATION_SCOPE_EXPIRED/),
      );
      assert.deepEqual(
        [
          ...(await repository.loadBelongsToForParents(
            [{ id: 1, title: "child" }],
            belongs,
            repository,
          )),
        ],
        [[1, { id: 1, title: "original" }]],
      );
      const loaded = await model.loadHasMany("children", many, repository);
      assert.deepEqual(loaded.children, [{ id: 1, title: "original" }]);
      assert.deepEqual(
        await db.execute({ text: "SELECT title FROM composition_entries", params: [] }),
        [{ title: "original" }],
      );
    });
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
});
