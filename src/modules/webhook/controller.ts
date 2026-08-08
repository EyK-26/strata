import type { AppDependencies } from "../../bootstrap/contracts";
import { resolveService } from "../../bootstrap/contracts";
import { createdResponse, jsonResponse, withErrorHandling } from "../../core/http";
import WebhookService from "./service";
import { webhookServiceToken } from "./provider";

class WebhookController {
  constructor(private readonly dependencies: AppDependencies) {}

  private get service(): WebhookService {
    return resolveService(this.dependencies, webhookServiceToken);
  }

  readonly index = withErrorHandling(async () => {
    const webhooks = await this.service.listActive();
    return jsonResponse({
      data: webhooks.map((webhook) => ({
        id: webhook.id,
        organization_id: webhook.organization_id,
        url: webhook.url,
        events: webhook.events,
        active: webhook.active,
      })),
    });
  });

  readonly store = withErrorHandling(async (request: Request) => {
    const body = (await request.json()) as {
      url: string;
      secret: string;
      organization_id?: number;
      events?: string[];
    };

    const webhook = await this.service.create({
      url: body.url,
      secret: body.secret,
      organizationId: body.organization_id,
      events: body.events,
    });

    return createdResponse({
      id: webhook.id,
      url: webhook.url,
      events: webhook.events,
    });
  });
}

export default WebhookController;
