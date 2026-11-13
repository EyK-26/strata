import { test } from "bun:test";
import assert from "node:assert/strict";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import {
  assertDefinition,
  defineModel,
  defineRepository,
  type ModelBinding,
  type ModelState,
  type RepositoryBinding,
  type RepositoryDefinition,
} from "@getstrata/core/database/definitions";
import { Model } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";
import { DATABASE_OWNERSHIP_TOKEN } from "#strata-orm-internal";

type Row = { id: number; title: string };
type Definition = RepositoryDefinition<Row, "id", BaseRepository<Row, "id">>;

function definition(name = "BoundNotes"): Definition {
  return defineRepository<Row, "id", BaseRepository<Row, "id">, readonly []>({
    name,
    table: defineTable<Row, "id">({
      name: "bound_notes",
      primaryKey: "id",
      columns: ["id", "title"],
    }),
    dependencies: [],
    create() {
      throw new Error("Definition validation must not construct a repository");
    },
  });
}

test("BP1 definitions copy mutable metadata without executing repository factories", () => {
  let constructions = 0;
  const table = defineTable<Row, "id">({
    name: "bound_notes",
    primaryKey: "id",
    columns: ["id", "title"],
    defaultOrderBy: [{ column: "id", direction: "asc" }],
  });
  const repository = defineRepository<Row, "id", BaseRepository<Row, "id">, readonly []>({
    name: "BoundNotes",
    table,
    dependencies: [],
    create() {
      constructions++;
      throw new Error("No constructor during definition preparation");
    },
  });
  table.name = "mutated_notes";
  (table.columns as string[]).push("foreign");
  if (Array.isArray(table.defaultOrderBy)) present(table.defaultOrderBy[0]).direction = "desc";
  assertDefinition(repository, "repository");
  assert.equal(constructions, 0);
  assert.equal(repository.table.name, "bound_notes");
  assert.deepEqual(repository.table.columns, ["id", "title"]);
  assert.deepEqual(repository.table.defaultOrderBy, [{ column: "id", direction: "asc" }]);
  assert.equal(Object.isFrozen(repository), true);
  assert.equal(Object.isFrozen(repository.table), true);
  assert.equal(Object.isFrozen(repository.table.columns), true);
});

test("BP1 definitions reject copied or prototype-spoofed authority identities", () => {
  const original = definition();
  assert.doesNotThrow(() => assertDefinition(original, "repository"));
  for (const spoof of [
    Object.freeze({ ...original }),
    Object.freeze(Object.create(original)),
    Object.freeze({ kind: "repository", name: original.name, table: original.table }),
  ]) {
    assert.throws(() => assertDefinition(spoof, "repository"));
  }
  assert.throws(() => assertDefinition(original, "model"));
  assert.notEqual(definition(), original, "Equal names never establish equal definition identity");
});

test("BP1 metadata accessors and forged dependency tokens reject before callbacks", () => {
  let effects = 0;
  const input = {
    name: "BadNotes",
    table: defineTable<Row, "id">({
      name: "bad_notes",
      primaryKey: "id",
      columns: ["id", "title"],
    }),
    dependencies: [],
    create() {
      effects++;
      throw new Error("No construction");
    },
  };
  const accessor = Object.defineProperty({ ...input }, "name", {
    get() {
      effects++;
      return "AccessorNotes";
    },
  });
  assert.throws(() => defineRepository(accessor));
  assert.throws(() =>
    defineRepository({ ...input, dependencies: [Object.freeze({ name: "forged" })] as never }),
  );
  assert.equal(effects, 0);
});

import { valueService } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { createApplication } from "@getstrata/core/runtime/application";

class LabelledNotes extends BaseRepository<Row, "id"> {
  #label: string;
  constructor(binding: RepositoryBinding<Row, "id">, label: string) {
    super(binding);
    this.#label = label;
  }
  label(): string {
    return this.#label;
  }
}

