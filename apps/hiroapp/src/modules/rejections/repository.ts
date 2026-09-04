import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { TenantRepository } from "../../lib/tenantRepository.ts";
import {
  type ApplicationRejectionRecord,
  applicationRejectionTable,
  type RejectionReasonRecord,
  rejectionReasonTable,
} from "./table.ts";

class RejectionReasonRepository extends BaseRepository<RejectionReasonRecord, "id"> {
  constructor() {
    super(rejectionReasonTable);
  }

  async ordered() {
    return this.findAll({ orderBy: { column: "id", direction: "ASC" } });
  }
}

class ApplicationRejectionRepository extends TenantRepository<ApplicationRejectionRecord, "id"> {
  constructor() {
    super(applicationRejectionTable);
  }

  async forApplication(applicationId: number) {
    return this.findWhere({ application_id: applicationId });
  }
}

export const rejectionReasons = new RejectionReasonRepository();
export const applicationRejections = new ApplicationRejectionRepository();
export type { ApplicationRejectionRecord, RejectionReasonRecord };
