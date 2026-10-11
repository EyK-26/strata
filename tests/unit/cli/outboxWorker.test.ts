import { afterEach, describe, expect, test } from "bun:test";
import { resetGracefulShutdownForTests } from "@getstrata/core/lifecycle/gracefulShutdown";

afterEach(() => {
  resetGracefulShutdownForTests();
});

describe("outbox worker", () => {
  test("closes after a rejected boot and does not start delivery", async () => {
    let closed = 0;
    const { runOutboxWorkerCommand } = await import("@getstrata/cli/outboxWorker");
    await expect(
      runOutboxWorkerCommand({
        listeners: [],
        boot: async () => {
          throw new Error("boot failed");
        },
        close: () => {
          closed += 1;
        },
      }),
    ).rejects.toThrow("boot failed");
    expect(closed).toBe(1);
  });
});
