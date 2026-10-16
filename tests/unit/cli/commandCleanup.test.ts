import { expect, test } from "bun:test";
import { withCommandCleanup } from "../../../packages/strata-cli/src/commandCleanup.ts";
import { createQueueFailedCommands } from "../../../packages/strata-cli/src/queueFailed.ts";

test("one-shot cleanup runs once after success and preserves undefined results", async () => {
  const seen: string[] = [];
  expect(
    await withCommandCleanup(
      async () => {
        seen.push("run");
        return 17;
      },
      () => {
        seen.push("close");
      },
    ),
  ).toBe(17);
  expect(seen).toEqual(["run", "close"]);
  expect(await withCommandCleanup(async () => undefined)).toBeUndefined();
});
test("one-shot cleanup preserves bootstrap/command failure and still closes", async () => {
  const error = new Error("boot failed");
  let closes = 0;
  await expect(
    withCommandCleanup(
      async () => {
        throw error;
      },
      () => {
        closes++;
      },
    ),
  ).rejects.toBe(error);
  expect(closes).toBe(1);
});
test("one-shot cleanup propagates its own failure after a successful command", async () => {
  const error = new Error("close failed");
  await expect(
    withCommandCleanup(
      async () => 17,
      () => {
        throw error;
      },
    ),
  ).rejects.toBe(error);
});
test("one-shot dual failures retain both errors and the original cause", async () => {
  const primary = new Error("command failed"),
    cleanup = new Error("close failed");
  try {
    await withCommandCleanup(
      async () => {
        throw primary;
      },
      () => {
        throw cleanup;
      },
    );
    throw Error("expected failure");
  } catch (error) {
    expect(error).toBeInstanceOf(AggregateError);
    if (!(error instanceof AggregateError)) throw error;
    expect(error.errors).toEqual([primary, cleanup]);
    expect(error.cause).toBe(primary);
  }
});
test("failed-job factories close after every bootstrap failure and invalid retry admission", async () => {
  let closes = 0,
    boots = 0;
  const commands = createQueueFailedCommands(
    async () => {
      boots++;
      throw Error("boot failed");
    },
    () => {
      closes++;
    },
  );
  await expect(commands.queueFailedCommand()).rejects.toThrow("boot failed");
  await expect(commands.queueFlushFailedCommand()).rejects.toThrow("boot failed");
  await expect(commands.queueRetryCommand("1")).rejects.toThrow("boot failed");
  await expect(commands.queueRetryCommand("invalid")).rejects.toThrow("positive integer");
  expect(boots).toBe(3);
  expect(closes).toBe(4);
});
