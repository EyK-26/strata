import { CORE_POLICY_GATE_TOKEN } from "@getstrata/bootstrap/config";
import type { AppDependencies, CachedJson } from "@getstrata/bootstrap/contracts";
import { resolveService } from "@getstrata/bootstrap/contracts";
import type { PolicyGate } from "@getstrata/core/auth/policy";
import { CACHE_TAGS } from "@getstrata/core/cache/tags";
import {
  buildRequestCacheKey,
  createdResponse,
  jsonResponse,
  noContentResponse,
  type RouteRequest,
  securedBindRouteModel,
  withErrorHandling,
} from "@getstrata/core/http";
import { organizationServiceToken } from "./provider";
import {
  type OrganizationIdParams,
  parseCreateOrganizationBody,
  parseOrganizationListQuery,
  parseUpdateOrganizationBody,
} from "./requests";
import { toOrganizationPaginatedResourceCollection, toOrganizationResource } from "./resources";
import type OrganizationService from "./service";

class OrganizationController {
  constructor(
    private readonly dependencies: AppDependencies,
    private readonly cachedJson: CachedJson,
  ) {}

  private get service(): OrganizationService {
    return resolveService(this.dependencies, organizationServiceToken);
  }

  private get policyGate(): PolicyGate {
    return resolveService(this.dependencies, CORE_POLICY_GATE_TOKEN);
  }

  private async flushOrganizationCache(): Promise<void> {
    await this.dependencies.cache.tags(CACHE_TAGS.organizations, CACHE_TAGS.reports).flush();
  }

  readonly index = withErrorHandling(async (request?: Request) => {
    const query = parseOrganizationListQuery(request);
    const cacheKey = buildRequestCacheKey("/organizations", request);

    return await this.cachedJson(
      cacheKey,
      async () => {
        const result = await this.service.paginate(query);
        return toOrganizationPaginatedResourceCollection(result.data, result.meta);
      },
      [CACHE_TAGS.organizations],
      request,
    );
  });

  readonly show = withErrorHandling(
    securedBindRouteModel(
      "id",
      (id) => this.service.findByIdOrThrow(id),
      { resource: "organization", action: "view" },
      async (_request, organization) => {
        return jsonResponse(toOrganizationResource(organization));
      },
    ),
  );

  readonly store = withErrorHandling(async (request: Request) => {
    this.policyGate.authorize("organization", "create");
    const body = await parseCreateOrganizationBody(request);
    const organization = await this.service.create(body);
    await this.flushOrganizationCache();
    return createdResponse(toOrganizationResource(organization));
  });

  readonly update = withErrorHandling(
    securedBindRouteModel(
      "id",
      (id) => this.service.findByIdOrThrow(id),
      { resource: "organization", action: "update" },
      async (req: RouteRequest<OrganizationIdParams>, organization) => {
        const body = await parseUpdateOrganizationBody(req);
        const updated = await this.service.update(organization.id, body);
        await this.flushOrganizationCache();
        return jsonResponse(toOrganizationResource(updated));
      },
    ),
  );

  readonly destroy = withErrorHandling(
    securedBindRouteModel(
      "id",
      (id) => this.service.findByIdOrThrow(id),
      { resource: "organization", action: "delete" },
      async (_request, organization) => {
        await this.service.delete(organization.id);
        await this.flushOrganizationCache();
        return noContentResponse();
      },
    ),
  );
}

export default OrganizationController;
