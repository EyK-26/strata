import { TenantRepository } from "../../lib/tenantRepository.ts";
import { type InterviewRecord, interviewTable } from "./table.ts";

class InterviewRepository extends TenantRepository<InterviewRecord, "id"> {
  constructor() {
    super(interviewTable);
  }

  async forApplication(applicationId: number) {
    return this.findWhere(
      { application_id: applicationId },
      { orderBy: { column: "scheduled_at", direction: "ASC" } },
    );
  }

  async forApplications(applicationIds: number[]) {
    if (applicationIds.length === 0) {
      return [];
    }
    return this.findWhere(
      { application_id: { in: applicationIds } },
      { orderBy: { column: "scheduled_at", direction: "ASC" } },
    );
  }
}

export const interviews = new InterviewRepository();
export type { InterviewRecord };
