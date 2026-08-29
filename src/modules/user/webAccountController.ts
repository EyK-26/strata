import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import { CORE_VIEW_TOKEN } from "@getstrata/bootstrap/providers/view";
import { currentAuthUser } from "@getstrata/core/auth/authContext";
import type { AppDependencies } from "@getstrata/core/contracts/di";
import { resolveService } from "@getstrata/core/contracts/di";
import { UnauthorizedError, ValidationError } from "@getstrata/core/errors/http";
import { flashResponse } from "@getstrata/core/http/flashSession";
import type { RouteHandler } from "@getstrata/core/http/middleware";
import { withErrorHandling } from "@getstrata/core/http/response";
import { normalizeFieldErrors } from "@getstrata/core/http/webErrorResponse";
import type { ViewEngine } from "@getstrata/core/view";
import { htmlResponse } from "@getstrata/core/view";
import { isFeatureEnabled } from "../../config/features";
import type AuthService from "./authService";
import type PasswordResetService from "./passwordResetService";
import { authServiceToken, passwordResetServiceToken, userRepositoryToken } from "./provider";
import type UserRepository from "./repository";
import type { UserRecord } from "./types";
import { parseWebConfirmMfaBody, parseWebDisableMfaBody } from "./webRequests";

class WebAccountController {
  constructor(private readonly dependencies: AppDependencies) {}

  private get authService(): AuthService {
    return resolveService(this.dependencies, authServiceToken);
  }

  private get passwordResets(): PasswordResetService {
    return resolveService(this.dependencies, passwordResetServiceToken);
  }

  private get users(): UserRepository {
    return resolveService(this.dependencies, userRepositoryToken);
  }

  private get view(): ViewEngine {
    return resolveService(this.dependencies, CORE_VIEW_TOKEN);
  }

  private requireUserId(): number {
    const user = currentAuthUser();
    const userId = typeof user?.id === "number" ? user.id : Number(user?.id);

    if (!Number.isInteger(userId) || userId <= 0) {
      throw new UnauthorizedError("Authentication required.");
    }

    return userId;
  }

  private async renderAccount(
    user: UserRecord,
    extras: Record<string, unknown> = {},
    status = 200,
  ): Promise<Response> {
    return htmlResponse(
      await this.view.render("account/show", {
        title: "Account",
        user,
        mfaEnabled: Boolean(user.mfa_enabled),
        mfaFeatureEnabled: isFeatureEnabled("mfa"),
        pendingSecret: null,
        otpauthUrl: null,
        errors: {},
        ...extras,
      }),
      { status },
    );
  }

  readonly show = withErrorHandling(async () => {
    const user = await this.users.findByIdOrThrow(this.requireUserId());

    return await this.renderAccount(user);
  });

  readonly beginMfa = withErrorHandling(async () => {
    const userId = this.requireUserId();
    const setup = await this.authService.beginMfaSetup(userId);
    const user = await this.users.findByIdOrThrow(userId);

    return await this.renderAccount(user, {
      pendingSecret: setup.secret,
      otpauthUrl: setup.otpauthUrl,
    });
  });

  readonly confirmMfa = withErrorHandling(async (request: Request) => {
    const userId = this.requireUserId();

    try {
      const body = await parseWebConfirmMfaBody(request);
      await this.authService.confirmMfaSetup(userId, body.mfaCode);

      return flashResponse(Response.redirect("/account", 302), {
        level: "success",
        message: "Two-factor authentication is on.",
      });
    } catch (error) {
      if (error instanceof ValidationError) {
        const user = await this.users.findByIdOrThrow(userId);

        return await this.renderAccount(user, { errors: normalizeFieldErrors(error.details) }, 422);
      }

      throw error;
    }
  });

  readonly disableMfa = withErrorHandling(async (request: Request) => {
    const userId = this.requireUserId();

    try {
      const body = await parseWebDisableMfaBody(request);
      await this.authService.disableMfa(userId, body.password);

      return flashResponse(Response.redirect("/account", 302), {
        level: "success",
        message: "Two-factor authentication is off.",
      });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        const user = await this.users.findByIdOrThrow(userId);

        return await this.renderAccount(user, { errors: { password: [error.message] } }, 422);
      }

      throw error;
    }
  });

  readonly resendVerification = withErrorHandling(async () => {
    const user = await this.users.findByIdOrThrow(this.requireUserId());

    if (!user.email_verified_at) {
      await this.passwordResets.sendEmailVerification(user);
    }

    return flashResponse(Response.redirect("/account", 302), {
      level: "success",
      message: "If this address still needs verification, a new link is on its way.",
    });
  });
}

function createWebAccountRoutes(dependencies: AppDependencies, kernel: HttpKernel) {
  const controller = new WebAccountController(dependencies);

  return {
    "/account": {
      GET: kernel.wrapWebAuthenticated(controller.show as unknown as RouteHandler),
    },
    "/account/mfa": {
      POST: kernel.wrapWebAuthenticated(controller.beginMfa as unknown as RouteHandler),
    },
    "/account/mfa/confirm": {
      POST: kernel.wrapWebAuthenticated(controller.confirmMfa as unknown as RouteHandler),
    },
    "/account/mfa/disable": {
      POST: kernel.wrapWebAuthenticated(controller.disableMfa as unknown as RouteHandler),
    },
    "/account/email/verification-notification": {
      POST: kernel.wrapWebAuthenticated(controller.resendVerification as unknown as RouteHandler),
    },
  };
}

export default WebAccountController;
export { createWebAccountRoutes };
