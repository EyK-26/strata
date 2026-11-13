import { describe, expect, test } from "bun:test";
import { ServiceContainer } from "@getstrata/core/contracts/container";
import { createServiceToken } from "@getstrata/core/contracts/token";

describe("synchronous service factory dependency paths", () => {
  test.each(["singleton", "bind"] as const)("reports self resolution for %s", (registration) => {
    const container = new ServiceContainer();
    container[registration](Self, (services) => services.resolve(Self));
    expect(() => container.resolve(Self)).toThrow("Circular service dependency: self -> self.");
  });

  test("reports mixed singleton/transient cycles with the requesting path", () => {
    const container = new ServiceContainer();
    container.singleton(Root, (services) => services.get(First));
    container.bind(First, (services) => services.make(Second));
    container.singleton(Second, (services) => services.get(First));
    expect(() => container.get(Root)).toThrow(
      "Circular service dependency: root -> first -> second -> first.",
    );
    container.set(Second, "repaired");
    expect(container.get(Root)).toBe("repaired");
  });

  test("clears factory resolution state on failure without caching failures", () => {
    const container = new ServiceContainer();
    const failure = new Error("Dependency temporarily unavailable");
    let attempts = 0;
    container.singleton(Retry, () => {
      if (++attempts === 1) throw failure;
      return { ready: true };
    });
    expect(() => container.get(Retry)).toThrow(failure);
    const value = container.get(Retry);
    expect(container.get(Retry)).toBe(value);
    expect(attempts).toBe(2);
  });

  test("preserves acyclic singleton identity and transient factory behavior", () => {
    const container = new ServiceContainer();
    let attempts = 0;
    container.singleton(Shared, () => ({ shared: true }));
    container.bind(Transient, (services) => ({
      sequence: ++attempts,
      shared: services.get(Shared),
    }));
    const first = container.get<{ sequence: number; shared: object }>(Transient);
    const second = container.get<typeof first>(Transient);
    expect(first).not.toBe(second);
    expect([first.sequence, second.sequence]).toEqual([1, 2]);
    expect(first.shared).toBe(second.shared);
  });

  test("resolution paths belong to each container and retain undefined singleton values", () => {
    const first = new ServiceContainer();
    const second = new ServiceContainer();
    let attempts = 0;
    second.singleton(SharedKey, () => {
      attempts++;
      return undefined;
    });
    first.singleton(SharedKey, () => second.get(SharedKey));
    expect(first.get(SharedKey)).toBeUndefined();
    expect(first.get(SharedKey)).toBeUndefined();
    expect(attempts).toBe(1);
  });
});

const Self = createServiceToken<string>("self");
const Root = createServiceToken<string>("root");
const First = createServiceToken<string>("first");
const Second = createServiceToken<string>("second");
const Retry = createServiceToken<{ ready: boolean }>("retry");
const Shared = createServiceToken<{ shared: boolean }>("shared");
const Transient = createServiceToken<{ sequence: number; shared: object }>("transient");
const SharedKey = createServiceToken<undefined>("shared-key");

test("untyped string service keys reject before changing existing registrations", () => {
  const container = new ServiceContainer();
  const token = createServiceToken<number>("stable");
  container.set(token, 7);
  for (const operation of [
    () => container.set("legacy" as never, 1),
    () => container.singleton("legacy" as never, () => 1),
    () => container.bind("legacy" as never, () => 1),
    () => container.instance("legacy" as never, 1),
    () => container.initialize("legacy" as never, () => 1, new AbortController().signal),
    () => container.get("legacy" as never),
    () => container.resolve("legacy" as never),
    () => container.make("legacy" as never),
    () => container.has("legacy" as never),
    () => container.alias(token, "legacy" as never),
    () => container.alias<number>("legacy" as never, token),
  ]) {
    expect(operation).toThrow("Expected an opaque service token.");
    expect(container.resolve(token)).toBe(7);
  }
});
