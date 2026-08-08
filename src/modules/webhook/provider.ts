import type { ServiceProvider } from "../../bootstrap/contracts";
import WebhookRepository from "./repository";
import WebhookService from "./service";

const webhookServiceToken = "webhook.service";

const webhookProvider: ServiceProvider = {
  name: "webhook.provider",
  register({ container }) {
    container.singleton(webhookServiceToken, () => {
      return new WebhookService(new WebhookRepository());
    });
  },
};

export default webhookProvider;
export { webhookServiceToken };
