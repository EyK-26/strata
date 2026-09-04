import { TenantRepository } from "../../lib/tenantRepository.ts";
import { type ScorecardRecord, scorecardTable } from "./table.ts";

class ScorecardRepository extends TenantRepository<ScorecardRecord, "id"> {
  constructor() {
    super(scorecardTable);
  }

  async forInterview(interviewId: number) {
    return this.findWhere({ interview_id: interviewId });
  }

  async findPair(interviewId: number, userId: number) {
    return this.firstOrNull({ interview_id: interviewId, user_id: userId });
  }
}

export const scorecards = new ScorecardRepository();
export type { ScorecardRecord };
