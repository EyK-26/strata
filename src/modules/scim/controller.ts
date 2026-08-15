import type { AppDependencies } from "@getstrata/bootstrap/contracts";
import { withErrorHandling } from "@getstrata/core/http";
import { assertScimIfMatch, scimResponse } from "./scimResponse";
import type ScimService from "./service";
import type { ScimPatchOperation, ScimUserPayload } from "./service";
import { createScimService } from "./service";

class ScimController {
  private readonly service;

  constructor(
    dependencies: AppDependencies,
    service: ScimService = createScimService(dependencies),
  ) {
    this.service = service;
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
    const id = Number.parseInt(user.id, 10);
    const record = await this.service.findUserRecord(id);
    return scimResponse(user, { status: 201, etagSource: record });
  });

  readonly showUser = withErrorHandling(async (request: Request) => {
    const params = (request as Request & { params?: { id?: string } }).params;
    const id = Number.parseInt(params?.id ?? "", 10);
    const record = await this.service.findUserRecord(id);
    const user = await this.service.getUser(id);
    return scimResponse(user, { request, etagSource: record });
  });

  readonly patchUser = withErrorHandling(async (request: Request) => {
    const params = (request as Request & { params?: { id?: string } }).params;
    const id = Number.parseInt(params?.id ?? "", 10);
    const record = await this.service.findUserRecord(id);
    assertScimIfMatch(request, record);
    const body = (await request.json()) as { Operations?: ScimPatchOperation[] };
    const user = await this.service.patchUser(id, body.Operations ?? []);
    const updated = await this.service.findUserRecord(id);
    return scimResponse(user, { etagSource: updated });
  });

  readonly deleteUser = withErrorHandling(async (request: Request) => {
    const params = (request as Request & { params?: { id?: string } }).params;
    const id = Number.parseInt(params?.id ?? "", 10);
    const record = await this.service.findUserRecord(id);
    assertScimIfMatch(request, record);
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
    const record = await this.service.findOrganizationRecord(id);
    const group = await this.service.getGroup(id);
    return scimResponse(group, { request, etagSource: record });
  });

  readonly patchGroup = withErrorHandling(async (request: Request) => {
    const params = (request as Request & { params?: { id?: string } }).params;
    const id = Number.parseInt(params?.id ?? "", 10);
    const record = await this.service.findOrganizationRecord(id);
    assertScimIfMatch(request, record);
    const body = (await request.json()) as { Operations?: ScimPatchOperation[] };
    const group = await this.service.patchGroup(id, body.Operations ?? []);
    const updated = await this.service.findOrganizationRecord(id);
    return scimResponse(group, { etagSource: updated });
  });
}

export default ScimController;
