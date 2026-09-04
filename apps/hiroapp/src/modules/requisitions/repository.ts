import { TenantRepository } from "../../lib/tenantRepository.ts";
import { type RequisitionRecord, requisitionTable } from "./table.ts";

class RequisitionRepository extends TenantRepository<RequisitionRecord, "id"> {
  constructor() {
    super(requisitionTable);
  }

  async forPosition(positionId: number) {
    return this.firstOrNull({ position_id: positionId });
  }
}

export const requisitions = new RequisitionRepository();
export type { RequisitionRecord };
