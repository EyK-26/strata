import { describe, expect, test } from "bun:test";
import { ServiceContainer } from "@getstrata/core/contracts/container";

describe("synchronous service factory dependency paths", () => {
  test.each(["singleton", "bind"] as const)("reports self resolution for %s", (registration) => {
    const container = new ServiceContainer();
    container[registration]("self", (services) => services.resolve("self"));
    expect(() => container.resolve("self")).toThrow("Circular service dependency: self -> self.");
  });

  test("reports mixed singleton/transient cycles with the requesting path", () => {
    const container = new ServiceContainer();
    container.singleton("root", (services) => services.get("first"));
    container.bind("first", (services) => services.make("second"));
    container.singleton("second", (services) => services.get("first"));
    expect(() => container.get("root")).toThrow(
      "Circular service dependency: root -> first -> second -> first.",
    );
    container.set("second", "repaired");
    expect(container.get("root")).toBe("repaired");
  });

  test("clears factory resolution state on failure without caching failures", () => {
    const container = new ServiceContainer();
    const failure = new Error("Dependency temporarily unavailable");
    let attempts = 0;
    container.singleton("retry", () => {
      if (++attempts === 1) throw failure;
      return { ready: true };
    });
    expect(() => container.get("retry")).toThrow(failure);
    const value = container.get("retry");
    expect(container.get("retry")).toBe(value);
    expect(attempts).toBe(2);
  });

  test("preserves acyclic singleton identity and transient factory behavior", () => {
    const container = new ServiceContainer();
    let attempts = 0;
    container.singleton("shared", () => ({ shared: true }));
    container.bind("transient", (services) => ({
      sequence: ++attempts,
      shared: services.get("shared"),
    }));
    const first = container.get<{ sequence: number; shared: object }>("transient");
    const second = container.get<typeof first>("transient");
    expect(first).not.toBe(second);
    expect([first.sequence, second.sequence]).toEqual([1, 2]);
    expect(first.shared).toBe(second.shared);
  });

  test("resolution paths belong to each container and retain undefined singleton values", () => {
    const first = new ServiceContainer();
    const second = new ServiceContainer();
    let attempts = 0;
    second.singleton("shared-key", () => {
      attempts++;
      return undefined;
    });
    first.singleton("shared-key", () => second.get("shared-key"));
    expect(first.get("shared-key")).toBeUndefined();
    expect(first.get("shared-key")).toBeUndefined();
    expect(attempts).toBe(1);
  });
});
