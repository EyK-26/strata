import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  installGracefulShutdownSignals,
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
});
