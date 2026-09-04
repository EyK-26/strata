import { TenantRepository } from "../../lib/tenantRepository.ts";
import { type CandidateTagRecord, candidateTagTable } from "./table.ts";

class CandidateTagRepository extends TenantRepository<CandidateTagRecord, "id"> {
  constructor() {
    super(candidateTagTable);
  }

  async forUser(userId: number) {
    return this.findWhere({ user_id: userId }, { orderBy: { column: "label", direction: "ASC" } });
  }

  async findPair(userId: number, label: string) {
    return this.firstOrNull({ user_id: userId, label });
  }
}

export const candidateTags = new CandidateTagRepository();
export type { CandidateTagRecord };
