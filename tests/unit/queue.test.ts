import { describe, expect, test } from "bun:test";
import { Job, AsyncQueue, SyncQueue } from "../../src/core/queue";

interface EchoPayload {
  message: string;
}

class EchoJob extends Job<EchoPayload> {
  readonly messages: string[] = [];

  override async handle(payload: EchoPayload): Promise<void> {
    this.messages.push(payload.message);
  }
}

describe("SyncQueue", () => {
  test("executes jobs synchronously in dispatch order", async () => {
    const queue = new SyncQueue();
    const job = new EchoJob();

    await queue.dispatch(job, { message: "/organizations" });
    await queue.dispatch(job, { message: "/projects" });

    expect(job.messages).toEqual(["/organizations", "/projects"]);
  });
});

describe("AsyncQueue", () => {
  test("dispatches jobs on a later microtask", async () => {
    const queue = new AsyncQueue();
    const job = new EchoJob();
    const order: string[] = [];

    order.push("before");
    await queue.dispatch(job, { message: "queued" });
    order.push("after");

    expect(order).toEqual(["before", "after"]);
    expect(job.messages).toEqual([]);

    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(job.messages).toEqual(["queued"]);
  });
});
