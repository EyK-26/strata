import { test } from "bun:test";
import assert from "node:assert/strict";
import { valueService } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import {
  type AfterCommitRepositoryListener,
  defineRepository,
  repositoryEffects,
  type TransactionalRepositoryListener,
} from "@getstrata/core/database/definitions";
import type { TransactionSession } from "@getstrata/core/database/session";
import { defineTable } from "@getstrata/core/database/table";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { createApplication } from "@getstrata/core/runtime/application";

type Row = { id: number; title: string };

test("BP6 listeners share the write child and caught failure rolls back without repeating write transform", async () => {
  const Transactional =
    createServiceToken<TransactionalRepositoryListener<Row, "id">>("bound.transactional");
  const AfterCommit = createServiceToken<AfterCommitRepositoryListener<Row>>("bound.afterCommit");
  let transformations = 0;
  let publications = 0;
  let rejectPublication = true;
  let outer: TransactionSession | undefined;
  const postCommit: unknown[] = [];
  const notes = defineRepository<Row, "id", BaseRepository<Row, "id">, readonly []>({
    name: "EffectNotes",
    table: defineTable<Row, "id">({
      name: "effect_notes",
      primaryKey: "id",
      columns: ["id", "title"],
    }),
    dependencies: [],
    create: (binding) => new BaseRepository(binding),
    hooks: {
      transformWrite(_action, values) {
        transformations++;
        return { ...values, title: `${values.title}:once` };
      },
    },
  });
  const app = createApplication({
    providers: [],
    services: [
      valueService(Transactional, async (publication) => {
        publications++;
        assert.equal(publication.definition, notes);
        assert.equal(Object.isFrozen(publication.row), true);
        assert.notEqual(
          publication.session,
          outer,
          "Publication owns the exact write child, not the caller's parent",
        );
        assert.deepEqual(
          await publication.session.execute({
            text: "SELECT id, title FROM effect_notes WHERE id = ?",
            params: [publication.row.id],
          }),
          [publication.row],
        );
        await assert.rejects(async () =>
          present(outer).execute({ text: "SELECT id FROM effect_notes", params: [] }),
        );
        if (rejectPublication) throw new Error("listener rejects this child write");
      }),
      valueService(AfterCommit, async (row, { database }) => {
        assert.equal(
          "requestRollback" in database,
          false,
          "P receives a fresh root facade after release",
        );
        postCommit.push(
          await database.execute({
            text: "SELECT id, title FROM effect_notes WHERE id = ?",
            params: [row.id],
          }),
        );
      }),
      ...createDatabaseBindings({
        default: "main",
        repositories: [notes],
        repositoryEffects: [
          repositoryEffects(notes, [
            { action: "created", transactional: Transactional, afterCommit: AfterCommit },
          ]),
        ],
        connections: { main: { driver: "sqlite", filename: ":memory:" } },
      }),
    ],
  });
  await app.start();
  try {
    await app.run(async (scope) => {
      const db = scope.resolve(DATABASE_SESSION_TOKEN);
      await db.execute({
        text: "CREATE TABLE effect_notes (id INTEGER PRIMARY KEY, title TEXT)",
        params: [],
      });
      await assert.rejects(async () =>
        db.repository(notes).create({ id: 99, title: "forbidden root" }),
      );
      assert.equal(transformations, 0, "Explicit-transaction preflight precedes the write hook");
      await db.transaction(async (tx) => {
        outer = tx;
        await assert.rejects(async () => tx.repository(notes).create({ id: 1, title: "rollback" }));
        assert.deepEqual(await tx.execute({ text: "SELECT id FROM effect_notes", params: [] }), []);
        assert.deepEqual(postCommit, []);
        rejectPublication = false;
        const row = await tx.repository(notes).create({ id: 2, title: "commit" });
        assert.deepEqual(row, { id: 2, title: "commit:once" });
        assert.deepEqual(
          postCommit,
          [],
          "Post-commit listener cannot run before outer ACK/release",
        );
      });
      assert.deepEqual(postCommit, [[{ id: 2, title: "commit:once" }]]);
      assert.equal(
        transformations,
        2,
        "A failed and successful public write each transform exactly once",
      );
      assert.equal(publications, 2);
    });
  } finally {
    await app.stop();
  }
});

