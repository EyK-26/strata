import type { AppDependencies } from "@getstrata/core/contracts/di";
import { resolveService } from "@getstrata/core/contracts/di";
import { createdResponse, jsonResponse, withErrorHandling } from "@getstrata/core/http/response";
import { webhookServiceToken } from "./provider";
import type WebhookService from "./service";

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
