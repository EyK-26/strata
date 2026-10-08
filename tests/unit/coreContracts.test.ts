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

describe("@getstrata/core contracts", () => {
  test("ServiceContainer resolves singleton and transient bindings", () => {
    const container = new ServiceContainer();
    let singletonCount = 0;
    let transientCount = 0;

    container.singleton("singleton", () => {
      singletonCount += 1;
      return { marker: singletonCount };
    });
    container.bind("transient", () => {
      transientCount += 1;
      return { marker: transientCount };
    });

    expect(container.resolve<{ marker: number }>("singleton")).toEqual({ marker: 1 });
    expect(container.make<{ marker: number }>("singleton")).toEqual({ marker: 1 });
    expect(container.resolve<{ marker: number }>("transient")).toEqual({ marker: 1 });
    expect(container.resolve<{ marker: number }>("transient")).toEqual({ marker: 2 });
    expect(container.instance("demo", "value")).toBe("value");
    expect(container.make<string>("demo")).toBe("value");
  });

  test("typed tokens preserve string identity and binding lifecycle", () => {
    const container = new ServiceContainer();
    const token = createServiceToken<{ count: number }>("typed.counter");
    expect(String(token)).toBe("typed.counter");
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
    container.set("typed.counter", { count: 11 });
    expect(container.resolve(token).count).toBe(11);
    const dependencies = { container, cache: {} as never, storage: {} as never };
    expect(resolveService(dependencies, token).count).toBe(11);
    expect(() => container.resolve(createServiceToken<number>("missing"))).toThrow(
      'Service "missing" is not registered.',
    );
    expect(() => createServiceToken("   ")).toThrow("Service token key must not be empty.");
  });

  test("assertAppDependenciesComplete requires cache and storage", () => {
    const container = new ServiceContainer();
    const dependencies = { container } as never;

    expect(() => assertAppDependenciesComplete(dependencies)).toThrow(
      'Required dependency "cache" is not registered.',
    );
  });

  test("resolveService reads from the app dependency container", () => {
    const container = new ServiceContainer();
    container.set("demo", "value");

    expect(
      resolveService<string>(
        {
          container,
          cache: {} as never,
          storage: {} as never,
        },
        "demo",
      ),
    ).toBe("value");
  });

  test("ConfigStore stores and requires config keys", () => {
    const config = new ConfigStore();
    config.set("app.port", 3000);

    expect(config.get<number>("app.port")).toBe(3000);
    expect(() => config.require<string>("missing")).toThrow('Config key "missing" is not defined.');
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
    provider.register?.({ container, config, dependencies: { container }, onCleanup() {} });

    expect(config.has("demo")).toBe(true);
    expect(config.require<boolean>("demo")).toBe(true);
  });
});
