import { TenantRepository } from "../../lib/tenantRepository.ts";
import { type DepartmentInvitationRecord, departmentInvitationTable } from "./invitationTable.ts";

class DepartmentInvitationRepository extends TenantRepository<DepartmentInvitationRecord, "id"> {
  constructor() {
    super(departmentInvitationTable);
  }

  async forDepartment(departmentId: number) {
    return this.findWhere({ department_id: departmentId });
  }

  async forEmail(email: string) {
    return this.findWhere({ email: email.toLowerCase() });
  }

  async findOpen(departmentId: number, email: string) {
    return this.firstOrNull({ department_id: departmentId, email: email.toLowerCase() });
  }
}

export const departmentInvitations = new DepartmentInvitationRepository();
