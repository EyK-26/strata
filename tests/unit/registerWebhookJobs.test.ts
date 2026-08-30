import { describe, expect, test } from "bun:test";
import { ExportAuditLogsJob } from "@getstrata/core/jobs/exportAuditLogsJob";
import { jobRegistry } from "@getstrata/core/queue/jobRegistry";
import { registerDefaultJobs } from "../../src/bootstrap/queue/defaultJobs";
import { DispatchWebhookJob } from "../../src/modules/webhook/dispatchWebhookJob";
import { registerWebhookJobs } from "../../src/modules/webhook/registerWebhookJobs";

describe("registerWebhookJobs", () => {
  test("registers webhook.dispatch on the app job registry", () => {
    registerDefaultJobs();
    expect(jobRegistry.create("audit.export")).toBeInstanceOf(ExportAuditLogsJob);

    registerWebhookJobs();
    expect(jobRegistry.create("webhook.dispatch")).toBeInstanceOf(DispatchWebhookJob);
  });
});
