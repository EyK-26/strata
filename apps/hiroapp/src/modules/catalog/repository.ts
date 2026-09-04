import { BaseRepository } from "@getstrata/core/database/baseRepository";
import {
  type GradeRecord,
  gradeTable,
  type RoleRecord,
  roleTable,
  type StatusRecord,
  statusTable,
} from "./tables.ts";

class RoleRepository extends BaseRepository<RoleRecord, "id"> {
  constructor() {
    super(roleTable);
  }
}

class GradeRepository extends BaseRepository<GradeRecord, "id"> {
  constructor() {
    super(gradeTable);
  }
}

class StatusRepository extends BaseRepository<StatusRecord, "id"> {
  constructor() {
    super(statusTable);
  }

  async all() {
    return this.findAll({ orderBy: { column: "id", direction: "ASC" } });
  }
}

export const roles = new RoleRepository();
export const grades = new GradeRepository();
export const statuses = new StatusRepository();
