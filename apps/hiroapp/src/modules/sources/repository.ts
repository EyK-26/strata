import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { TenantRepository } from "../../lib/tenantRepository.ts";
import {
  type ApplicationAttributionRecord,
  type ApplicationSourceRecord,
  applicationAttributionTable,
  applicationSourceTable,
} from "./table.ts";

class ApplicationSourceRepository extends BaseRepository<ApplicationSourceRecord, "id"> {
  constructor() {
    super(applicationSourceTable);
  }

  async ordered() {
    return this.findAll({ orderBy: { column: "id", direction: "ASC" } });
  }
}

class ApplicationAttributionRepository extends TenantRepository<
  ApplicationAttributionRecord,
  "id"
> {
  constructor() {
    super(applicationAttributionTable);
  }

  async forApplication(applicationId: number) {
    return this.firstOrNull({ application_id: applicationId });
  }
}

export const applicationSources = new ApplicationSourceRepository();
export const applicationAttributions = new ApplicationAttributionRepository();
export type { ApplicationAttributionRecord, ApplicationSourceRecord };
