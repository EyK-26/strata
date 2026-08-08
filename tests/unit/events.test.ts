import { describe, expect, test } from "bun:test";
import { EventBus } from "../../src/core/events/eventBus";

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
});
