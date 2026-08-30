import { describe, expect, test } from "bun:test";
import { Factory } from "@getstrata/core/database/factory";
import { runWithTenantDatabase } from "@getstrata/core/tenant/tenantDatabaseScope";
import { userFactory } from "../../src/modules/user/factory";
import UserRepository from "../../src/modules/user/repository";
import { defaultTestTenant } from "./testHelpers";

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

describe("UserFactory", () => {
  test("builds overridable user records", () => {
    const user = userFactory.make({
      name: "Taylor",
      role: "admin",
    });

    expect(user.name).toBe("Taylor");
    expect(user.role).toBe("admin");
    expect(user.email).toContain("@workhub.test");
  });

  test("create persists an insertable user row", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const created = await userFactory.create({ name: "Persisted Factory User" });

      expect(created.id).toBeGreaterThan(0);
      expect(created.name).toBe("Persisted Factory User");
      expect(created.email).toContain("@workhub.test");

      const found = await new UserRepository().findById(created.id);
      expect(found?.name).toBe("Persisted Factory User");
    });
  });
});
