import { BaseRepository } from "../../core/database";
import { organizationTable } from "./table";
import type { OrganizationRecord } from "./types";

class OrganizationRepository extends BaseRepository<OrganizationRecord, "id"> {
  constructor() {
    super(organizationTable);
  }

  async findBySlug(slug: string): Promise<OrganizationRecord | null> {
    return await this.firstOrNull({ slug });
  }
}

export default OrganizationRepository;
