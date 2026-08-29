import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import { CORE_VIEW_TOKEN } from "@getstrata/bootstrap/providers/view";
import type { AppDependencies } from "@getstrata/core/contracts/di";
import { resolveService } from "@getstrata/core/contracts/di";
import { ValidationError } from "@getstrata/core/errors/http";
import { requestPrefersJson } from "@getstrata/core/http/contentNegotiation";
import { flashResponse } from "@getstrata/core/http/flashSession";
import type { RouteHandler } from "@getstrata/core/http/middleware";
import { formDataToRecord, parseFormBody } from "@getstrata/core/http/parseFormBody";
import { withErrorHandling } from "@getstrata/core/http/response";
import { normalizeFieldErrors } from "@getstrata/core/http/webErrorResponse";
import type { ViewEngine } from "@getstrata/core/view";
import { htmlResponse } from "@getstrata/core/view";
import { webhookServiceToken } from "./provider";
import type WebhookService from "./service";

class WebhookWebController {
  constructor(private readonly dependencies: AppDependencies) {}

  private get service(): WebhookService {
    return resolveService(this.dependencies, webhookServiceToken);
  }

  private get view(): ViewEngine {
    return resolveService(this.dependencies, CORE_VIEW_TOKEN);
  }

  private async renderIndex(extras: Record<string, unknown> = {}, status = 200) {
    const [webhooks, deliveries] = await Promise.all([
      this.service.listAll(),
      this.service.listRecentDeliveries(),
    ]);

    return htmlResponse(
      await this.view.render("webhooks/index", {
        title: "Webhooks",
        webhooks,
        deliveries,
        errors: {},
        old: {},
        ...extras,
      }),
      { status },
    );
  }

  readonly index = withErrorHandling(async () => {
    return await this.renderIndex();
  });

  readonly store = withErrorHandling(async (request: Request) => {
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    const old =
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
        ? formDataToRecord(await request.formData())
        : await parseFormBody(request).catch(() => ({}));

    try {
      const record = old as Record<string, unknown>;
      const url = String(record.url ?? "").trim();
      const secret = String(record.secret ?? "").trim();
      const events = String(record.events ?? "*")
        .split(",")
        .map((event) => event.trim())
        .filter(Boolean);

      if (!url || !secret) {
        throw new ValidationError("Webhook URL and secret are required.", {
          url: url ? [] : ["Webhook URL is required."],
          secret: secret ? [] : ["Webhook secret is required."],
        });
      }

      await this.service.create({ url, secret, events: events.length > 0 ? events : ["*"] });

      return flashResponse(Response.redirect("/webhooks", 302), {
        level: "success",
        message: "Webhook endpoint registered.",
      });
    } catch (error) {
      if (error instanceof ValidationError && !requestPrefersJson(request)) {
        return await this.renderIndex(
          {
            errors: normalizeFieldErrors(error.details),
            old,
          },
          422,
        );
      }

      throw error;
    }
  });
}

function createWebhookWebRoutes(dependencies: AppDependencies, kernel: HttpKernel) {
  const controller = new WebhookWebController(dependencies);

  return {
    "/webhooks": {
      GET: kernel.wrapWebGlobalAdmin(controller.index as unknown as RouteHandler),
      POST: kernel.wrapWebGlobalAdmin(controller.store as unknown as RouteHandler),
    },
  };
}

export default WebhookWebController;
export { createWebhookWebRoutes };
