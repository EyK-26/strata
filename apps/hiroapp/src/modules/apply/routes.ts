import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { currentAuthUser } from "@getstrata/core/auth/authContext";
import { jsonResponse } from "@getstrata/core/http/response";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { mergeResource, NotificationResource, UserResource } from "../../http/resources.ts";
import { wrapCandidateApi, wrapTokenApi } from "../../http/wrap.ts";
import { loadUserGraph } from "../../lib/loaders.ts";
import { UpdateProfileRequest } from "../account/requests.ts";
import { CreateApplicationRequest } from "../applications/requests.ts";
import { LoginRequest } from "../auth/requests.ts";
import { applyService } from "./service.ts";

async function serializePortalUser(user: Parameters<typeof loadUserGraph>[0]) {
  const graph = await loadUserGraph(user);
  return mergeResource(new UserResource(user), {
    notifications: graph.notifications.map((row) => new NotificationResource(row).toArray()),
    position: graph.position,
  });
}

export function applyRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/apply/login": {
      POST: wrapTokenApi(dependencies, async (request) => {
        const payload = await new LoginRequest().validate(request);
        const result = await applyService.login(payload.email, payload.password);
        return jsonResponse({
          token: result.plainTextToken,
          token_type: "Bearer",
          abilities: result.token.abilities,
          user: await serializePortalUser(result.user),
        });
      }),
    },
    "/api/apply/logout": {
      POST: wrapCandidateApi(dependencies, async () => {
        const authUser = currentAuthUser();
        return jsonResponse(await applyService.logout(authUser?.tokenId));
      }),
    },
    "/api/apply/me": {
      GET: wrapCandidateApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        return jsonResponse(await serializePortalUser(user));
      }),
    },
    "/api/apply/positions": {
      GET: wrapCandidateApi(dependencies, async () => jsonResponse(await applyService.positions())),
    },
    "/api/apply/applications": {
      GET: wrapCandidateApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        return jsonResponse({ data: await applyService.applications(user) });
      }),
      POST: wrapCandidateApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        const payload = await new CreateApplicationRequest().validate(request);
        return jsonResponse(await applyService.apply(user, payload));
      }),
    },
    "/api/apply/interviews": {
      GET: wrapCandidateApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        return jsonResponse({ data: await applyService.interviews(user) });
      }),
    },
    "/api/apply/offers": {
      GET: wrapCandidateApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        return jsonResponse({ data: await applyService.offers(user) });
      }),
    },
    "/api/apply/profile": {
      PATCH: wrapCandidateApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        const payload = await new UpdateProfileRequest().validate(request);
        const updated = await applyService.updateProfile(
          user,
          payload.first_name,
          payload.last_name,
          payload.email,
        );
        return jsonResponse(new UserResource(updated).toArray());
      }),
    },
  };
}
