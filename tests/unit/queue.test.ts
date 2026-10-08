import { describe, expect, test } from "bun:test";
import { AsyncQueue, Job, SyncQueue } from "@getstrata/core/queue";

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

test("async queue close drains scheduled work and child jobs, then rejects dispatch", async () => {
  const queue = new AsyncQueue();
  const child = new EchoJob();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  class Parent extends Job {
    async handle() {
      await gate;
      await queue.dispatch(child, { message: "child" });
    }
  }
  await queue.dispatch(new Parent(), {});
  const closing = queue.close();
  expect(queue.close()).toBe(closing);
  expect(child.messages).toEqual([]);
  release();
  await closing;
  expect(child.messages).toEqual(["child"]);
  await expect(queue.dispatch(child, { message: "late" })).rejects.toThrow("closed");
});

test("production async queue drains actual resilient job execution", async () => {
  const { ResilientQueue } = await import("@getstrata/core/queue/resilientQueue");
  const { jobRegistry } = await import("@getstrata/core/queue/jobRegistry");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let finished = false;
  class Pending extends Job {
    async handle() {
      await gate;
      finished = true;
    }
  }
  const name = `test.drain.${crypto.randomUUID()}`;
  jobRegistry.register(name, () => new Pending());
  const queue = new ResilientQueue(
    {
      recordFailure: async () => {
        throw new Error("unexpected failure");
      },
    } as never,
    true,
  );
  const job = jobRegistry.create(name);
  if (!job) throw new Error("Missing registered job");
  jobRegistry.track(name, job);
  await queue.dispatch(job, {});
  let closed = false;
  const closing = queue.close().then(() => {
    closed = true;
  });
  await Bun.sleep(10);
  expect(closed).toBe(false);
  release();
  await closing;
  expect(finished).toBe(true);
});
