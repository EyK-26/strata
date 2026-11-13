import { describe, expect, test } from "bun:test";
import { defineFactory, Factory } from "@getstrata/core/database/factory";

const WidgetFactory = () =>
  Factory.from(
    defineFactory<{ id: number; name: string }>({
      construct: () => ({
        definition() {
          return { id: 1, name: "Widget" };
        },
      }),
    }),
  );

describe("Factory", () => {
  test("merges defaults with overrides in make()", () => {
    const factory = WidgetFactory();

    expect(factory.make()).toEqual({ id: 1, name: "Widget" });
    expect(factory.make({ name: "Custom" })).toEqual({ id: 1, name: "Custom" });
  });

  test("constructs behavior with the exact explicit dependencies", () => {
    const dependencies = { name: "injected" };
    const definition = defineFactory({
      construct: (selected: typeof dependencies) => ({
        definition: () => ({ name: selected.name }),
      }),
    });
    expect(Factory.from(definition, dependencies).make()).toEqual({ name: "injected" });
  });

  test("preserves construction failures without manufacturing an instance", () => {
    const original = new Error("construction failed");
    const definition = defineFactory<{ name: string }>({
      construct: () => {
        throw original;
      },
    });
    let observed: unknown;
    try {
      Factory.from(definition);
    } catch (error) {
      observed = error;
    }
    expect(observed).toBe(original);
  });

  test("create() persists make() and strips a placeholder id", async () => {
    const inserted: Array<Partial<{ id?: number | null; name: string }>> = [];

    const PersistFactory = () =>
      Factory.from(
        defineFactory<{ id?: number | null; name: string }>({
          construct: () => ({
            definition() {
              return { id: 0, name: "Widget" };
            },

            async persist(values: Partial<{ id?: number | null; name: string }>) {
              inserted.push(values);
              return { id: values.id ?? 42, name: values.name ?? "Widget" };
            },
          }),
        }),
      );

    const factory = PersistFactory();
    const created = await factory.create({ name: "Custom" });

    expect(created).toEqual({ id: 42, name: "Custom" });
    expect(inserted[0]).toEqual({ name: "Custom" });
    expect(await factory.create({ id: null, name: "NoId" })).toEqual({ id: 42, name: "NoId" });
    expect(inserted[1]).toEqual({ name: "NoId" });
    expect(await factory.create({ id: 7, name: "Kept" })).toEqual({ id: 7, name: "Kept" });
    expect(inserted[2]).toEqual({ id: 7, name: "Kept" });
  });

  test("create() omits an undefined id from the persist payload", async () => {
    const inserted: Array<Partial<{ id?: number; name: string }>> = [];

    const NoIdFactory = () =>
      Factory.from(
        defineFactory<{ id?: number; name: string }>({
          construct: () => ({
            definition() {
              return { name: "Anon" };
            },

            async persist(values: Partial<{ id?: number; name: string }>) {
              inserted.push(values);
              return { id: 1, name: values.name ?? "Anon" };
            },
          }),
        }),
      );

    await NoIdFactory().create();
    expect(inserted).toEqual([{ name: "Anon" }]);
  });

  test("count/state/sequence/for/has compose factory definitions", async () => {
    const inserted: Array<Record<string, unknown>> = [];

    const PostFactory = () =>
      Factory.from(
        defineFactory<{ id?: number; user_id?: number; title: string }>({
          construct: () => ({
            definition() {
              return { id: 0, title: "Draft" };
            },

            async persist(values: Partial<{ id?: number; user_id?: number; title: string }>) {
              inserted.push(values);
              return {
                id: inserted.length,
                title: values.title ?? "Draft",
                user_id: values.user_id,
              };
            },
          }),
        }),
      );

    const AuthorFactory = () =>
      Factory.from(
        defineFactory<{ id?: number; name: string; role: string }>({
          construct: () => ({
            definition() {
              return { id: 0, name: "Author", role: "member" };
            },

            async persist(values: Partial<{ id?: number; name: string; role: string }>) {
              return { id: 99, name: values.name ?? "Author", role: values.role ?? "member" };
            },
          }),
        }),
      );

    expect(AuthorFactory().state({ role: "admin" }).make()).toEqual({
      id: 0,
      name: "Author",
      role: "admin",
    });
    expect(
      AuthorFactory()
        .state((record) => ({ name: `${record.name} Jr` }))
        .make(),
    ).toEqual({
      id: 0,
      name: "Author Jr",
      role: "member",
    });

    const sequenced = AuthorFactory().sequence({ name: "A" }, (index) => ({
      name: `B${index}`,
    }));
    expect(sequenced.make()).toEqual({ id: 0, name: "A", role: "member" });
    expect(sequenced.make()).toEqual({ id: 0, name: "B1", role: "member" });

    const counted = AuthorFactory().count(2).make({ role: "admin" });
    expect(Array.isArray(counted)).toBe(true);
    expect(counted).toHaveLength(2);

    const createdMany = await AuthorFactory().count(2).create();
    expect(Array.isArray(createdMany)).toBe(true);
    expect(createdMany).toHaveLength(2);

    const child = await PostFactory().for({ id: 7 }, "user_id").create();
    expect(child).toEqual({ id: 1, title: "Draft", user_id: 7 });

    inserted.length = 0;
    await AuthorFactory().has(PostFactory().count(2), "user_id").create();
    expect(inserted).toHaveLength(2);
    expect(inserted[0]?.user_id).toBe(99);

    expect(() => AuthorFactory().count(0)).toThrow("positive integer");
    expect(() => AuthorFactory().sequence()).toThrow("at least one");
    expect(() => PostFactory().for({}, "user_id")).toThrow("parent with an id");
    expect(() => PostFactory().for({ id: null }, "user_id")).toThrow("parent with an id");

    const made: string[] = [];
    const created: string[] = [];
    AuthorFactory()
      .afterMaking((record) => {
        made.push(record.name);
      })
      .make();
    expect(made).toEqual(["Author"]);
    await AuthorFactory()
      .afterCreating((record) => {
        created.push(record.name);
      })
      .create();
    expect(created).toEqual(["Author"]);
    expect(PostFactory().recycle({ id: 3 }, "user_id").make()).toEqual({
      id: 0,
      title: "Draft",
      user_id: 3,
    });
  });

  test("count() does not mutate the original factory singleton", () => {
    const factory = WidgetFactory();
    expect(factory.count(3).make()).toHaveLength(3);
    expect(factory.make()).toEqual({ id: 1, name: "Widget" });
  });

  test("create() throws when persist() is not implemented", async () => {
    const MemoryOnlyFactory = () =>
      Factory.from(
        defineFactory<{ id: number; name: string }>({
          construct: () => ({
            definition() {
              return { id: 0, name: "Widget" };
            },
          }),
        }),
      );

    await expect(MemoryOnlyFactory().create()).rejects.toThrow(
      "Factory.persist() must be supplied to use create().",
    );
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("real private behavior and explicit nonzero state survive every independent builder branch", async () => {
  type Row = { id: number; name: string; serial: number; sequence?: number; parent_id?: number };
  type State = { serial: number };
  const writes: Array<Partial<Row>> = [];
  const dependencies = { prefix: "owned-", writes };
  class Behavior {
    #state: State;
    #dependencies: typeof dependencies;
    constructor(state: State, selected: typeof dependencies) {
      this.#state = state;
      this.#dependencies = selected;
    }
    definition(): Row {
      const serial = this.#state.serial++;
      return { id: 0, name: `${this.#dependencies.prefix}${serial}`, serial };
    }
    async persist(values: Partial<Row>): Promise<Row> {
      this.#dependencies.writes.push(values);
      return { id: 17, name: values.name ?? "", serial: values.serial ?? -1, ...values };
    }
  }
  const definition = defineFactory<Row, typeof dependencies, State>({
    initialState: () => ({ serial: 0 }),
    forkState: (state) => ({ serial: state.serial }),
    construct: (state, selected) => new Behavior(state, selected),
  });
  const base = Factory.from(definition, dependencies).sequence((index) => ({ sequence: index }));
  expect(base.make()).toEqual({ id: 0, name: "owned-0", serial: 0, sequence: 0 });
  const child = WidgetFactory();
  const branches = [
    base.count(1),
    base.state({ name: "state" }),
    base.sequence({ sequence: 99 }),
    base.for({ id: 3 }, "parent_id"),
    base.recycle({ id: 4 }, "parent_id"),
    base.afterMaking((record) => {
      record.name = "callback";
    }),
    base.afterCreating(async () => {}),
    base.has(child, "id"),
  ];
  for (const [index, branch] of branches.entries()) {
    const made = branch.make();
    const row = Array.isArray(made) ? made[0] : made;
    expect(row?.serial).toBe(1);
    expect(row?.sequence).toBe(index === 2 ? 99 : 1);
  }
  expect(base.make()).toEqual({ id: 0, name: "owned-1", serial: 1, sequence: 1 });
  const created = await base.state({ name: "persisted" }).create();
  expect(created).toEqual({ id: 17, name: "persisted", serial: 2, sequence: 2 });
  expect(writes).toEqual([{ name: "persisted", serial: 2, sequence: 2 }]);
});

test("literal patches and parent ids are snapshotted and merge precedence is deliberate", () => {
  const state = { name: "state" };
  const sequence = { name: "sequence" };
  const parent = { id: 5 };
  const base = Factory.from(
    defineFactory({
      construct: () => ({ definition: () => ({ id: 0, name: "definition", parent_id: 0 }) }),
    }),
  );
  const branch = base
    .state(state)
    .state((row) => ({ name: `${row.name}-transform` }))
    .sequence(sequence)
    .for(parent, "parent_id")
    .afterMaking((row) => {
      row.name += "-callback";
    });
  state.name = "changed";
  sequence.name = "changed";
  parent.id = 99;
  expect(branch.make({ name: "override" })).toEqual({
    id: 0,
    name: "override-callback",
    parent_id: 5,
  });
  expect(branch.make()).toEqual({ id: 0, name: "sequence-callback", parent_id: 5 });
  expect(base.make()).toEqual({ id: 0, name: "definition", parent_id: 0 });
  expect(
    base
      .state(state)
      .state((row) => ({ name: `${row.name}-transform` }))
      .make().name,
  ).toBe("changed-transform");
  expect(() => base.for({ id: 1 })).toThrow("requires a foreign key or a parent Model");
});

test("has captures child state and cursor at registration and each parent forks that snapshot", async () => {
  const inserted: Array<{ serial: number; sequence: number; parent_id?: number }> = [];
  const childDefinition = defineFactory({
    initialState: () => ({ serial: 0 }),
    forkState: (state: Readonly<{ serial: number }>) => ({ serial: state.serial }),
    construct: (state: { serial: number }, _: undefined) => ({
      definition: () => ({ serial: state.serial++, sequence: -1, parent_id: 0 }),
      persist: async (row: Partial<{ serial: number; sequence: number; parent_id: number }>) => {
        const created = {
          serial: row.serial ?? -1,
          sequence: row.sequence ?? -1,
          parent_id: row.parent_id,
        };
        inserted.push(created);
        return { ...created, parent_id: created.parent_id ?? 0 };
      },
    }),
  });
  const child = Factory.from(childDefinition).sequence((index) => ({ sequence: index }));
  child.make();
  const parent = Factory.from(
    defineFactory({
      construct: () => ({
        definition: () => ({ id: 1 }),
        persist: async () => ({ id: 7 }),
      }),
    }),
  ).has(child.count(2), "parent_id");
  child.make();
  child.make();
  expect(inserted).toEqual([]);
  parent.make();
  expect(inserted).toEqual([]);
  await parent.count(2).create();
  expect(inserted).toEqual([
    { serial: 1, sequence: 1, parent_id: 7 },
    { serial: 2, sequence: 2, parent_id: 7 },
    { serial: 1, sequence: 1, parent_id: 7 },
    { serial: 2, sequence: 2, parent_id: 7 },
  ]);
});

test("child writes start concurrently and parent rejection joins a delayed sibling before skipping afterCreating", async () => {
  const delayed = deferred<void>();
  const started = deferred<void>();
  const original = new Error("first child failed");
  const events: string[] = [];
  const child = (persist: () => Promise<{ id: number; parent_id: number }>) =>
    Factory.from(
      defineFactory({
        construct: () => ({
          definition: () => ({ id: 0, parent_id: 0 }),
          persist,
        }),
      }),
    );
  const parent = Factory.from(
    defineFactory({
      construct: () => ({
        definition: () => ({ id: 0 }),
        persist: async () => ({ id: 7 }),
      }),
    }),
  )
    .has(
      child(async () => {
        events.push("early");
        throw original;
      }),
      "parent_id",
    )
    .has(
      child(async () => {
        events.push("delayed-start");
        started.resolve();
        await delayed.promise;
        events.push("delayed-done");
        return { id: 2, parent_id: 7 };
      }),
      "parent_id",
    )
    .afterCreating(() => {
      events.push("afterCreating");
    });
  let settled = false;
  const outcome = parent.create().then(
    () => {
      settled = true;
      return { ok: true as const };
    },
    (error) => {
      settled = true;
      return { ok: false as const, error };
    },
  );
  try {
    await started.promise;
    // Let an early rejection traverse the complete parent promise chain.
    await Bun.sleep(0);
    expect(events).toEqual(["early", "delayed-start"]);
    expect(settled).toBe(false);
  } finally {
    delayed.resolve();
    await outcome;
  }
  const result = await outcome;
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toBe(original);
  expect(events).toEqual(["early", "delayed-start", "delayed-done"]);
});

for (const reason of [undefined, null, false, 0, ""]) {
  test(`one child failure preserves its exact falsy reason ${String(reason)}`, async () => {
    const child = Factory.from(
      defineFactory({
        construct: () => ({
          definition: () => ({ parent_id: 0 }),
          persist: async () => {
            throw reason;
          },
        }),
      }),
    );
    const parent = Factory.from(
      defineFactory({
        construct: () => ({
          definition: () => ({ id: 0 }),
          persist: async () => ({ id: 1 }),
        }),
      }),
    ).has(child, "parent_id");
    const result = await parent.create().then(
      () => ({ ok: true as const }),
      (error) => ({ ok: false as const, error }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(reason);
  });
}

test("multiple child failures preserve registration order, repeated occurrences and falsy reasons", async () => {
  const delayed = deferred<void>();
  const reasons = [undefined, false, false, 0];
  const children = reasons.map((reason, index) =>
    Factory.from(
      defineFactory({
        construct: () => ({
          definition: () => ({ parent_id: 0 }),
          persist: async () => {
            if (index === 0) await delayed.promise;
            throw reason;
          },
        }),
      }),
    ),
  );
  let parent = Factory.from(
    defineFactory({
      construct: () => ({
        definition: () => ({ id: 0 }),
        persist: async () => ({ id: 1 }),
      }),
    }),
  );
  for (const child of children) parent = parent.has(child, "parent_id");
  const outcome = parent.create().then(
    () => undefined,
    (error) => error,
  );
  delayed.resolve();
  const error = await outcome;
  expect(error).toBeInstanceOf(AggregateError);
  expect((error as AggregateError).errors).toEqual(reasons);
});

test("all child associations are prepared before any write", async () => {
  const writes: string[] = [];
  const child = Factory.from(
    defineFactory({
      construct: () => ({
        definition: () => ({ parent_id: 0 }),
        persist: async () => {
          writes.push("child");
          return { parent_id: 1 };
        },
      }),
    }),
  );
  const parent = Factory.from(
    defineFactory({
      construct: () => ({
        definition: () => ({ id: 0 }),
        persist: async () => ({ id: 1 }),
      }),
    }),
  )
    .has(child, "parent_id")
    .has(child);
  await expect(parent.create()).rejects.toThrow("requires a foreign key or a parent Model");
  expect(writes).toEqual([]);
});

test("afterCreating callbacks are awaited in order and preserve synchronous failures", async () => {
  const callback = deferred<void>();
  const entered = deferred<void>();
  const events: string[] = [];
  const base = Factory.from(
    defineFactory({
      construct: () => ({
        definition: () => ({ id: 0 }),
        persist: async () => ({ id: 1 }),
      }),
    }),
  );
  const outcome = base
    .afterCreating(async () => {
      events.push("first-start");
      entered.resolve();
      await callback.promise;
      events.push("first-done");
    })
    .afterCreating(() => {
      events.push("second");
    })
    .create();
  await entered.promise;
  expect(events).toEqual(["first-start"]);
  callback.resolve();
  await outcome;
  expect(events).toEqual(["first-start", "first-done", "second"]);
  const original = new Error("making failed");
  const branch = base.afterMaking(() => {
    throw original;
  });
  expect(() => branch.make()).toThrow(original);
  await expect(branch.create()).rejects.toBe(original);
});

test("a failed user-state fork leaves the source core cursor unchanged", () => {
  const original = new Error("fork failed");
  let rejectFork = false;
  const definition = defineFactory({
    initialState: () => ({ serial: 0 }),
    forkState: (state: Readonly<{ serial: number }>) => {
      if (rejectFork) throw original;
      return { serial: state.serial };
    },
    construct: (state: { serial: number }, _: undefined) => ({
      definition: () => ({ serial: state.serial++, sequence: -1 }),
    }),
  });
  const source = Factory.from(definition).sequence((index) => ({ sequence: index }));
  expect(source.make()).toEqual({ serial: 0, sequence: 0 });
  rejectFork = true;
  let observed: unknown;
  try {
    source.count(2);
  } catch (error) {
    observed = error;
  }
  expect(observed).toBe(original);
  expect(source.make()).toEqual({ serial: 1, sequence: 1 });
});
