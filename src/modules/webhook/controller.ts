import type { AppDependencies } from "@getstrata/core/contracts/di";
import { resolveService } from "@getstrata/core/contracts/di";
import { ValidationError } from "@getstrata/core/errors/http";
import {
  createdResponse,
  jsonResponse,
  noContentResponse,
  withErrorHandling,
} from "@getstrata/core/http/response";
import { parsePositiveIntParam } from "@getstrata/core/http/validation";
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

  readonly deactivate = withErrorHandling(async (request: Request) => {
    const webhook = await this.service.deactivate(this.requireId(request));
    return jsonResponse({
      id: webhook.id,
      active: webhook.active,
    });
  });

  readonly activate = withErrorHandling(async (request: Request) => {
    const webhook = await this.service.activate(this.requireId(request));
    return jsonResponse({
      id: webhook.id,
      active: webhook.active,
    });
  });

  readonly destroy = withErrorHandling(async (request: Request) => {
    await this.service.delete(this.requireId(request));
    return noContentResponse();
  });

  readonly retryDelivery = withErrorHandling(async (request: Request) => {
    await this.service.retryDelivery(this.requireId(request));
    return jsonResponse({ retried: true });
  });

  private requireId(request: Request): number {
    const params = (request as Request & { params?: { id: string } }).params;

    if (!params?.id) {
      throw new ValidationError("Id is required.");
    }

    return parsePositiveIntParam(params.id, "id");
  }
}

export default WebhookController;
