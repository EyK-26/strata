import { grades, roles, statuses } from "./repository.ts";
import type { GradeRecord, RoleRecord, StatusRecord } from "./tables.ts";

export type CatalogNamed = {
  id: number;
  name: string;
};

export class CatalogService {
  present(row: RoleRecord | GradeRecord | StatusRecord): CatalogNamed {
    return { id: Number(row.id), name: row.name };
  }

  async roles() {
    return (await roles.findAll({ orderBy: { column: "id", direction: "ASC" } })).map((row) =>
      this.present(row),
    );
  }

  async grades() {
    return (await grades.findAll({ orderBy: { column: "id", direction: "ASC" } })).map((row) =>
      this.present(row),
    );
  }

  async statuses() {
    return (await statuses.all()).map((row) => this.present(row));
  }

  async snapshot() {
    const [roleRows, gradeRows, statusRows] = await Promise.all([
      this.roles(),
      this.grades(),
      this.statuses(),
    ]);
    return { roles: roleRows, grades: gradeRows, statuses: statusRows };
  }

  async statusById(id: number) {
    const row = await statuses.findById(id);
    return row ? this.present(row) : null;
  }
}

export const catalogService = new CatalogService();
