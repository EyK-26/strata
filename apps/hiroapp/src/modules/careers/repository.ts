import { TenantRepository } from "../../lib/tenantRepository.ts";
import { type CareerPostingRecord, careerPostingTable } from "./table.ts";

class CareerPostingRepository extends TenantRepository<CareerPostingRecord, "id"> {
  constructor() {
    super(careerPostingTable);
  }

  async forPosition(positionId: number) {
    return this.firstOrNull({ position_id: positionId });
  }

  async listed() {
    return this.findWhere({ status: { in: ["published", "scheduled"] } });
  }
}

export const careerPostings = new CareerPostingRepository();
export type { CareerPostingRecord };
