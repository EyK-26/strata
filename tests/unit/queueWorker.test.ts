import { describe, expect, test } from "bun:test";
import { registerDefaultJobs } from "@getstrata/bootstrap/queue/defaultJobs";
import { Job } from "@getstrata/core/queue";
import { jobRegistry } from "@getstrata/core/queue/jobRegistry";
import { runQueueJob } from "@getstrata/core/queue/jobRunner";
import { createQueuePersistenceFixture } from "../helpers/queuePersistence";

interface EchoPayload {
  message: string;
}

describe("QueueWorker", () => {
  test("runs a tracked job envelope through the queue runner", async () => {
    registerDefaultJobs();

    const messages: string[] = [];

    class EchoJob extends Job<EchoPayload> {
      override async handle(payload: EchoPayload): Promise<void> {
        messages.push(payload.message);
      }
    }

    const echoJob = new EchoJob();
    jobRegistry.register("test.echo", () => echoJob);
    jobRegistry.track("test.echo", echoJob);

    const fixture = await createQueuePersistenceFixture();
    try {
      await runQueueJob(
        { name: "test.echo", payload: { message: "hello-worker" }, attempts: 0 },
        fixture.services,
      );
    } finally {
      expect((await fixture.application.stop()).successful).toBe(true);
    }

    expect(messages).toEqual(["hello-worker"]);
  });
});
