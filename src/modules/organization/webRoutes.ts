import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import type { AppDependencies } from "@getstrata/core/contracts/di";
import type { RouteHandler } from "@getstrata/core/http/middleware";
import OrganizationWebController from "./webController";

function createOrganizationWebRoutes(dependencies: AppDependencies, kernel: HttpKernel) {
  const controller = new OrganizationWebController(dependencies);

  return {
    "/": {
      GET: kernel.wrapWeb(controller.home as unknown as RouteHandler),
    },
    "/organizations": {
      GET: kernel.wrapWebPublicRead(controller.index as unknown as RouteHandler),
      POST: kernel.wrapWebAbility(
        "organizations:create",
        controller.store as unknown as RouteHandler,
      ),
    },
    "/organizations/:id": {
      GET: kernel.wrapWebPublicRead(controller.show as unknown as RouteHandler),
      POST: kernel.wrapWebAuthenticated(controller.update as unknown as RouteHandler),
      PATCH: kernel.wrapWebAuthenticated(controller.update as unknown as RouteHandler),
      DELETE: kernel.wrapWebAbility(
        "organizations:delete",
        controller.destroy as unknown as RouteHandler,
      ),
    },
    "/organizations/:id/delete": {
      POST: kernel.wrapWebAbility(
        "organizations:delete",
        controller.destroy as unknown as RouteHandler,
      ),
    },
    "/organizations/:id/members": {
      POST: kernel.wrapWebAuthenticated(controller.addMember as unknown as RouteHandler),
    },
    "/organizations/:id/members/:userId": {
      DELETE: kernel.wrapWebAuthenticated(controller.removeMember as unknown as RouteHandler),
    },
    "/organizations/:id/members/:userId/role": {
      POST: kernel.wrapWebAuthenticated(controller.updateMemberRole as unknown as RouteHandler),
    },
    "/organizations/:id/invitations/:invitationId": {
      DELETE: kernel.wrapWebAuthenticated(controller.cancelInvitation as unknown as RouteHandler),
    },
    "/organizations/:id/invitations/:invitationId/cancel": {
      POST: kernel.wrapWebAuthenticated(controller.cancelInvitation as unknown as RouteHandler),
    },
    "/invitations/accept": {
      GET: kernel.wrapWebAuthenticatedAllowUnverified(
        kernel.wrapSigned(controller.acceptInvitation as unknown as RouteHandler),
      ),
    },
    "/current-organization": {
      POST: kernel.wrapWebAuthenticated(controller.switchCurrent as unknown as RouteHandler),
    },
  };
}

export { createOrganizationWebRoutes };
