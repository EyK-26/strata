import { Factory } from "@getstrata/core/database/factory";
import OrganizationRepository from "./repository";
import type { OrganizationRecord } from "./types";

class OrganizationFactory extends Factory<OrganizationRecord> {
  protected override definition(): OrganizationRecord {
    const now = new Date();

    return {
      id: 0,
      tenant_id: 1,
      name: "Factory Organization",
      slug: `factory-org-${crypto.randomUUID().slice(0, 8)}`,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
  }

  protected override persist(values: Partial<OrganizationRecord>): Promise<OrganizationRecord> {
    return new OrganizationRepository().create(values);
  }
}

const organizationFactory = new OrganizationFactory();

export { OrganizationFactory, organizationFactory };
