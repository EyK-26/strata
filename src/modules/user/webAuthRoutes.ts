import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import type { AppDependencies } from "@getstrata/core/contracts/di";
import type { RouteHandler } from "@getstrata/core/http/middleware";
import WebAuthController from "./webAuthController";

function createWebAuthRoutes(dependencies: AppDependencies, kernel: HttpKernel) {
  const controller = new WebAuthController(dependencies);

  return {
    "/login": {
      GET: kernel.wrapWeb(controller.showLogin as unknown as RouteHandler),
      POST: kernel.wrapWeb(kernel.wrapLogin(controller.login as unknown as RouteHandler)),
    },
    "/logout": {
      POST: kernel.wrapWebAuthenticated(controller.logout as unknown as RouteHandler),
    },
    "/forgot-password": {
      GET: kernel.wrapWeb(controller.showForgotPassword as unknown as RouteHandler),
      POST: kernel.wrapWeb(kernel.wrapLogin(controller.sendResetLink as unknown as RouteHandler)),
    },
    "/reset-password": {
      GET: kernel.wrapWeb(controller.showResetPassword as unknown as RouteHandler),
      POST: kernel.wrapWeb(controller.resetPassword as unknown as RouteHandler),
    },
    "/verify-email": {
      GET: kernel.wrapWeb(controller.verifyEmail as unknown as RouteHandler),
    },
    "/email/verification-notification": {
      POST: kernel.wrapWeb(
        kernel.wrapLogin(controller.resendVerification as unknown as RouteHandler),
      ),
    },
  };
}

export { createWebAuthRoutes };
