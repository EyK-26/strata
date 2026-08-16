import { describe, expect, test } from "bun:test";
import { Factory } from "@getstrata/core/database/factory";
import { userFactory } from "../../src/modules/user/factory";

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
});
