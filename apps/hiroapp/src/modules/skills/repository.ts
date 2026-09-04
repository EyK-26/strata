import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { type SkillRecord, skillTable } from "./table.ts";

class SkillRepository extends BaseRepository<SkillRecord, "id"> {
  constructor() {
    super(skillTable);
  }

  async ordered() {
    return this.findAll({ orderBy: { column: "name", direction: "ASC" } });
  }

  async findByName(name: string) {
    return this.firstOrNull({ name });
  }
}

export const skills = new SkillRepository();
export type { SkillRecord };
