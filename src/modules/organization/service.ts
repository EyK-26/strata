import { isGlobalAdmin } from "../../core/auth/accessControl";
import { currentAuthUser } from "../../core/auth/authContext";
import { currentOrganizationIds } from "../../core/auth/membershipContext";
import { resolveMembershipService } from "../../core/auth/membershipService";
import type { QueryWhere } from "../../core/database/types";
import { NotFoundError } from "../../core/errors/http";
import { currentTenantId } from "../../core/tenant/tenantContext";
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

  findByIdOrThrow(id: number): Promise<OrganizationRecord> {
    return this.repository.findByIdOrThrow(
      id,
      (organizationId) => new NotFoundError(`Organization ${organizationId} not found.`),
    );
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
