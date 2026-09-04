import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { skills } from "../modules/skills/repository.ts";
import type { SkillRecord } from "../modules/skills/table.ts";
import { Position } from "./Position.ts";
import { User } from "./User.ts";

export class Skill extends Model<SkillRecord, "id"> {
  static $fillable = ["name"] as const;
  static $guarded = [] as const;
  static $casts = { id: "integer" } as const;

  users() {
    return this.belongsToMany(() => User, "skill_user", "skill_id", "user_id");
  }

  positions() {
    return this.belongsToMany(() => Position, "position_skill", "skill_id", "position_id");
  }
}

registerModelRepository(Skill, skills);
