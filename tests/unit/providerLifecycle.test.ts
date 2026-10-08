import { describe, expect, test } from "bun:test";
import { appContext, collectProviders, createAppContext } from "@getstrata/bootstrap/context";
import type { ServiceProvider } from "@getstrata/bootstrap/contracts";
import { CORE_HTTP_CLEANUP_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import { resolveApplicationConfig } from "@getstrata/core/runtime/applicationRegistry";

const base = () =>
  collectProviders([]).filter((provider) =>
    ["core.config", "core.cache", "core.storage"].includes(provider.name),
  );

describe("awaited provider lifecycle", () => {
  test("HTTP cleanup registration is scoped to each application context", async () => {
    const first = await createAppContext(base());
    const second = await createAppContext(base());
    let a = 0;
    let b = 0;
    first.container.resolve(CORE_HTTP_CLEANUP_TOKEN)(() => {
      a++;
    });
    second.container.resolve(CORE_HTTP_CLEANUP_TOKEN)(() => {
      b++;
    });
    await first.dispose();
    await first.dispose();
    expect([a, b]).toEqual([1, 0]);
    await second.dispose();
    expect([a, b]).toEqual([1, 1]);
    expect(() => first.container.resolve(CORE_HTTP_CLEANUP_TOKEN)(() => {})).toThrow("disposed");
  });

  test("delayed module registrations finish before any provider boots or context is published", async () => {
    const order: string[] = [];
    let release!: () => void;
    let entered!: () => void;
    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const starter: ServiceProvider = {
      name: "starter",
      register() {
        order.push("starter.register");
      },
      boot({ container }) {
        expect(container.resolve<string>("late.binding")).toBe("ready");
        order.push("starter.boot");
      },
    };
    const module: ServiceProvider = {
      name: "module",
      async register({ container, config }) {
        entered();
        await delayed;
        config.set("lifecycle.ready", true);
        container.set("late.binding", "ready");
        order.push("module.register");
      },
      async boot() {
        await Promise.resolve();
        order.push("module.boot");
      },
    };
    const pending = createAppContext([...base(), starter, module]);
    await started;
    expect(order).toEqual(["starter.register"]);
    let published = false;
    try {
      published = resolveApplicationConfig().get("lifecycle.ready") === true;
    } catch {
      /* no previously booted context */
    }
    expect(published).toBe(false);
    release();
    const context = await pending;
    expect(order).toEqual(["starter.register", "module.register", "starter.boot", "module.boot"]);
    expect(appContext.container).toBe(context.container);
    await context.dispose();
    expect(() => appContext.container).toThrow("Await createAppContext()");
    expect(() => resolveApplicationConfig()).toThrow("not been bootstrapped");
  });

  test("failed async registration cleans partial acquisitions in reverse order and does not boot", async () => {
    const order: string[] = [];
    const first: ServiceProvider = {
      name: "first",
      register({ onCleanup }) {
        onCleanup(async () => {
          await Promise.resolve();
          order.push("first.close");
        });
      },
      boot() {
        order.push("boot");
      },
    };
    const failing: ServiceProvider = {
      name: "failing",
      async register({ onCleanup }) {
        onCleanup(() => {
          order.push("failing.close");
        });
        await Promise.resolve();
        throw new Error("register failed");
      },
    };
    await expect(createAppContext([...base(), first, failing])).rejects.toThrow("register failed");
    expect(order).toEqual(["failing.close", "first.close"]);
    const retry = await createAppContext(base());
    await retry.dispose();
  });

  test("failed async boot cleans all registered resources, including providers not booted", async () => {
    const order: string[] = [];
    const first: ServiceProvider = {
      name: "first",
      register({ onCleanup }) {
        onCleanup(() => {
          order.push("first.close");
        });
      },
      async boot() {
        await Promise.resolve();
        throw new Error("boot failed");
      },
    };
    const second: ServiceProvider = {
      name: "second",
      register({ onCleanup }) {
        onCleanup(() => {
          order.push("second.close");
        });
      },
      boot() {
        order.push("second.boot");
      },
    };
    await expect(createAppContext([...base(), first, second])).rejects.toThrow("boot failed");
    expect(order).toEqual(["second.close", "first.close"]);
  });

  test("cleanup is awaited once, continues after failures and preserves the startup error", async () => {
    const order: string[] = [];
    const provider: ServiceProvider = {
      name: "resource",
      register({ onCleanup }) {
        onCleanup(() => {
          order.push("first.close");
        });
        onCleanup(async () => {
          await Promise.resolve();
          order.push("second.close");
          throw new Error("cleanup failed");
        });
      },
    };
    const context = await createAppContext([...base(), provider]);
    const results = await Promise.allSettled([context.dispose(), context.dispose()]);
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(order).toEqual(["second.close", "first.close"]);
    const failure: ServiceProvider = {
      ...provider,
      async boot() {
        throw new Error("startup failed");
      },
    };
    try {
      await createAppContext([...base(), failure]);
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).cause).toEqual(new Error("startup failed"));
    }
  });

  test("dependency validation failure unwinds resources and older context disposal cannot clear a newer one", async () => {
    let closed = 0;
    await expect(
      createAppContext([
        {
          name: "incomplete",
          register({ onCleanup }) {
            onCleanup(() => {
              closed++;
            });
          },
        },
      ]),
    ).rejects.toThrow('dependency "cache"');
    expect(closed).toBe(1);
    const first = await createAppContext(base());
    const second = await createAppContext(base());
    await first.dispose();
    expect(resolveApplicationConfig()).toBe(second.config);
    await second.dispose();
  });
});

