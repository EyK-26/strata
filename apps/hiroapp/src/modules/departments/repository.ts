import { TenantRepository } from "../../lib/tenantRepository.ts";
import { type DepartmentRecord, departmentTable } from "./table.ts";

class DepartmentRepository extends TenantRepository<DepartmentRecord, "id"> {
  constructor() {
    super(departmentTable);
  }

  async ordered() {
    return this.findAll({ orderBy: { column: "name", direction: "ASC" } });
  }

  async findByName(name: string) {
    return this.firstOrNull({ name });
  }
}

export const departments = new DepartmentRepository();
