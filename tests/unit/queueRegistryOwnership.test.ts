import { expect, test } from "bun:test";
import { discoverJobs } from "@getstrata/bootstrap/discoverJobs";
import { Job } from "@getstrata/core/queue";
import { JobRegistry } from "@getstrata/core/queue/jobRegistry";
import { parseQueueJobEnvelope, runQueueJob } from "@getstrata/core/queue/jobRunner";
import type { QueueServices } from "@getstrata/core/queue/queueServices";
import { ResilientQueue } from "@getstrata/core/queue/resilientQueue";

const admitted: Pick<QueueServices, "runAttempt" | "recordFailure"> = {
  runAttempt: (_envelope, context, work) => work(context),
  recordFailure: async () => {
    throw new Error("Unexpected business failure");
  },
};

test("same job name keeps each application's discovered factory and queue execution", async () => {
  const a = new JobRegistry(),
    b = new JobRegistry();
  const seen: string[] = [];
  let createdA = 0,
    createdB = 0;
  class OwnedJob extends Job {
    static override readonly jobName = "same-name";
    constructor(private readonly owner: string) {
      super();
    }
    async handle() {
      seen.push(this.owner);
    }
  }
  await Promise.all([
    discoverJobs(a, {
      manifest: [
        {
          name: "same-name",
          create: () => {
            createdA++;
            return new OwnedJob("A");
          },
        },
      ],
    }),
    discoverJobs(b, {
      manifest: [
        {
          name: "same-name",
          create: () => {
            createdB++;
            return new OwnedJob("B");
          },
        },
      ],
    }),
  ]);
  expect(createdA + createdB).toBe(0);
  const queueA = new ResilientQueue(admitted, a);
  const queueB = new ResilientQueue(admitted, b);
  try {
    await queueA.dispatch(new OwnedJob("producer"), {});
    await queueB.dispatch(new OwnedJob("producer"), {});
    await queueA.dispatch(new OwnedJob("producer"), {});
    expect(seen).toEqual(["A", "B", "A"]);
    expect([createdA, createdB]).toEqual([2, 1]);
  } finally {
    await queueA.close();
    await queueB.close();
  }
});

test("validation never invokes factories; admitted execution creates exactly once", async () => {
  const registry = new JobRegistry();
  let created = 0,
    handled = 0;
  registry.register("owned", () => {
    created++;
    return {
      handle: async () => {
        handled++;
      },
    };
  });
  for (const extra of [
    { attempts: -1 },
    { payload: [] },
    { cancellable: true },
    { deadlineAtMs: 0 },
  ]) {
    expect(
      parseQueueJobEnvelope(JSON.stringify({ name: "owned", payload: {}, ...extra }), registry),
    ).toBeNull();
  }
  const envelope = parseQueueJobEnvelope(JSON.stringify({ name: "owned", payload: {} }), registry);
  expect(envelope).not.toBeNull();
  if (!envelope) throw new Error("Valid envelope was refused");
  expect(created).toBe(0);
  const denied = {
    ...admitted,
    runAttempt: async () => {
      throw new Error("Admission refused");
    },
  };
  await expect(runQueueJob(envelope, denied, registry)).rejects.toThrow("Admission refused");
  expect(created).toBe(0);
  const controller = new AbortController();
  controller.abort(new Error("Cancelled before admission"));
  await expect(
    runQueueJob(envelope, admitted, registry, {
      context: { jobId: "cancelled", signal: controller.signal },
    }),
  ).rejects.toThrow("Cancelled before admission");
  expect(created).toBe(0);
  await runQueueJob(envelope, admitted, registry);
  expect([created, handled]).toEqual([1, 1]);
});

test("queue retry defaults belong to the assembled queue despite environment and input mutation", async () => {
  const registry = new JobRegistry();
  let attempts = 0;
  class Retry extends Job {
    static override readonly jobName = "owned-retry";
    async handle() {
      attempts++;
      if (attempts < 3) throw new Error("transient");
    }
  }
  registry.register(Retry.jobName, () => new Retry());
  const policy = { maxAttempts: 3, backoffMs: 0 };
  const queue = new ResilientQueue(admitted, registry, false, policy);
  policy.maxAttempts = 1;
  const previous = process.env.QUEUE_MAX_ATTEMPTS;
  process.env.QUEUE_MAX_ATTEMPTS = "1";
  try {
    await queue.dispatch(new Retry(), {});
    expect(attempts).toBe(3);
  } finally {
    if (previous === undefined) delete process.env.QUEUE_MAX_ATTEMPTS;
    else process.env.QUEUE_MAX_ATTEMPTS = previous;
    await queue.close();
  }
});
