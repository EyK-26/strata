import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { type PositionRecord, positionTable } from "./table.ts";

class PositionRepository extends BaseRepository<PositionRecord, "id"> {
  constructor() {
    super(positionTable);
  }

  async hiring(options: { search?: string; departmentId?: number } = {}) {
    const where: Record<string, unknown> = { hiring: true };
    if (options.departmentId) {
      where.department_id = options.departmentId;
    }
    if (options.search) {
      where.name = { ilike: `%${options.search}%` };
    }
    return this.findWhere(where);
  }

  async distinctNames() {
    const rows = await this.getConnection().unsafe<Array<{ name: string }>>(
      `SELECT DISTINCT name FROM positions ORDER BY name ASC`,
    );
    return rows;
  }

  async hiringInDepartment(departmentId: number) {
    return this.findWhere(
      { department_id: departmentId, hiring: true },
      { orderBy: { column: "name", direction: "ASC" } },
    );
  }

  async findByUserId(userId: number) {
    return this.firstOrNull({ user_id: userId });
  }

  async idsInDepartment(departmentId: number) {
    const rows = await this.findWhere({ department_id: departmentId });
    return rows.map((row) => row.id);
  }

  async occupiedUserIds(departmentId: number) {
    const rows = await this.findWhere({ department_id: departmentId });
    return rows.map((row) => row.user_id).filter((id): id is number => id !== null);
  }
}

export const positions = new PositionRepository();
export type { PositionRecord };
