import type { AppDependencies } from "../../bootstrap/contracts";
import { jsonResponse, withErrorHandling } from "../../core/http";
import type { ScimPatchOperation, ScimUserPayload } from "./service";
import { createScimService } from "./service";

function scimResponse(data: unknown, status = 200): Response {
  return jsonResponse(data, {
    status,
    headers: {
      "content-type": "application/scim+json",
    },
  });
}

class ScimController {
  private readonly service;

  constructor(dependencies: AppDependencies) {
    this.service = createScimService(dependencies);
  }

  readonly serviceProviderConfig = withErrorHandling(async () => {
    return scimResponse(this.service.serviceProviderConfig());
  });

  readonly listUsers = withErrorHandling(async (request: Request) => {
    const url = new URL(request.url);
    const startIndex = Number.parseInt(url.searchParams.get("startIndex") ?? "1", 10);
    const count = Number.parseInt(url.searchParams.get("count") ?? "100", 10);
    return scimResponse(await this.service.listUsers(startIndex, count));
  });

  readonly createUser = withErrorHandling(async (request: Request) => {
    const payload = (await request.json()) as ScimUserPayload;
    const user = await this.service.createUser(payload);
    return scimResponse(user, 201);
  });

  readonly showUser = withErrorHandling(async (request: Request) => {
    const params = (request as Request & { params?: { id?: string } }).params;
    const id = Number.parseInt(params?.id ?? "", 10);
    return scimResponse(await this.service.getUser(id));
  });

  readonly patchUser = withErrorHandling(async (request: Request) => {
    const params = (request as Request & { params?: { id?: string } }).params;
    const id = Number.parseInt(params?.id ?? "", 10);
    const body = (await request.json()) as { Operations?: ScimPatchOperation[] };
    const user = await this.service.patchUser(id, body.Operations ?? []);
    return scimResponse(user);
  });

  readonly deleteUser = withErrorHandling(async (request: Request) => {
    const params = (request as Request & { params?: { id?: string } }).params;
    const id = Number.parseInt(params?.id ?? "", 10);
    await this.service.deleteUser(id);
    return new Response(null, { status: 204 });
  });

  readonly listGroups = withErrorHandling(async (request: Request) => {
    const url = new URL(request.url);
    const startIndex = Number.parseInt(url.searchParams.get("startIndex") ?? "1", 10);
    const count = Number.parseInt(url.searchParams.get("count") ?? "100", 10);
    return scimResponse(await this.service.listGroups(startIndex, count));
  });

  readonly showGroup = withErrorHandling(async (request: Request) => {
    const params = (request as Request & { params?: { id?: string } }).params;
    const id = Number.parseInt(params?.id ?? "", 10);
    return scimResponse(await this.service.getGroup(id));
  });

  readonly patchGroup = withErrorHandling(async (request: Request) => {
    const params = (request as Request & { params?: { id?: string } }).params;
    const id = Number.parseInt(params?.id ?? "", 10);
    const body = (await request.json()) as { Operations?: ScimPatchOperation[] };
    const group = await this.service.patchGroup(id, body.Operations ?? []);
    return scimResponse(group);
  });
}

export default ScimController;
