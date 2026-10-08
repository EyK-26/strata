import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  installGracefulShutdownSignals,
  LifecycleCoordinator,
  registerShutdownHandler,
  resetGracefulShutdownForTests,
  runGracefulShutdown,
} from "@getstrata/core/lifecycle/gracefulShutdown";

afterEach(() => {
  resetGracefulShutdownForTests();
});

describe("gracefulShutdown", () => {
  test("runs registered handlers in registration order", async () => {
    resetGracefulShutdownForTests();
    const order: string[] = [];

    registerShutdownHandler("first", async () => {
      order.push("first");
    });
    registerShutdownHandler("second", async () => {
      order.push("second");
    });

    await runGracefulShutdown("TEST");

    expect(order).toEqual(["first", "second"]);
  });

  test("ignores duplicate shutdown requests", async () => {
    resetGracefulShutdownForTests();
    let calls = 0;

    registerShutdownHandler("once", async () => {
      calls += 1;
    });

    await Promise.all([runGracefulShutdown("TEST"), runGracefulShutdown("TEST")]);

    expect(calls).toBe(1);
  });

  test("continues running handlers when one fails", async () => {
    resetGracefulShutdownForTests();
    const order: string[] = [];
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    registerShutdownHandler("broken", async () => {
      throw new Error("shutdown failed");
    });
    registerShutdownHandler("after", async () => {
      order.push("after");
    });

    await runGracefulShutdown("TEST");

    errorSpy.mockRestore();
    expect(order).toEqual(["after"]);
  });

  test("unregister removes a shutdown handler", async () => {
    resetGracefulShutdownForTests();
    const order: string[] = [];

    const unregister = registerShutdownHandler("temporary", async () => {
      order.push("temporary");
    });
    registerShutdownHandler("permanent", async () => {
      order.push("permanent");
    });

    unregister();
    await runGracefulShutdown("TEST");

    expect(order).toEqual(["permanent"]);
  });

  test("installGracefulShutdownSignals is idempotent", () => {
    resetGracefulShutdownForTests();
    const before = process.listenerCount("SIGUSR2");

    installGracefulShutdownSignals(["SIGUSR2"]);
    const afterFirst = process.listenerCount("SIGUSR2");
    installGracefulShutdownSignals(["SIGUSR2"]);

    expect(afterFirst).toBe(before + 1);
    expect(process.listenerCount("SIGUSR2")).toBe(afterFirst);
  });

  test("installGracefulShutdownSignals drains handlers before exiting", async () => {
    resetGracefulShutdownForTests();
    const order: string[] = [];
    const originalExit = process.exit;
    let exitCode = -1;

    process.exit = ((code?: number) => {
      exitCode = code ?? 0;
    }) as typeof process.exit;

    registerShutdownHandler("cleanup", async () => {
      order.push("cleanup");
    });

    installGracefulShutdownSignals(["SIGUSR2"]);
    process.emit("SIGUSR2");

    await new Promise((resolve) => setTimeout(resolve, 20));

    process.exit = originalExit;

    expect(order).toEqual(["cleanup"]);
    expect(exitCode).toBe(0);
  });
  test("phase order is independent of resource registration and all callers await the same drain", async () => {
    const lifecycle = new LifecycleCoordinator({ timeoutMs: 1000 });
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    lifecycle.register(
      "database",
      () => {
        order.push("close");
      },
      "close",
    );
    lifecycle.register(
      "telemetry",
      () => {
        order.push("flush");
      },
      "flush",
    );
    lifecycle.register(
      "worker",
      async () => {
        order.push("drain");
        await gate;
      },
      "drain",
    );
    lifecycle.register(
      "admission",
      () => {
        order.push("stop");
      },
      "stop",
    );
    const first = lifecycle.shutdown("TEST");
    const second = lifecycle.shutdown("TEST_AGAIN");
    expect(first).toBe(second);
    await Bun.sleep(5);
    expect(order).toEqual(["stop", "drain"]);
    expect(() => lifecycle.register("late", () => {})).toThrow("during shutdown");
    release();
    expect((await first).successful).toBe(true);
    expect(order).toEqual(["stop", "drain", "flush", "close"]);
  });

  test("old unregister ownership cannot remove a replacement", async () => {
    const lifecycle = new LifecycleCoordinator();
    let calls = 0;
    const remove = lifecycle.register("owned", () => {
      calls += 100;
    });
    lifecycle.register("owned", () => {
      calls++;
    });
    remove();
    await lifecycle.shutdown();
    expect(calls).toBe(1);
  });

  test("failed drain forces admission closed and never closes infrastructure", async () => {
    const lifecycle = new LifecycleCoordinator();
    const order: string[] = [];
    const logging = spyOn(console, "error").mockImplementation(() => {});
    try {
      lifecycle.register(
        "broken",
        () => {
          throw new Error("drain failed");
        },
        "drain",
      );
      lifecycle.register(
        "infra",
        () => {
          order.push("close");
        },
        "close",
      );
      lifecycle.register(
        "force",
        (context) => {
          expect(context.signal.aborted).toBe(true);
          order.push("force");
        },
        "force",
      );
      const result = await lifecycle.shutdown();
      expect(result.successful).toBe(false);
      expect(result.timedOut).toBe(false);
      expect(order).toEqual(["force"]);
    } finally {
      logging.mockRestore();
    }
  });

  test("deadline aborts and forces once, with no late infrastructure closure", async () => {
    const lifecycle = new LifecycleCoordinator({ timeoutMs: 30 });
    let release!: () => void;
    let force = 0;
    let close = 0;
    let signal: AbortSignal | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    lifecycle.register(
      "work",
      async (context) => {
        signal = context.signal;
        await gate;
      },
      "drain",
    );
    lifecycle.register(
      "infra",
      () => {
        close++;
      },
      "close",
    );
    lifecycle.register(
      "force",
      () => {
        force++;
      },
      "force",
    );
    const result = await lifecycle.shutdown();
    expect(result.timedOut).toBe(true);
    expect(result.successful).toBe(false);
    expect(signal?.aborted).toBe(true);
    release();
    await Bun.sleep(5);
    expect(close).toBe(0);
    expect(force).toBe(1);
    expect(await lifecycle.shutdown()).toEqual(result);
    expect(force).toBe(1);
  });

  test("flush and close failures retain non-success while other safe cleanup continues", async () => {
    const lifecycle = new LifecycleCoordinator();
    const order: string[] = [];
    const logging = spyOn(console, "error").mockImplementation(() => {});
    try {
      lifecycle.register(
        "flush",
        () => {
          throw new Error("exporter failed");
        },
        "flush",
      );
      lifecycle.register(
        "close",
        () => {
          throw new Error("close failed");
        },
        "close",
      );
      lifecycle.register(
        "later",
        () => {
          order.push("closed");
        },
        "close",
      );
      const result = await lifecycle.shutdown();
      expect(result.successful).toBe(false);
      expect(result.errors.map((entry) => entry.phase)).toEqual(["flush", "close"]);
      expect(order).toEqual(["closed"]);
    } finally {
      logging.mockRestore();
    }
  });

  test("signal ownership is uninstallable and repeated signals exit once with failure status", async () => {
    const lifecycle = new LifecycleCoordinator({ timeoutMs: 20 });
    const exits: number[] = [];
    const original = process.exit;
    const count = process.listenerCount("SIGUSR2");
    process.exit = ((code?: number) => {
      exits.push(code ?? 0);
    }) as typeof process.exit;
    const remove = installGracefulShutdownSignals(["SIGUSR2"], lifecycle);
    try {
      lifecycle.register("stuck", () => new Promise<void>(() => {}), "drain");
      process.emit("SIGUSR2");
      process.emit("SIGUSR2");
      await Bun.sleep(40);
      expect(exits).toEqual([1]);
    } finally {
      process.exit = original;
      remove();
    }
    expect(process.listenerCount("SIGUSR2")).toBe(count);
    for (const timeoutMs of [0, -1, Infinity, NaN, 1.5, 2_147_483_648])
      expect(() => new LifecycleCoordinator({ timeoutMs })).toThrow(RangeError);
  });
});

