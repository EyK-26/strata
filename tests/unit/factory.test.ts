import { describe, expect, test } from "bun:test";
import { Factory } from "@getstrata/core/database/factory";

class WidgetFactory extends Factory<{ id: number; name: string }> {
  protected override definition() {
    return { id: 1, name: "Widget" };
  }
}

describe("Factory", () => {
  test("merges defaults with overrides in make()", () => {
    const factory = new WidgetFactory();

    expect(factory.make()).toEqual({ id: 1, name: "Widget" });
    expect(factory.make({ name: "Custom" })).toEqual({ id: 1, name: "Custom" });
  });

  test("throws when the base factory definition is not implemented", () => {
    expect(() => new (class extends Factory<{ value: number }> {})().make()).toThrow(
      "Factory definition must be implemented by subclass.",
    );
  });

  test("instantiates the base factory class", () => {
    const BaseFactory = Factory as unknown as new () => Factory<{ name: string }>;
    const factory = new BaseFactory();

    expect(() => factory.make()).toThrow("Factory definition must be implemented by subclass.");
    expect(() => factory.make({ name: "ignored" })).toThrow(
      "Factory definition must be implemented by subclass.",
    );
  });

  test("create() persists make() and strips a placeholder id", async () => {
    const inserted: Array<Partial<{ id?: number | null; name: string }>> = [];

    class PersistFactory extends Factory<{ id?: number | null; name: string }> {
      protected override definition() {
        return { id: 0, name: "Widget" };
      }

      protected override async persist(values: Partial<{ id?: number | null; name: string }>) {
        inserted.push(values);
        return { id: values.id ?? 42, name: values.name ?? "Widget" };
      }
    }

    const factory = new PersistFactory();
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

    class NoIdFactory extends Factory<{ id?: number; name: string }> {
      protected override definition() {
        return { name: "Anon" };
      }

      protected override async persist(values: Partial<{ id?: number; name: string }>) {
        inserted.push(values);
        return { id: 1, name: values.name ?? "Anon" };
      }
    }

    await new NoIdFactory().create();
    expect(inserted).toEqual([{ name: "Anon" }]);
  });

  test("count/state/sequence/for/has match Laravel factory design", async () => {
    const inserted: Array<Record<string, unknown>> = [];

    class PostFactory extends Factory<{ id?: number; user_id?: number; title: string }> {
      protected override definition() {
        return { id: 0, title: "Draft" };
      }

      protected override async persist(
        values: Partial<{ id?: number; user_id?: number; title: string }>,
      ) {
        inserted.push(values);
        return { id: inserted.length, title: values.title ?? "Draft", user_id: values.user_id };
      }
    }

    class AuthorFactory extends Factory<{ id?: number; name: string; role: string }> {
      protected override definition() {
        return { id: 0, name: "Author", role: "member" };
      }

      protected override async persist(
        values: Partial<{ id?: number; name: string; role: string }>,
      ) {
        return { id: 99, name: values.name ?? "Author", role: values.role ?? "member" };
      }
    }

    expect(new AuthorFactory().state({ role: "admin" }).make()).toEqual({
      id: 0,
      name: "Author",
      role: "admin",
    });
    expect(new AuthorFactory().state((record) => ({ name: `${record.name} Jr` })).make()).toEqual({
      id: 0,
      name: "Author Jr",
      role: "member",
    });

    const sequenced = new AuthorFactory().sequence({ name: "A" }, (index) => ({
      name: `B${index}`,
    }));
    expect(sequenced.make()).toEqual({ id: 0, name: "A", role: "member" });
    expect(sequenced.make()).toEqual({ id: 0, name: "B1", role: "member" });

    const counted = new AuthorFactory().count(2).make({ role: "admin" });
    expect(Array.isArray(counted)).toBe(true);
    expect(counted).toHaveLength(2);

    const createdMany = await new AuthorFactory().count(2).create();
    expect(Array.isArray(createdMany)).toBe(true);
    expect(createdMany).toHaveLength(2);

    const child = await new PostFactory().for({ id: 7 }, "user_id").create();
    expect(child).toEqual({ id: 1, title: "Draft", user_id: 7 });

    inserted.length = 0;
    await new AuthorFactory().has(new PostFactory().count(2), "user_id").create();
    expect(inserted).toHaveLength(2);
    expect(inserted[0]?.user_id).toBe(99);

    expect(() => new AuthorFactory().count(0)).toThrow("positive integer");
    expect(() => new AuthorFactory().sequence()).toThrow("at least one");
    expect(() => new PostFactory().for({}, "user_id")).toThrow("parent with an id");
    expect(() => new PostFactory().for({ id: null }, "user_id")).toThrow("parent with an id");

    const made: string[] = [];
    const created: string[] = [];
    new AuthorFactory()
      .afterMaking((record) => {
        made.push(record.name);
      })
      .make();
    expect(made).toEqual(["Author"]);
    await new AuthorFactory()
      .afterCreating((record) => {
        created.push(record.name);
      })
      .create();
    expect(created).toEqual(["Author"]);
    expect(new PostFactory().recycle({ id: 3 }, "user_id").make()).toEqual({
      id: 0,
      title: "Draft",
      user_id: 3,
    });
  });

  test("count() does not mutate the original factory singleton", () => {
    const factory = new WidgetFactory();
    expect(factory.count(3).make()).toHaveLength(3);
    expect(factory.make()).toEqual({ id: 1, name: "Widget" });
  });

  test("create() throws when persist() is not implemented", async () => {
    class MemoryOnlyFactory extends Factory<{ id: number; name: string }> {
      protected override definition() {
        return { id: 0, name: "Widget" };
      }
    }

    await expect(new MemoryOnlyFactory().create()).rejects.toThrow(
      "Factory.persist() must be implemented to use create().",
    );
  });
});
