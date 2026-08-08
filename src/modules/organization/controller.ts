import { CORE_POLICY_GATE_TOKEN } from "../../bootstrap/config";
import type { AppDependencies, CachedJson } from "../../bootstrap/contracts";
import { resolveService } from "../../bootstrap/contracts";
import type { PolicyGate } from "../../core/auth/policy";
import { CACHE_TAGS } from "../../core/cache/tags";
import {
  bindRouteModel,
  buildRequestCacheKey,
  createdResponse,
  jsonResponse,
  noContentResponse,
  type RouteRequest,
  securedBindRouteModel,
  withErrorHandling,
} from "../../core/http";
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

  readonly index = withErrorHandling(async (request?: Request) => {
    const query = parseOrganizationListQuery(request);
    const cacheKey = buildRequestCacheKey("/organizations", request);

    return await this.cachedJson(cacheKey, async () => {
      const result = await this.service.paginate(query);
      return toOrganizationPaginatedResourceCollection(result.data, result.meta);
    }, [CACHE_TAGS.organizations]);
  });

  readonly show = withErrorHandling(
    bindRouteModel(
      "id",
      (id) => this.service.findByIdOrThrow(id),
      async (_request, organization) => {
        return jsonResponse(toOrganizationResource(organization));
      },
    ),
  );

  readonly store = withErrorHandling(async (request: Request) => {
    this.policyGate.authorize("organization", "create");
    const body = await parseCreateOrganizationBody(request);
    const organization = await this.service.create(body);
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
        return noContentResponse();
      },
    ),
  );
}

export default OrganizationController;
