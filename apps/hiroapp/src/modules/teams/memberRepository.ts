import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { type DepartmentMemberRecord, departmentMemberTable } from "./memberTable.ts";

class DepartmentMemberRepository extends BaseRepository<DepartmentMemberRecord, "id"> {
  constructor() {
    super(departmentMemberTable);
  }

  async forUser(userId: number) {
    return this.findWhere({ user_id: userId });
  }

  async forDepartment(departmentId: number) {
    return this.findWhere({ department_id: departmentId });
  }

  async findMembership(departmentId: number, userId: number) {
    return this.firstOrNull({ department_id: departmentId, user_id: userId });
  }
}

export const departmentMembers = new DepartmentMemberRepository();
