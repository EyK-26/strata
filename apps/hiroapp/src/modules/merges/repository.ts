import { TenantRepository } from "../../lib/tenantRepository.ts";
import { type CandidateMergeRecord, candidateMergeTable } from "./table.ts";

class CandidateMergeRepository extends TenantRepository<CandidateMergeRecord, "id"> {
  constructor() {
    super(candidateMergeTable);
  }

  async recent() {
    return this.findAll({ orderBy: { column: "created_at", direction: "DESC" } });
  }
}

export const candidateMerges = new CandidateMergeRepository();
export type { CandidateMergeRecord };
