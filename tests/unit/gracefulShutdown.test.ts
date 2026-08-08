import { describe, expect, test } from "bun:test";
import {
  registerShutdownHandler,
  resetGracefulShutdownForTests,
  runGracefulShutdown,
} from "../../src/core/lifecycle/gracefulShutdown";

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
    resetGracefulShutdownForTests();
  });
});
