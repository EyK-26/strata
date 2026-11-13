import { describe, expect, test } from "bun:test";
import {
  ConfigStore,
  createServiceToken,
  ServiceContainer,
} from "@getstrata/core/contracts/container";
import {
  assertAppDependenciesComplete,
  resolveService,
  type ServiceProvider,
} from "@getstrata/core/contracts/di";
import type { PersistenceInvocation } from "@getstrata/core/contracts/persistence";

const invoke: PersistenceInvocation = async () => {
  throw new Error("Persistence is not used by this contract fixture.");
};

describe("@getstrata/core contracts", () => {
  test("ServiceContainer resolves singleton and transient bindings", () => {
    const container = new ServiceContainer();
    let singletonCount = 0;
    let transientCount = 0;

    container.singleton(Singleton, () => {
      singletonCount += 1;
      return { marker: singletonCount };
    });
    container.bind(Transient, () => {
      transientCount += 1;
      return { marker: transientCount };
    });

    expect(container.resolve<{ marker: number }>(Singleton)).toEqual({ marker: 1 });
    expect(container.make<{ marker: number }>(Singleton)).toEqual({ marker: 1 });
    expect(container.resolve<{ marker: number }>(Transient)).toEqual({ marker: 1 });
    expect(container.resolve<{ marker: number }>(Transient)).toEqual({ marker: 2 });
    expect(container.instance(Demo, "value")).toBe("value");
    expect(container.make<string>(Demo)).toBe("value");
  });

  test("typed tokens preserve opaque identity and binding lifecycle", () => {
    const container = new ServiceContainer();
    const token = createServiceToken<{ count: number }>("typed.counter");
    expect(Object.isFrozen(token)).toBe(true);
    expect(createServiceToken<{ count: number }>("typed.counter")).not.toBe(token);
    let calls = 0;
    container.singleton(token, () => ({ count: ++calls }));
    expect(container.has(token)).toBe(true);
    expect(container.get(token)).toBe(container.resolve(token));
    expect(calls).toBe(1);
    container.bind(token, () => ({ count: ++calls }));
    expect(container.make(token).count).toBe(2);
    expect(container.resolve(token).count).toBe(3);
    const instance = { count: 10 };
    expect(container.instance(token, instance)).toBe(instance);
    expect(container.resolve(token)).toBe(instance);
    const sameName = createServiceToken<{ count: number }>("typed.counter");
    container.set(sameName, { count: 11 });
    expect(container.resolve(token).count).toBe(10);
    expect(container.resolve(sameName).count).toBe(11);
    const dependencies = { container, invoke, cache: {} as never, storage: {} as never };
    expect(resolveService(dependencies, token).count).toBe(10);
    expect(() => container.resolve(createServiceToken<number>("missing"))).toThrow(
      'Service "missing" is not registered.',
    );
    expect(() => createServiceToken("   ")).toThrow(
      "Service token name must be a nonempty string.",
    );
  });

  test("assertAppDependenciesComplete requires cache and storage", () => {
    const container = new ServiceContainer();
    const dependencies = { container, invoke } as never;

    expect(() => assertAppDependenciesComplete(dependencies)).toThrow(
      'Required dependency "cache" is not registered.',
    );
  });

  test("dependency validation rejects missing or malformed invocation before certifying a complete app", () => {
    const base = { container: new ServiceContainer(), cache: {} as never, storage: {} as never };
    expect(() => assertAppDependenciesComplete(base)).toThrow(
      'Required dependency "invoke" is not registered.',
    );
    expect(() => assertAppDependenciesComplete({ ...base, invoke: null } as never)).toThrow(
      "Application persistence invocation must be a function.",
    );
    expect(() => assertAppDependenciesComplete({ ...base, invoke })).not.toThrow();
  });

  test("resolveService reads from the app dependency container", () => {
    const container = new ServiceContainer();
    container.set(Demo, "value");

    expect(
      resolveService<string>(
        {
          container,
          invoke,
          cache: {} as never,
          storage: {} as never,
        },
        Demo,
      ),
    ).toBe("value");
  });

  test("ConfigStore stores and requires config keys", () => {
    const config = new ConfigStore();
    config.set("app.port", 3000);

    expect(config.get<number>("app.port")).toBe(3000);
    expect(() => config.getRequired<string>("missing")).toThrow(
      'Config key "missing" is not defined.',
    );
  });

  test("ServiceProvider type accepts register and boot hooks", () => {
    const provider: ServiceProvider = {
      name: "demo.provider",
      register({ config }) {
        config.set("demo", true);
      },
    };

    const container = new ServiceContainer();
    const config = new ConfigStore();
    provider.register?.({
      container,
      config,
      invoke,
      dependencies: { container, invoke },
      onCleanup() {},
    });

    expect(config.has("demo")).toBe(true);
    expect(config.getRequired<boolean>("demo")).toBe(true);
  });
});

const Singleton = createServiceToken<{ marker: number }>("singleton");
const Transient = createServiceToken<{ marker: number }>("transient");
const Demo = createServiceToken<string>("demo");
