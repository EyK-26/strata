import { TenantRepository } from "../../lib/tenantRepository.ts";
import { type SlotRecord, slotTable } from "./table.ts";

class SlotRepository extends TenantRepository<SlotRecord, "id"> {
  constructor() {
    super(slotTable);
  }

  async forPosition(positionId: number) {
    return this.findWhere(
      { position_id: positionId },
      { orderBy: { column: "starts_at", direction: "ASC" } },
    );
  }
}

export const slots = new SlotRepository();
export type { SlotRecord };
