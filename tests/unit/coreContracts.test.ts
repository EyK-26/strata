import { describe, expect, test } from "bun:test";
import { ConfigStore, ServiceContainer } from "@getstrata/core/contracts/container";
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
    expect(container.resolve<{ marker: number }>("singleton")).toEqual({ marker: 1 });
    expect(container.resolve<{ marker: number }>("transient")).toEqual({ marker: 1 });
    expect(container.resolve<{ marker: number }>("transient")).toEqual({ marker: 2 });
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
    provider.register?.({ container, config, dependencies: { container } });

    expect(config.has("demo")).toBe(true);
    expect(config.require<boolean>("demo")).toBe(true);
  });
});
