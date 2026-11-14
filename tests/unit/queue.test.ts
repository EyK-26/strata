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

test("sync queue registers admitted work before a job can initiate shutdown", async () => {
  const { ResilientQueue } = await import("@getstrata/core/queue/resilientQueue");
  const { JobRegistry } = await import("@getstrata/core/queue/jobRegistry");
  const registry = new JobRegistry();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let closed = false;
  let finished = false;
  let closing: Promise<void> | undefined;
  class InitiateShutdown extends Job {
    async handle() {
      closing = queue.close().then(() => {
        closed = true;
      });
      entered();
      await gate;
      finished = true;
    }
  }
  registry.register("shutdown.probe", () => new InitiateShutdown());
  const queue = new ResilientQueue(
    {
      runAttempt: (_envelope, context, work) => work(context),
      recordFailure: async () => {
        throw new Error("Unexpected failure");
      },
    },
    registry,
    false,
  );
  const dispatched = queue.dispatch(registry.track("shutdown.probe", new InitiateShutdown()), {});
  try {
    await ready;
    await Bun.sleep(1);
    expect(closed).toBe(false);
  } finally {
    release();
    await dispatched;
    await closing;
  }
  expect(finished).toBe(true);
  expect(closed).toBe(true);
});

for (const asyncDispatch of [true, false]) {
  for (const fail of [true, false]) {
    test(`production ${asyncDispatch ? "async" : "sync"} queue drains ${fail ? "failed" : "successful"} jobs`, async () => {
      const { ResilientQueue } = await import("@getstrata/core/queue/resilientQueue");
      const { JobRegistry } = await import("@getstrata/core/queue/jobRegistry");
      const jobRegistry = new JobRegistry();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let finished = false;
      let failures = 0;
      const failure = new Error("job failure sentinel");
      class Pending extends Job {
        override readonly maxAttempts = 1;
        async handle() {
          await gate;
          finished = true;
          if (fail) throw failure;
        }
      }
      const name = `test.drain.${crypto.randomUUID()}`;
      jobRegistry.register(name, () => new Pending());
      const queue = new ResilientQueue(
        {
          runAttempt: (
            _envelope: unknown,
            context: import("@getstrata/core/queue").JobContext,
            work: (context: import("@getstrata/core/queue").JobContext) => Promise<void>,
          ) => work(context),
          recordFailure: async (input) => {
            failures++;
            return {
              id: failures,
              job_name: input.jobName,
              job_id: input.jobId,
              payload: input.payload,
              exception: input.exception,
              failed_at: new Date(),
            };
          },
        },
        jobRegistry,
        asyncDispatch,
      );
      const job = jobRegistry.create(name);
      if (!job) throw new Error("Missing registered job");
      jobRegistry.track(name, job);
      const dispatched = queue.dispatch(job, {});
      const outcome = dispatched.then(
        () => null,
        (error) => error,
      );
      if (asyncDispatch) await dispatched;
      let closed = false;
      const closing = queue.close().then(() => {
        closed = true;
      });
      try {
        await Bun.sleep(10);
        expect(closed).toBe(false);
      } finally {
        release();
        await Promise.all([outcome, closing]);
      }
      expect(finished).toBe(true);
      expect(failures).toBe(fail ? 1 : 0);
      expect(await outcome).toBe(fail && !asyncDispatch ? failure : null);
      await expect(queue.dispatch(job, {})).rejects.toThrow("closed");
    });
  }
}