test("BP1 identical definitions bind private constructors and exact facade caches per application", async () => {
  const Label = createServiceToken<string>("bound.notes.label");
  let constructions = 0;
  const notes = defineRepository<Row, "id", LabelledNotes, readonly [typeof Label]>({
    name: "LabelledNotes",
    table: defineTable<Row, "id">({
      name: "bound_notes",
      primaryKey: "id",
      columns: ["id", "title"],
    }),
    dependencies: [Label],
    create(binding, label) {
      constructions++;
      return new LabelledNotes(binding, label);
    },
  });
  const sharedBindings = createDatabaseBindings({
    default: "main",
    repositories: [notes],
    connections: {
      main: { driver: "sqlite", filename: ":memory:" },
      other: { driver: "sqlite", filename: ":memory:" },
    },
  });
  const apps = ["first", "second"].map((label) =>
    createApplication({ providers: [], services: [valueService(Label, label), ...sharedBindings] }),
  );
  await Promise.all(apps.map((app) => app.start()));
  assert.equal(constructions, 0, "Preparation must not invoke per-session constructors");
  try {
    const identities = await Promise.all(
      apps.map((app) => app.run((scope) => scope.resolve(DATABASE_OWNERSHIP_TOKEN))),
    );
    const firstIdentity = present(identities[0]);
    const secondIdentity = present(identities[1]);
    assert.notEqual(
      firstIdentity.app,
      secondIdentity.app,
      "Reused declarations still create a fresh immutable app identity",
    );
    assert.notEqual(
      firstIdentity.connections.main,
      secondIdentity.connections.main,
      "Configured pool identity belongs to each application, not declaration closure",
    );
    assert.equal(Object.isFrozen(firstIdentity), true);
    assert.equal(Object.isFrozen(firstIdentity.connections.main), true);
    const values = await Promise.all(
      apps.map((app, index) =>
        app.run(async (scope) => {
          const db = scope.resolve(DATABASE_SESSION_TOKEN);
          assert.equal(db.connection("main"), db);
          const repository = db.repository(notes);
          assert.equal(db.repository(notes), repository);
          assert.notEqual(db.connection("other").repository(notes), repository);
          await db.execute({
            text: "CREATE TABLE bound_notes (id INTEGER PRIMARY KEY, title TEXT)",
            params: [],
          });
          await db.execute({
            text: "INSERT INTO bound_notes VALUES (?, ?)",
            params: [index + 1, repository.label()],
          });
          const result = await repository.findAll();
          await db.transaction(async (tx) => {
            assert.equal(tx.repository(notes), tx.repository(notes));
            assert.notEqual(tx.repository(notes), repository);
            await assert.rejects(
              async () => repository.findAll(),
              "Root-bound authority must not route into a child",
            );
          });
          return { label: repository.label(), rows: result };
        }),
      ),
    );
    assert.deepEqual(values, [
      { label: "first", rows: [{ id: 1, title: "first" }] },
      { label: "second", rows: [{ id: 2, title: "second" }] },
    ]);
    assert.equal(constructions, 6, "Each app constructs once for root, other pool and exact child");
  } finally {
    await Promise.all(apps.map((app) => app.stop()));
  }
});

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { service } from "@getstrata/core/contracts/services";

