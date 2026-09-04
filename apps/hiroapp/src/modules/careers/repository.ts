import { TenantRepository } from "../../lib/tenantRepository.ts";
import { type CareerPostingRecord, careerPostingTable } from "./table.ts";

class CareerPostingRepository extends TenantRepository<CareerPostingRecord, "id"> {
  constructor() {
    super(careerPostingTable);
  }

  async forPosition(positionId: number) {
    return this.firstOrNull({ position_id: positionId });
  }

  async published() {
    return this.findWhere({ status: "published" });
  }
}

export const careerPostings = new CareerPostingRepository();
export type { CareerPostingRecord };