test("failed force hooks are observed and cannot prevent other emergency handlers", async () => {
  const lifecycle = new LifecycleCoordinator();
  const logging = spyOn(console, "error").mockImplementation(() => {});
  let forced = false;
  try {
    lifecycle.register(
      "broken-stop",
      () => {
        throw new Error("admission failed");
      },
      "stop",
    );
    lifecycle.register(
      "sync-force",
      () => {
        throw new Error("sync force failed");
      },
      "force",
    );
    lifecycle.register(
      "async-force",
      async () => {
        throw new Error("async force failed");
      },
      "force",
    );
    lifecycle.register(
      "remaining-force",
      () => {
        forced = true;
      },
      "force",
    );
    const result = await lifecycle.shutdown();
    await Bun.sleep(0);
    expect(result.successful).toBe(false);
    expect(forced).toBe(true);
    expect(logging).toHaveBeenCalledTimes(3);
  } finally {
    logging.mockRestore();
  }
});

test("unexpected coordinator rejection on a signal exits with failure status", async () => {
  class BrokenCoordinator extends LifecycleCoordinator {
    override shutdown(): Promise<never> {
      return Promise.reject(new Error("coordinator failed"));
    }
  }
  const logging = spyOn(console, "error").mockImplementation(() => {});
  const exits: number[] = [];
  const original = process.exit;
  process.exit = ((code?: number) => {
    exits.push(code ?? 0);
  }) as typeof process.exit;
  const remove = installGracefulShutdownSignals(["SIGUSR2"], new BrokenCoordinator());
  try {
    process.emit("SIGUSR2");
    await Bun.sleep(0);
    expect(exits).toEqual([1]);
    expect(logging).toHaveBeenCalledTimes(1);
  } finally {
    remove();
    process.exit = original;
    logging.mockRestore();
  }
});
