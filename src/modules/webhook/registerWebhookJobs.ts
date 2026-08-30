import { jobRegistry } from "@getstrata/core/queue/jobRegistry";
import { DispatchWebhookJob } from "./dispatchWebhookJob";

function registerWebhookJobs(): void {
  jobRegistry.register("webhook.dispatch", () => new DispatchWebhookJob());
}

export { registerWebhookJobs };
