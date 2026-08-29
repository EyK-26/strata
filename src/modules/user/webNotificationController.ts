import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import { CORE_VIEW_TOKEN } from "@getstrata/bootstrap/providers/view";
import { resolveUserId } from "@getstrata/core/auth/accessControl";
import { currentAuthUser } from "@getstrata/core/auth/authContext";
import type { AppDependencies } from "@getstrata/core/contracts/di";
import { resolveService } from "@getstrata/core/contracts/di";
import { UnauthorizedError } from "@getstrata/core/errors/http";
import type { RouteHandler } from "@getstrata/core/http/middleware";
import { withErrorHandling } from "@getstrata/core/http/response";
import type { RouteRequest } from "@getstrata/core/http/route";
import type { ViewEngine } from "@getstrata/core/view";
import { htmlResponse } from "@getstrata/core/view";
import type NotificationService from "./notificationService";
import { notificationServiceToken } from "./provider";

class WebNotificationController {
  constructor(private readonly dependencies: AppDependencies) {}

  private get notifications(): NotificationService {
    return resolveService(this.dependencies, notificationServiceToken);
  }

  private get view(): ViewEngine {
    return resolveService(this.dependencies, CORE_VIEW_TOKEN);
  }

  private requireUserId(): number {
    const user = currentAuthUser();

    if (!user) {
      throw new UnauthorizedError("Authentication required.");
    }

    return resolveUserId(user);
  }

  private async renderInbox(userId: number) {
    const [result, unreadCount] = await Promise.all([
      this.notifications.listForUser(userId, { page: 1, perPage: 8 }),
      this.notifications.countUnread(userId),
    ]);

    return this.view.render(
      "notifications/_inbox",
      {
        notifications: result.data,
        unreadCount,
      },
      { layout: false },
    );
  }

  readonly inbox = withErrorHandling(async () => {
    return htmlResponse(await this.renderInbox(this.requireUserId()));
  });

  readonly markRead = withErrorHandling(async (req: RouteRequest<{ id: string }>) => {
    const userId = this.requireUserId();
    const notificationId = Number.parseInt(String(req.params.id), 10);
    await this.notifications.markRead(userId, notificationId);

    return htmlResponse(await this.renderInbox(userId));
  });

  readonly markAllRead = withErrorHandling(async () => {
    const userId = this.requireUserId();
    await this.notifications.markAllRead(userId);

    return htmlResponse(await this.renderInbox(userId));
  });
}

function createWebNotificationRoutes(dependencies: AppDependencies, kernel: HttpKernel) {
  const controller = new WebNotificationController(dependencies);

  return {
    "/notifications": {
      GET: kernel.wrapWebAuthenticated(controller.inbox as unknown as RouteHandler),
    },
    "/notifications/read-all": {
      POST: kernel.wrapWebAuthenticated(controller.markAllRead as unknown as RouteHandler),
    },
    "/notifications/:id/read": {
      POST: kernel.wrapWebAuthenticated(controller.markRead as unknown as RouteHandler),
    },
  };
}

export default WebNotificationController;
export { createWebNotificationRoutes };