function present<T>(value: T | undefined | null): T {
  assert.ok(value !== undefined && value !== null);
  return value;
}

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("noncallable declared effect services reject before native pools or repository constructors", async () => {
  const directory = mkdtempSync(join(tmpdir(), "invalid-effect-service-"));
  let constructors = 0;
  const notes = defineRepository({
    name: "NoncallableEffectNotes",
    table: defineTable<Row, "id">({
      name: "invalid_effect_notes",
      primaryKey: "id",
      columns: ["id", "title"],
    }),
    dependencies: [] as const,
    create: (binding) => {
      constructors++;
      return new BaseRepository(binding);
    },
  });
  try {
    for (const kind of ["transactional", "afterCommit"] as const) {
      const token = createServiceToken<unknown>(`invalid.effect.${kind}`);
      const filename = join(directory, `${kind}.sqlite`);
      const app = createApplication({
        providers: [],
        services: [
          valueService(token, { notAFunction: true }),
          ...createDatabaseBindings({
            default: "main",
            connections: { main: { driver: "sqlite", filename } },
            repositories: [notes],
            repositoryEffects: [
              repositoryEffects(notes, [{ action: "created", [kind]: token } as never]),
            ],
          }),
        ],
      });
      try {
        await assert.rejects(app.start());
        const result = await app.stop();
        const expected =
          kind === "transactional"
            ? "Transactional listener must be a function"
            : "After-commit listener must be a function";
        assert.ok(
          result.snapshot.errors.some(
            (entry) => entry.error instanceof Error && entry.error.message.includes(expected),
          ),
        );
        assert.equal(
          result.successful,
          true,
          "Rejected non-resource preparation acquires no native ownership",
        );
        assert.deepEqual(result.snapshot.retainedResources, []);
        assert.equal(existsSync(filename), false);
        assert.equal(constructors, 0);
      } finally {
        await app.stop();
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("all five public row actions reject root transactional publication before native SQL and dispatch once on explicit children", async () => {
  const { createNativePersistenceApplication } = await import(
    "../helpers/nativePersistenceApplication"
  );
  type EffectRow = { id: number; title: string; deleted_at: string | null };
  const Transactional = createServiceToken<TransactionalRepositoryListener<EffectRow, "id">>(
    "five actions transactional",
  );
  const AfterCommit =
    createServiceToken<AfterCommitRepositoryListener<EffectRow>>("five actions committed");
  const statements: string[] = [];
  let transforms = 0;
  const published: string[] = [];
  const committed: number[] = [];
  let parent: TransactionSession | undefined;
  const definition = defineRepository({
    name: "FiveActions",
    table: defineTable<EffectRow, "id">({
      name: "five_effect_actions",
      primaryKey: "id",
      columns: ["id", "title", "deleted_at"],
      softDeletes: true,
    }),
    dependencies: [],
    create: (binding) => new BaseRepository(binding),
    hooks: {
      transformWrite(_action, values) {
        transforms++;
        return { ...values };
      },
    },
  });
  const actions = ["created", "updated", "deleted", "force-deleted", "restored"] as const;
  const fixture = await createNativePersistenceApplication(
    {
      default: "main",
      connections: { main: { driver: "sqlite", filename: ":memory:" } },
      repositories: [definition],
      repositoryEffects: [
        repositoryEffects(
          definition,
          actions.map((action) => ({
            action,
            transactional: Transactional,
            afterCommit: AfterCommit,
          })),
        ),
      ],
    },
    (statement) => statements.push(statement.text),
    [
      valueService(Transactional, async (publication) => {
        assert.notEqual(
          publication.session,
          parent,
          "Each row action publishes through its reselected write child",
        );
        assert.equal(publication.definition, definition);
        assert.equal(Object.isFrozen(publication.row), true);
        assert.deepEqual(
          await publication.session.execute({ text: "SELECT 71 AS value", params: [] }),
          [{ value: 71 }],
        );
        published.push(publication.action);
      }),
      valueService(AfterCommit, async (row, { database }) => {
        assert.equal("requestRollback" in database, false);
        await database.execute({ text: "SELECT 1", params: [] });
        committed.push(row.id);
      }),
    ],
  );
  try {
    await fixture.run(async (database) => {
      await database.execute({
        text: "CREATE TABLE five_effect_actions(id INTEGER PRIMARY KEY,title TEXT,deleted_at TEXT)",
        params: [],
      });
      await database.execute({
        text: "INSERT INTO five_effect_actions VALUES(1,'live',NULL),(2,'trashed','2026-01-01')",
        params: [],
      });
      const root = database.repository(definition);
      const denied = [
        () => root.create({ id: 3, title: "new" }),
        () => root.updateById(1, { title: "changed" }),
        () => root.deleteById(1),
        () => root.forceDeleteById(1),
        () => root.restoreById(2),
      ];
      statements.length = 0;
      for (const write of denied) {
        await assert.rejects(write, /Transactional listeners require an explicit transaction/);
        assert.deepEqual(statements, []);
      }
      assert.equal(transforms, 0);
      assert.deepEqual(published, []);
      assert.deepEqual(committed, []);
      assert.deepEqual(
        await database.execute({
          text: "SELECT * FROM five_effect_actions ORDER BY id",
          params: [],
        }),
        [
          { id: 1, title: "live", deleted_at: null },
          { id: 2, title: "trashed", deleted_at: "2026-01-01" },
        ],
      );
      await database.transaction(async (selected) => {
        parent = selected;
        const child = selected.repository(definition);
        await child.create({ id: 3, title: "new" });
        await child.updateById(1, { title: "changed" });
        await child.deleteById(1);
        await child.forceDeleteById(3);
        await child.restoreById(2);
        assert.deepEqual(published, actions);
        assert.deepEqual(committed, []);
      });
      assert.deepEqual(published, actions);
      assert.deepEqual(committed, [3, 1, 1, 3, 2]);
      const rows = await database.execute<EffectRow>({
        text: "SELECT id,title,deleted_at FROM five_effect_actions ORDER BY id",
        params: [],
      });
      assert.equal(rows.length, 2);
      assert.equal(rows[0]?.id, 1);
      assert.equal(rows[0]?.title, "changed");
      assert.equal(typeof rows[0]?.deleted_at, "string");
      assert.ok(rows[0]?.deleted_at);
      assert.deepEqual(rows[1], { id: 2, title: "trashed", deleted_at: null });
    });
  } finally {
    await fixture.close();
  }
});

test("declared after-commit listeners share one frozen publication context with exact execution and root", async () => {
  const First = createServiceToken<AfterCommitRepositoryListener<Row>>("context.first");
  const Second = createServiceToken<AfterCommitRepositoryListener<Row>>("context.second");
  const { createNativePersistenceApplication } = await import(
    "../helpers/nativePersistenceApplication"
  );
  const notes = defineRepository({
    name: "ContextNotes",
    table: defineTable<Row, "id">({
      name: "context_notes",
      primaryKey: "id",
      columns: ["id", "title"],
    }),
    dependencies: [],
    create: (binding) => new BaseRepository(binding),
  });
  const contexts: import("@getstrata/core/database/definitions").AfterCommitRepositoryContext[] =
    [];
  const fixture = await createNativePersistenceApplication(
    {
      default: "main",
      connections: { main: { driver: "sqlite", filename: ":memory:" } },
      repositories: [notes],
      repositoryEffects: [
        repositoryEffects(notes, [
          { action: "created", afterCommit: First },
          { action: "created", afterCommit: Second },
        ]),
      ],
    },
    undefined,
    [
      valueService(First, async (row, context) => {
        assert.equal(Object.isFrozen(context), true);
        assert.equal(Object.isFrozen(context.policy), true);
        assert.equal(Object.isFrozen(context.execution), true);
        assert.equal(Object.isFrozen(context.execution.tenant), true);
        assert.equal("ownership" in context, false);
        assert.equal("requestRollback" in context.database, false);
        assert.deepEqual(
          await context.database.execute({
            text: "SELECT id,title FROM context_notes WHERE id=?",
            params: [row.id],
          }),
          [row],
        );
        contexts.push(context);
      }),
      valueService(Second, (_row, context) => {
        assert.equal(context, contexts.at(-1));
      }),
    ],
  );
  const envelope = {
    kind: "command" as const,
    tenant: { id: 1, tags: ["original"] },
    actor: { kind: "principal" as const, claims: { id: 1, label: "original" } },
  };
  const failures: unknown[] = [];
  try {
    await fixture.run((database) =>
      database.execute({
        text: "CREATE TABLE context_notes(id INTEGER PRIMARY KEY,title TEXT)",
        params: [],
      }),
    );
    await fixture.application.run(envelope, async (scope) => {
      const database = scope.resolve(DATABASE_SESSION_TOKEN);
      envelope.tenant.id = 9;
      envelope.tenant.tags.push("mutated");
      envelope.actor.claims.id = 9;
      await database.transaction(async (tx) => {
        await tx.repository(notes).create({ id: 1, title: "committed" });
        assert.equal(contexts.length, 0);
      });
      assert.equal(present(contexts[0]).database, database);
      assert.equal(present(contexts[0]).execution, scope.context);
      assert.deepEqual(present(contexts[0]).execution.tenant, { id: 1, tags: ["original"] });
      assert.deepEqual(present(contexts[0]).execution.actor, {
        kind: "principal",
        claims: { id: 1, label: "original" },
      });
      // Preserve the existing nontransactional after-only publication path too.
      await database.repository(notes).create({ id: 2, title: "direct" });
      assert.equal(contexts.length, 2);
      assert.notEqual(contexts[0], contexts[1]);
      assert.equal(present(contexts[1]).execution, scope.context);
      await assert.rejects(
        database.transaction(async (tx) => {
          await tx.repository(notes).create({ id: 3, title: "rollback" });
          throw new Error("owned rollback");
        }),
      );
      assert.equal(contexts.length, 2);
    });
    await assert.rejects(present(contexts[0]).database.execute({ text: "SELECT 1", params: [] }));
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      await fixture.close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, "Context unit and cleanup failed");
});
