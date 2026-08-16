import { describe, expect, test } from "bun:test";
import { EventBus, eventBus } from "@getstrata/core/events";

describe("EventBus", () => {
  test("dispatches events to registered listeners in registration order", async () => {
    const bus = new EventBus();
    const order: string[] = [];

    bus.listen("task.created", () => {
      order.push("first");
    });
    bus.listen("task.created", () => {
      order.push("second");
    });

    await bus.dispatch("task.created", { id: 1 });

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

  test("supports the shared event bus singleton", async () => {
    let count = 0;
    const unsubscribe = eventBus.listen("singleton.event", () => {
      count += 1;
    });

    await eventBus.dispatch("singleton.event", { ok: true });
    unsubscribe();

    expect(count).toBe(1);
  });
});
