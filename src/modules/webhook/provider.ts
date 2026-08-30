import type { ServiceProvider } from "@getstrata/core/contracts/di";
import { CORE_QUEUE_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import type { Queue } from "@getstrata/core/queue";
import { registerWebhookJobs } from "./registerWebhookJobs";
import WebhookRepository from "./repository";
import WebhookService from "./service";

const webhookServiceToken = "webhook.service";

const webhookProvider: ServiceProvider = {
  name: "webhook.provider",
  register({ container }) {
    registerWebhookJobs();
    container.singleton(webhookServiceToken, () => {
      return new WebhookService(
        new WebhookRepository(),
        container.resolve<Queue>(CORE_QUEUE_TOKEN),
      );
    });
  },
};

export default webhookProvider;
export { webhookServiceToken };