test("BP1 missing and captive definition dependencies reject before SQLite pool effects", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bound-registry-graph-"));
  let callbacks = 0;
  try {
    for (const kind of ["missing", "captive"] as const) {
      const dependency = createServiceToken<string>(`bound.${kind}`);
      const file = join(directory, `${kind}.sqlite`);
      const notes = defineRepository<
        Row,
        "id",
        BaseRepository<Row, "id">,
        readonly [typeof dependency]
      >({
        name: `Graph${kind}`,
        table: defineTable<Row, "id">({
          name: "notes",
          primaryKey: "id",
          columns: ["id", "title"],
        }),
        dependencies: [dependency],
        create(binding) {
          callbacks++;
          return new BaseRepository(binding);
        },
      });
      await assert.rejects(
        async () => {
          const app = createApplication({
            providers: [],
            services: [
              ...(kind === "captive"
                ? [
                    service(dependency, {
                      lifetime: "execution",
                      dependencies: [],
                      create: () => {
                        callbacks++;
                        return "execution";
                      },
                    }),
                  ]
                : []),
              ...createDatabaseBindings({
                default: "main",
                repositories: [notes],
                connections: { main: { driver: "sqlite", filename: file } },
              }),
            ],
          });
          await app.start();
          await app.stop();
        },
        (error: unknown) =>
          error instanceof Error &&
          Reflect.get(error, "code") ===
            `SERVICE_GRAPH_${kind === "missing" ? "MISSING" : "CAPTIVE"}_DEPENDENCY`,
      );
      assert.equal(
        existsSync(file),
        false,
        "Graph rejection must happen before the native pool creates its file",
      );
    }
    assert.equal(
      callbacks,
      0,
      "Neither definition nor execution dependency constructor may execute",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function present<T>(value: T | undefined | null): T {
  assert.ok(value !== undefined && value !== null);
  return value;
}

import {
  type AfterCommitRepositoryListener,
  repositoryEffects,
  type TransactionalRepositoryListener,
} from "@getstrata/core/database/definitions";

test("BP1 catalog listeners validate original definitions and dependency lifetime before native pools", async () => {
  const notes = definition("CatalogNotes");
  const outside = definition("UnregisteredCatalogNotes");
  const Tx =
    createServiceToken<TransactionalRepositoryListener<Row, "id">>("catalog.transactional");
  const After = createServiceToken<AfterCommitRepositoryListener<Row>>("catalog.afterCommit");
  const original = repositoryEffects(notes, [{ action: "created", transactional: Tx }]);
  const connection = {
    default: "main",
    connections: { main: { driver: "sqlite" as const, filename: ":memory:" } },
    repositories: [notes],
  };
  assert.throws(
    () => repositoryEffects(Object.freeze({ ...notes }), []),
    "Copied definitions cannot acquire listener authority",
  );
  assert.throws(
    () =>
      createDatabaseBindings({
        ...connection,
        repositoryEffects: [Object.freeze({ ...original })],
      }),
    "Catalog shape cannot substitute original declaration identity",
  );
  assert.throws(
    () =>
      createDatabaseBindings({
        ...connection,
        repositoryEffects: [repositoryEffects(outside, [])],
      }),
    "Catalog definition must be registered in this exact app graph",
  );
  const directory = mkdtempSync(join(tmpdir(), "bound-listener-graph-"));
  let callbacks = 0;
  try {
    for (const listener of ["transactional", "afterCommit"] as const) {
      for (const kind of ["missing", "captive"] as const) {
        const path = join(directory, `${listener}-${kind}.sqlite`);
        const effects = repositoryEffects(
          notes,
          listener === "transactional"
            ? [{ action: "created", transactional: Tx }]
            : [{ action: "created", afterCommit: After }],
        );
        const dependency =
          listener === "transactional"
            ? service(Tx, {
                lifetime: "execution",
                dependencies: [],
                create: () => {
                  callbacks++;
                  return () => undefined;
                },
              })
            : service(After, {
                lifetime: "execution",
                dependencies: [],
                create: () => {
                  callbacks++;
                  return () => undefined;
                },
              });
        await assert.rejects(
          async () => {
            const app = createApplication({
              providers: [],
              services: [
                ...(kind === "captive" ? [dependency] : []),
                ...createDatabaseBindings({
                  default: "main",
                  repositories: [notes],
                  repositoryEffects: [effects],
                  connections: { main: { driver: "sqlite", filename: path } },
                }),
              ],
            });
            await app.start();
            await app.stop();
          },
          (error: unknown) =>
            error instanceof Error &&
            Reflect.get(error, "code") ===
              `SERVICE_GRAPH_${kind === "missing" ? "MISSING" : "CAPTIVE"}_DEPENDENCY`,
        );
        assert.equal(
          existsSync(path),
          false,
          "Listener graph validation precedes native pool creation",
        );
      }
    }
    assert.equal(callbacks, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

class MetadataNote extends Model<Row, "id"> {}

test("public declarations reject inert metadata violations before getters, constructors or native acquisition", async () => {
  const directory = mkdtempSync(join(tmpdir(), "registry-invalid-metadata-"));
  let effects = 0;
  const base = {
    name: "MetadataNotes",
    table: defineTable<Row, "id">({
      name: "metadata_notes",
      primaryKey: "id",
      columns: ["id", "title"],
    }),
    dependencies: [] as const,
    create(binding: RepositoryBinding<Row, "id">) {
      effects++;
      return new BaseRepository(binding);
    },
  };
  const repository = defineRepository(base);
  const modelBase = {
    name: "MetadataNote",
    repository,
    dependencies: [] as const,
    attributes: { timestamps: false },
    construct(state: ModelState<Row>, binding: ModelBinding<Row, "id", BaseRepository<Row, "id">>) {
      effects++;
      return new MetadataNote(state, binding);
    },
  };
  type Selection = Pick<Parameters<typeof createDatabaseBindings>[0], "repositories" | "models">;
  const holes = new Array<string>(2);
  holes[0] = "id";
  const accessorColumns = ["id", "title"];
  Object.defineProperty(accessorColumns, "1", {
    get() {
      effects++;
      return "title";
    },
  });
  const accessorInput = Object.defineProperty({ ...base }, "name", {
    get() {
      effects++;
      return "bad";
    },
  });
  const candidates: Array<[string, () => Selection]> = [
    ["null record", () => ({ repositories: [defineRepository(null as never)] })],
    ["array record", () => ({ repositories: [defineRepository([] as never)] })],
    [
      "custom prototype",
      () => ({
        repositories: [defineRepository(Object.assign(Object.create({ inherited: true }), base))],
      }),
    ],
    ["accessor metadata", () => ({ repositories: [defineRepository(accessorInput)] })],
    ["empty name", () => ({ repositories: [defineRepository({ ...base, name: " " })] })],
    [
      "column hole",
      () => ({
        repositories: [
          defineRepository({ ...base, table: { ...base.table, columns: holes as never } }),
        ],
      }),
    ],
    [
      "column accessor",
      () => ({
        repositories: [
          defineRepository({
            ...base,
            table: { ...base.table, columns: accessorColumns as never },
          }),
        ],
      }),
    ],
    [
      "missing primary key",
      () => ({
        repositories: [defineRepository({ ...base, table: { ...base.table, columns: ["title"] } })],
      }),
    ],
    [
      "nonfunction hook",
      () => ({ repositories: [defineRepository({ ...base, hooks: { hydrateRow: 1 } as never })] }),
    ],
    [
      "invalid effect action",
      () => ({
        repositories: [defineRepository({ ...base, effects: [{ action: "publish" }] as never })],
      }),
    ],
    [
      "definition tuple hole",
      () => {
        const repositories = new Array<Definition>(2);
        repositories[0] = repository;
        return { repositories };
      },
    ],
    [
      "definition tuple accessor",
      () => {
        const repositories = [repository];
        Object.defineProperty(repositories, "0", {
          get() {
            effects++;
            return repository;
          },
        });
        return { repositories };
      },
    ],
  ];
  for (const [label, metadata] of [
    ["unknown model metadata", { unexpected: true }],
    ["nonarray fillable", { fillable: "title" }],
    ["nonfunction dehydration", { dehydrate: 1 }],
    ["invalid timestamps", { timestamps: "yes" }],
    ["unknown cast", { casts: { title: "unsupported" } }],
    ["unknown schema column", { fillable: ["outside_schema"] }],
  ] as const)
    candidates.push([
      label,
      () => ({
        repositories: [repository],
        models: [defineModel({ ...modelBase, attributes: metadata as never })],
      }),
    ]);
  try {
    for (const [index, [label, candidate]] of candidates.entries()) {
      const filename = join(directory, `${index}.sqlite`);
      let app: ReturnType<typeof createApplication> | undefined;
      try {
        await assert.rejects(
          async () => {
            const selection = candidate();
            app = createApplication({
              providers: [],
              services: createDatabaseBindings({
                default: "main",
                connections: { main: { driver: "sqlite", filename } },
                ...selection,
              }),
            });
            await app.start();
          },
          TypeError,
          label,
        );
      } finally {
        if (app) await app.stop();
      }
      assert.equal(existsSync(filename), false, `${label} must reject before native file creation`);
      assert.equal(effects, 0, `${label} must not execute metadata getters or constructors`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("public soft-delete metadata snapshots and duplicate repository identity checks are independent of constructors", () => {
  type SoftRow = { id: number; deleted_at: string | null };
  const storage = { column: "deleted_at" as "deleted_at" | "id" };
  const soft = defineRepository({
    name: "SoftNotes",
    table: defineTable<SoftRow, "id">({
      name: "soft_notes",
      primaryKey: "id",
      columns: ["id", "deleted_at"],
      softDeletes: storage,
    }),
    dependencies: [] as const,
    create: (binding) => new BaseRepository(binding),
  });
  storage.column = "id";
  assert.deepEqual(soft.table.softDeletes, { column: "deleted_at" });
  assert.equal(Object.isFrozen(soft.table.softDeletes), true);
  const first = definition("DuplicateNotes");
  const sameName = definition("DuplicateNotes");
  for (const repositories of [
    [first, first],
    [first, sameName],
  ])
    assert.throws(
      () =>
        createDatabaseBindings({
          default: "main",
          connections: { main: { driver: "sqlite", filename: ":memory:" } },
          repositories,
        }),
      /Duplicate repository definition/,
    );
});

test("registered repository factories cannot substitute a foreign selected binding or a plain object", async () => {
  let misplaced: BaseRepository<Row, "id"> | undefined;
  let constructions = 0;
  const proper = defineRepository({
    name: "ProperFactory",
    table: defineTable<Row, "id">({
      name: "factory_notes",
      primaryKey: "id",
      columns: ["id", "title"],
    }),
    dependencies: [] as const,
    create: (binding) => new BaseRepository(binding),
  });
  const wrong = defineRepository({
    name: "WrongFactory",
    table: proper.table,
    dependencies: [] as const,
    create() {
      constructions++;
      return present(misplaced);
    },
  });
  const shape = defineRepository({
    name: "PlainFactory",
    table: proper.table,
    dependencies: [] as const,
    create() {
      constructions++;
      return {} as BaseRepository<Row, "id">;
    },
  });
  const app = createApplication({
    providers: [],
    services: createDatabaseBindings({
      default: "main",
      connections: {
        main: { driver: "sqlite", filename: ":memory:" },
        other: { driver: "sqlite", filename: ":memory:" },
      },
      repositories: [proper, wrong, shape],
    }),
  });
  await app.start();
  try {
    await app.run(async (scope) => {
      const selected = scope.resolve(DATABASE_SESSION_TOKEN);
      misplaced = selected.connection("other").repository(proper);
      assert.throws(() => selected.repository(wrong), /wrong binding/);
      assert.throws(() => selected.repository(shape), /wrong binding/);
      assert.equal(constructions, 2);
      await selected.execute({
        text: "CREATE TABLE factory_notes(id INTEGER PRIMARY KEY,title TEXT)",
        params: [],
      });
      assert.deepEqual(
        await selected.repository(proper).create({ id: 1, title: "valid factory" }),
        { id: 1, title: "valid factory" },
      );
    });
  } finally {
    assert.equal((await app.stop()).successful, true);
  }
});