test("HTTP startup rejects a delayed provider before socket admission and cleans its resource", async () => {
  const { mkdtemp, mkdir, rm, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const root = await mkdtemp(join(tmpdir(), "strata-provider-http-"));
  const directory = join(root, "probe");
  await mkdir(directory);
  await writeFile(
    join(directory, "index.ts"),
    `export default {
    name: "http-startup-probe",
    providers: [{ name: "delayed-probe",
      register({ onCleanup }) { globalThis.acquired++; onCleanup?.(() => { globalThis.closed++; }); },
      async boot() { await Bun.sleep(5); throw new Error("provider probe failed"); }
    }]
  };`,
  );
  const repo = join(import.meta.dir, "../..");
  const script = `
    import App from ${JSON.stringify(join(repo, "src/bootstrap/app.ts"))};
    import { configureModulesDirectory } from ${JSON.stringify(join(repo, "src/bootstrap/discoverModules.ts"))};
    import { closeDatabase } from ${JSON.stringify(join(repo, "src/db/connection/index.ts"))};
    configureModulesDirectory(${JSON.stringify(root)});
    globalThis.acquired = 0; globalThis.closed = 0;
    let bound = 0;
    Bun.serve = () => { bound++; throw new Error("unexpected socket admission"); };
    let failure;
    try { await new App().serve(); } catch (error) { failure = error.message; }
    await closeDatabase();
    console.log(JSON.stringify({ bound, acquired: globalThis.acquired, closed: globalThis.closed, failure }));
  `;
  try {
    const process = Bun.spawn(["bun", "-e", script], {
      cwd: repo,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...Bun.env,
        APP_ENV: "local",
        CACHE_DRIVER: "array",
        QUEUE_DRIVER: "sync",
        SCHEDULER_DRIVER: "disabled",
      },
    });
    const [output, errors, code] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    if (code !== 0) throw new Error(`Startup probe failed: ${errors}`);
    expect(JSON.parse(output.trim())).toEqual({
      bound: 0,
      acquired: 1,
      closed: 1,
      failure: "provider probe failed",
    });
  } finally {
    await rm(root, { recursive: true });
  }
});

test("provider flush completes once before any owned resource closes", async () => {
  const order: string[] = [];
  const context = await createAppContext([
    ...base(),
    {
      name: "telemetry",
      register({ onCleanup }) {
        onCleanup(() => {
          order.push("close");
        });
        onCleanup(async () => {
          await Bun.sleep(5);
          order.push("flush");
        }, "flush");
      },
    },
  ]);
  await Promise.all([context.flush(), context.flush()]);
  expect(order).toEqual(["flush"]);
  await Promise.all([context.dispose(), context.dispose()]);
  expect(order).toEqual(["flush", "close"]);
});

test("provider disposal drains before flushing and closing, even when registered out of order", async () => {
  const order: string[] = [];
  const context = await createAppContext([
    ...base(),
    {
      name: "runtime",
      register({ onCleanup }) {
        onCleanup(() => {
          order.push("close");
        });
        onCleanup(() => {
          order.push("flush");
        }, "flush");
        onCleanup(async () => {
          await Bun.sleep(5);
          order.push("drain");
        }, "drain");
      },
    },
  ]);
  await context.dispose();
  expect(order).toEqual(["drain", "flush", "close"]);
});

test("failed provider drain leaves infrastructure open instead of closing beneath live work", async () => {
  let closed = false;
  const context = await createAppContext([
    ...base(),
    {
      name: "runtime",
      register({ onCleanup }) {
        onCleanup(() => {
          closed = true;
        });
        onCleanup(() => {
          throw new Error("drain failed");
        }, "drain");
      },
    },
  ]);
  await expect(context.dispose()).rejects.toThrow("Provider drain failed");
  expect(closed).toBe(false);
});

test("direct disposal preserves application services until admitted work and telemetry finish", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reads: unknown[] = [];
  const context = await createAppContext([
    ...base(),
    {
      name: "runtime",
      register({ config, onCleanup }) {
        config.set("drain.active", "available");
        onCleanup(async () => {
          await gate;
          reads.push(resolveApplicationConfig().get<string>("drain.active"));
        }, "drain");
        onCleanup(() => {
          reads.push(resolveApplicationConfig().get<string>("drain.active"));
        }, "flush");
      },
    },
  ]);
  const disposal = context.dispose();
  expect(resolveApplicationConfig().get<string>("drain.active")).toBe("available");
  release();
  await disposal;
  expect(reads).toEqual(["available", "available"]);
  expect(() => resolveApplicationConfig()).toThrow("not been bootstrapped");
});
