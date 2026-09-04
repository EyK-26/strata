import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { positions } from "../modules/positions/repository.ts";
import type { PositionRecord } from "../modules/positions/table.ts";
import { Application } from "./Application.ts";
import { Comment } from "./Comment.ts";
import { Department } from "./Department.ts";
import { Grade } from "./Grade.ts";
import { Referral } from "./Referral.ts";
import { Skill } from "./Skill.ts";
import { User } from "./User.ts";

export class Position extends Model<PositionRecord, "id"> {
  static $fillable = [
    "user_id",
    "department_id",
    "grade_id",
    "name",
    "description",
    "hiring",
    "start_date",
    "end_date",
  ] as const;
  static $guarded = [] as const;
  static $morphClass = "App\\Models\\Position";
  static $casts = {
    id: "integer",
    user_id: "integer",
    department_id: "integer",
    grade_id: "integer",
    hiring: "boolean",
  } as const;

  user() {
    return this.belongsTo(() => User);
  }

  department() {
    return this.belongsTo(() => Department);
  }

  grade() {
    return this.belongsTo(() => Grade);
  }

  applications() {
    return this.hasMany(() => Application);
  }

  skills() {
    return this.belongsToMany(() => Skill, "position_skill", "position_id", "skill_id");
  }

  watchers() {
    return this.belongsToMany(() => User, "position_watchers", "position_id", "user_id");
  }

  interviewers() {
    return this.belongsToMany(() => User, "position_interviewers", "position_id", "user_id");
  }

  comments() {
    return this.morphMany(() => Comment, "commentable");
  }

  referrals() {
    return this.hasMany(() => Referral);
  }
}

registerModelRepository(Position, positions);
