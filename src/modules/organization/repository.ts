import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { NotFoundError } from "@getstrata/core/errors/http";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { organizationTable } from "./table";
import type { OrganizationRecord } from "./types";

class OrganizationRepository extends BaseRepository<OrganizationRecord, "id"> {
  constructor() {
    super(organizationTable);
  }

  async findBySlug(slug: string): Promise<OrganizationRecord | null> {
    return await this.firstOrNull({ slug });
  }

  async listForTenant(options: {
    limit: number;
    offset: number;
    tenantId?: number;
  }): Promise<OrganizationRecord[]> {
    return await this.findAll({
      limit: options.limit,
      offset: options.offset,
      where: { tenant_id: options.tenantId ?? currentTenantId() },
    });
  }

  async countForTenant(tenantId = currentTenantId()): Promise<number> {
    return await this.countWhere({ tenant_id: tenantId });
  }

  async findForTenantOrThrow(
    id: number,
    tenantId = currentTenantId(),
  ): Promise<OrganizationRecord> {
    const organization = await this.findById(id);

    if (!organization || organization.tenant_id !== tenantId) {
      throw new NotFoundError(`SCIM group ${id} not found.`);
    }

    return organization;
  }
}

export default OrganizationRepository;
