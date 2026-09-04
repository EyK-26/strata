import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { type DepartmentRecord, departmentTable } from "./table.ts";

class DepartmentRepository extends BaseRepository<DepartmentRecord, "id"> {
  constructor() {
    super(departmentTable);
  }

  async ordered() {
    return this.findAll({ orderBy: { column: "name", direction: "ASC" } });
  }
}

export const departments = new DepartmentRepository();
