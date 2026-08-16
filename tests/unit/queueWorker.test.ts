import { describe, expect, test } from "bun:test";
import { registerDefaultJobs } from "@getstrata/bootstrap/queue/defaultJobs";
import { Job } from "../../src/core/queue";
import { createFailedJobService } from "../../src/core/queue/createAppQueue";
import { jobRegistry } from "../../src/core/queue/jobRegistry";
import { runQueueJob } from "../../src/core/queue/jobRunner";

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

    await runQueueJob(
      { name: "test.echo", payload: { message: "hello-worker" }, attempts: 0 },
      createFailedJobService(),
    );

    expect(messages).toEqual(["hello-worker"]);
  });
});
