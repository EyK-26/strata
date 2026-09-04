import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { type ApplicationRecord, applicationTable } from "./table.ts";

class ApplicationRepository extends BaseRepository<ApplicationRecord, "id"> {
  constructor() {
    super(applicationTable);
  }

  async forPosition(positionId: number) {
    return this.findWhere({ position_id: positionId });
  }

  async deleteForPosition(positionId: number) {
    const rows = await this.findWhere({ position_id: positionId });
    await Promise.all(rows.map((row) => this.deleteById(row.id)));
  }

  async forPositions(positionIds: number[], extra: Record<string, unknown> = {}) {
    if (positionIds.length === 0) {
      return [];
    }
    return this.findWhere({ position_id: { in: positionIds }, ...extra });
  }

  async countForPositions(positionIds: number[], extra: Record<string, unknown> = {}) {
    if (positionIds.length === 0) {
      return 0;
    }
    return this.countWhere({ position_id: { in: positionIds }, ...extra });
  }

  async findPair(userId: number, positionId: number) {
    return this.firstOrNull({ user_id: userId, position_id: positionId });
  }
}

export const applications = new ApplicationRepository();
export type { ApplicationRecord };
