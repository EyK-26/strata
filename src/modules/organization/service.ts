import { isGlobalAdmin } from "@getstrata/core/auth/accessControl";
import { currentAuthUser } from "@getstrata/core/auth/authContext";
import { currentOrganizationIds } from "@getstrata/core/auth/membershipContext";
import { assertResourceInCurrentTenant } from "@getstrata/core/auth/membershipScope";
import { resolveMembershipService } from "@getstrata/core/auth/membershipService";
import type { QueryWhere } from "@getstrata/core/database/types";
import { NotFoundError } from "@getstrata/core/errors/http";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import type OrganizationRepository from "./repository";
import type { OrganizationRecord } from "./types";

interface CreateOrganizationInput {
  name: string;
  slug: string;
}

interface UpdateOrganizationInput {
  name?: string;
  slug?: string;
}

class OrganizationService {
  constructor(private readonly repository: OrganizationRepository) {}

  paginate(options: { page: number; perPage: number }) {
    const user = currentAuthUser();
    const where: QueryWhere<OrganizationRecord> = {
      tenant_id: currentTenantId(),
    } as unknown as QueryWhere<OrganizationRecord>;

    if (user && !isGlobalAdmin(user)) {
      const organizationIds = currentOrganizationIds();

      if (organizationIds.length === 0) {
        return this.repository.paginate({
          ...options,
          where: { id: -1 } as unknown as QueryWhere<OrganizationRecord>,
        });
      }

      Object.assign(where, {
        id: organizationIds as unknown as QueryWhere<OrganizationRecord>["id"],
      });
    }

    return this.repository.paginate({
      ...options,
      where,
    });
  }

  async findByIdOrThrow(id: number): Promise<OrganizationRecord> {
    const organization = await this.repository.findByIdOrThrow(
      id,
      (organizationId) => new NotFoundError(`Organization ${organizationId} not found.`),
    );

    assertResourceInCurrentTenant(organization.tenant_id, "Organization", id);

    return organization;
  }

  async create(input: CreateOrganizationInput): Promise<OrganizationRecord> {
    const now = new Date();
    const user = currentAuthUser();

    const organization = await this.repository.create({
      tenant_id: currentTenantId(),
      name: input.name,
      slug: input.slug,
      created_at: now,
      updated_at: now,
    });

    if (user) {
      const userId = typeof user.id === "number" ? user.id : Number(user.id);

      if (Number.isInteger(userId) && userId > 0) {
        await resolveMembershipService().addOwnerOnOrganizationCreate(organization.id, userId);
      }
    }

    return organization;
  }

  async update(id: number, input: UpdateOrganizationInput): Promise<OrganizationRecord> {
    const changes: UpdateOrganizationInput & { updated_at: Date } = {
      updated_at: new Date(),
    };

    if (input.name !== undefined) {
      changes.name = input.name;
    }

    if (input.slug !== undefined) {
      changes.slug = input.slug;
    }

    return await this.repository.updateByIdOrThrow(id, changes);
  }

  async delete(id: number): Promise<void> {
    const deleted = await this.repository.deleteById(id);

    if (!deleted) {
      throw new NotFoundError(`Organization ${id} not found.`);
    }
  }
}

export default OrganizationService;
export type { CreateOrganizationInput, UpdateOrganizationInput };
