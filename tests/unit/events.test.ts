import { describe, expect, test } from "bun:test";
import { EventBus, modelEventName } from "@getstrata/core/events";

describe("EventBus", () => {
  test("dispatches events to registered listeners in registration order", async () => {
    const bus = new EventBus();
    const order: string[] = [];

    const event = modelEventName("task", "created");
    expect(event).toBe("task.created");
    bus.listen(event, () => {
      order.push("first");
    });
    bus.listen(event, () => {
      order.push("second");
    });

    await bus.dispatch(event, { id: 1 });

    expect(order).toEqual(["first", "second"]);
  });

  test("returns an unsubscribe function", async () => {
    const bus = new EventBus();
    let count = 0;

    const unsubscribe = bus.listen("comment.created", () => {
      count += 1;
    });

    await bus.dispatch("comment.created", { id: 3 });
    unsubscribe();
    await bus.dispatch("comment.created", { id: 4 });

    expect(count).toBe(1);
  });

  test("keeps other listeners when one unsubscribes", async () => {
    const bus = new EventBus();
    let firstCount = 0;
    let secondCount = 0;

    const unsubscribeFirst = bus.listen("shared.event", () => {
      firstCount += 1;
    });
    bus.listen("shared.event", () => {
      secondCount += 1;
    });

    unsubscribeFirst();
    await bus.dispatch("shared.event", { id: 1 });

    expect(firstCount).toBe(0);
    expect(secondCount).toBe(1);
  });

  test("supports async listeners", async () => {
    const bus = new EventBus();
    const order: string[] = [];

    bus.listen("project.deleted", async () => {
      await Bun.sleep(5);
      order.push("listener");
    });

    await bus.dispatch("project.deleted", { id: 2 });

    expect(order).toEqual(["listener"]);
  });

  test("no-ops when dispatching events without listeners", async () => {
    const bus = new EventBus();

    await expect(bus.dispatch("missing.event", { id: 1 })).resolves.toBeUndefined();
  });

  test("on/emit are aliases for listen/dispatch", async () => {
    const bus = new EventBus();
    const seen: unknown[] = [];
    bus.on("mail.sent", (payload) => {
      seen.push(payload);
    });
    await bus.emit("mail.sent", { to: "ada@example.com" });
    expect(seen).toEqual([{ to: "ada@example.com" }]);
  });
});

test("transactional unsubscribe removes the final listener without changing ordinary or unrelated listeners", async () => {
  const bus = new EventBus();
  const seen: string[] = [];
  const first = bus.listenTransactional("row.created", () => {
    seen.push("first");
  });
  const last = bus.listenTransactional("row.created", () => {
    seen.push("last");
  });
  bus.listenTransactional("row.updated", () => {
    seen.push("updated");
  });
  bus.listen("row.created", () => {
    seen.push("ordinary");
  });
  await bus.dispatchTransactional("row.created", {});
  first();
  expect(bus.hasTransactionalListeners("row.created")).toBe(true);
  await bus.dispatchTransactional("row.created", {});
  last();
  last();
  expect(bus.hasTransactionalListeners("row.created")).toBe(false);
  expect(bus.hasTransactionalListeners("row.updated")).toBe(true);
  await bus.dispatchTransactional("row.created", {});
  await bus.dispatchTransactional("row.updated", {});
  await bus.dispatch("row.created", {});
  expect(seen).toEqual(["first", "last", "last", "updated", "ordinary"]);
});

test("events public surface retains caller-owned dispatch and excludes ambient ownership", async () => {
  const surface = await import("@getstrata/core/events");
  expect(surface.EventBus).toBe(EventBus);
  expect(surface.modelEventName).toBe(modelEventName);
  for (const name of [
    "eventBus",
    "readSharedEventBus",
    "dispatchModelEvent",
    "runWithDeferredModelEvents",
    "afterCommit",
    "onDeferredModelRollback",
  ])
    expect(name in surface).toBe(false);
  const first = new EventBus();
  const second = new EventBus();
  let count = 0;
  first.listen(modelEventName("owned", "created"), () => {
    count++;
  });
  await second.dispatch(modelEventName("owned", "created"), {});
  expect(count).toBe(0);
  await first.dispatch(modelEventName("owned", "created"), {});
  expect(count).toBe(1);
});
