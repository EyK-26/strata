import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { NotFoundError } from "@getstrata/core/errors/http";
import { wrapScim } from "../../http/wrap.ts";
import { auditService } from "../audit/service.ts";
import { type ScimPatchOperation, type ScimUserPayload, scimError, scimJson } from "./schemas.ts";
import { scimService } from "./service.ts";

function routeId(request: Request): number {
  const params = (request as Request & { params?: { id?: string } }).params;
  return Number.parseInt(params?.id ?? "", 10);
}

function scimHandler(handler: (request: Request) => Promise<Response>) {
  return wrapScim(async (request) => {
    try {
      return await handler(request);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return scimError(error.message, 404);
      }
      throw error;
    }
  });
}

export function scimRoutes(_dependencies: AppDependencies): AppRouteMap {
  return {
    "/scim/v2/ServiceProviderConfig": {
      GET: scimHandler(async () => scimJson(scimService.serviceProviderConfig())),
    },
    "/scim/v2/Users": {
      GET: scimHandler(async (request) => {
        const url = new URL(request.url);
        const startIndex = Number.parseInt(url.searchParams.get("startIndex") ?? "1", 10);
        const count = Number.parseInt(url.searchParams.get("count") ?? "100", 10);
        return scimJson(await scimService.listUsers(startIndex, count));
      }),
      POST: scimHandler(async (request) => {
        const payload = (await request.json()) as ScimUserPayload;
        const created = await scimService.createUser(payload);
        if ("ignored" in created) {
          return scimError("Candidates are not provisioned via SCIM.", 400);
        }
        await auditService.record({
          action: "scim.user.created",
          subjectType: "user",
          subjectId: Number(created.id),
          payload: { email: created.userName },
        });
        return scimJson(created, 201);
      }),
    },
    "/scim/v2/Users/:id": {
      GET: scimHandler(async (request) => scimJson(await scimService.getUser(routeId(request)))),
      PATCH: scimHandler(async (request) => {
        const body = (await request.json()) as { Operations?: ScimPatchOperation[] };
        return scimJson(await scimService.patchUser(routeId(request), body.Operations ?? []));
      }),
      DELETE: scimHandler(async (request) => {
        await scimService.deleteUser(routeId(request));
        return new Response(null, { status: 204 });
      }),
    },
    "/scim/v2/Groups": {
      GET: scimHandler(async (request) => {
        const url = new URL(request.url);
        const startIndex = Number.parseInt(url.searchParams.get("startIndex") ?? "1", 10);
        const count = Number.parseInt(url.searchParams.get("count") ?? "100", 10);
        return scimJson(await scimService.listGroups(startIndex, count));
      }),
    },
    "/scim/v2/Groups/:id": {
      GET: scimHandler(async (request) => scimJson(await scimService.getGroup(routeId(request)))),
      PATCH: scimHandler(async (request) => {
        const body = (await request.json()) as { Operations?: ScimPatchOperation[] };
        return scimJson(await scimService.patchGroup(routeId(request), body.Operations ?? []));
      }),
    },
  };
}
