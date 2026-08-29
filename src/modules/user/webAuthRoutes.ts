import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import { wrapWebLogin, wrapWebRegister } from "@getstrata/bootstrap/web/routing";
import type { AppDependencies } from "@getstrata/core/contracts/di";
import type { RouteHandler } from "@getstrata/core/http/middleware";
import { isFeatureEnabled } from "../../config/features";
import WebAuthController from "./webAuthController";

function createWebAuthRoutes(dependencies: AppDependencies, kernel: HttpKernel) {
  const controller = new WebAuthController(dependencies);

  return {
    ...(isFeatureEnabled("registration")
      ? {
          "/register": {
            GET: kernel.wrapWebGuest(controller.showRegister as unknown as RouteHandler),
            POST: wrapWebRegister(
              kernel,
              controller.register as unknown as RouteHandler,
              controller.registerThrottled as unknown as RouteHandler,
            ),
          },
        }
      : {}),
    "/login": {
      GET: kernel.wrapWebGuest(controller.showLogin as unknown as RouteHandler),
      POST: wrapWebLogin(
        kernel,
        controller.login as unknown as RouteHandler,
        controller.loginThrottled as unknown as RouteHandler,
      ),
    },
    "/oauth/:provider": {
      GET: kernel.wrapWeb(controller.oauthRedirect as unknown as RouteHandler),
    },
    "/oauth/:provider/callback": {
      GET: kernel.wrapWeb(controller.oauthCallback as unknown as RouteHandler),
    },
    "/logout": {
      POST: kernel.wrapWebAuthenticatedAllowUnverified(
        controller.logout as unknown as RouteHandler,
      ),
    },
    "/confirm-password": {
      GET: kernel.wrapWebAuthenticated(controller.showConfirmPassword as unknown as RouteHandler),
      POST: kernel.wrapWebAuthenticated(controller.confirmPassword as unknown as RouteHandler),
    },
    "/email/verify": {
      GET: kernel.wrapWebAuthenticatedAllowUnverified(
        controller.showVerifyNotice as unknown as RouteHandler,
      ),
    },
    "/forgot-password": {
      GET: kernel.wrapWebGuest(controller.showForgotPassword as unknown as RouteHandler),
      POST: wrapWebLogin(
        kernel,
        controller.sendResetLink as unknown as RouteHandler,
        controller.forgotPasswordThrottled as unknown as RouteHandler,
      ),
    },
    "/reset-password": {
      GET: kernel.wrapWeb(
        kernel.wrapSigned(controller.showResetPassword as unknown as RouteHandler),
      ),
      POST: kernel.wrapWeb(kernel.wrapSigned(controller.resetPassword as unknown as RouteHandler)),
    },
    "/verify-email": {
      GET: kernel.wrapWeb(kernel.wrapSigned(controller.verifyEmail as unknown as RouteHandler)),
    },
    "/email/verification-notification": {
      POST: wrapWebLogin(
        kernel,
        controller.resendVerification as unknown as RouteHandler,
        controller.loginThrottled as unknown as RouteHandler,
      ),
    },
  };
}

export { createWebAuthRoutes };
