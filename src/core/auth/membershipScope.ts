import { NotFoundError } from "../errors/http";
import { currentTenantId } from "../tenant/tenantContext";
import { isGlobalAdmin } from "./accessControl";
import { currentAuthUser } from "./authContext";
import { currentOrganizationIds } from "./membershipContext";

function resolveOrganizationScope(): number[] | null {
  const user = currentAuthUser();

  if (!user) {
    return null;
  }

  if (isGlobalAdmin(user)) {
    return null;
  }

  return currentOrganizationIds();
}

function scopedOrganizationIds(requestedOrganizationId?: number): number[] | null {
  const scope = resolveOrganizationScope();

  if (scope === null) {
    return requestedOrganizationId === undefined ? null : [requestedOrganizationId];
  }

  if (requestedOrganizationId !== undefined) {
    return scope.includes(requestedOrganizationId) ? [requestedOrganizationId] : [];
  }

  return scope;
}

function appendOrganizationScope<T extends object>(where: T, requestedOrganizationId?: number): T {
  const organizationIds = scopedOrganizationIds(requestedOrganizationId);

  if (organizationIds === null) {
    return where;
  }

  if (organizationIds.length === 0) {
    return {
      ...where,
      organization_id: [-1],
    };
  }

  return {
    ...where,
    organization_id: organizationIds.length === 1 ? organizationIds[0] : organizationIds,
  };
}

function appendProjectScope<T extends object>(
  where: T,
  accessibleProjectIds: number[] | null,
  requestedProjectId?: number,
): T {
  if (accessibleProjectIds === null) {
    if (requestedProjectId === undefined) {
      return where;
    }

    return {
      ...where,
      project_id: requestedProjectId,
    };
  }

  if (accessibleProjectIds.length === 0) {
    return {
      ...where,
      project_id: [-1],
    };
  }

  if (requestedProjectId !== undefined) {
    return {
      ...where,
      project_id: accessibleProjectIds.includes(requestedProjectId) ? requestedProjectId : -1,
    };
  }

  return {
    ...where,
    project_id: accessibleProjectIds,
  };
}

function emptyPaginateResult<T>(page: number, perPage: number) {
  return {
    data: [] as T[],
    meta: {
      page,
      per_page: perPage,
      total: 0,
      last_page: 1,
    },
  };
}

function assertResourceInCurrentTenant(
  resourceTenantId: number,
  resourceLabel: string,
  resourceId: number,
): void {
  if (resourceTenantId !== currentTenantId()) {
    throw new NotFoundError(`${resourceLabel} ${resourceId} not found.`);
  }
}

function assertOrganizationReadable(organizationId: number): void {
  const user = currentAuthUser();

  if (!user || isGlobalAdmin(user)) {
    return;
  }

  const organizationIds = scopedOrganizationIds();

  if (organizationIds !== null && !organizationIds.includes(organizationId)) {
    throw new NotFoundError(`Organization ${organizationId} not found.`);
  }
}

export {
  appendOrganizationScope,
  appendProjectScope,
  assertOrganizationReadable,
  assertResourceInCurrentTenant,
  emptyPaginateResult,
  resolveOrganizationScope,
  scopedOrganizationIds,
};
