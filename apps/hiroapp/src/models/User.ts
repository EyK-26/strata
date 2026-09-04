import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { users } from "../modules/users/repository.ts";
import type { UserRecord } from "../modules/users/table.ts";
import { Application } from "./Application.ts";
import { Notification } from "./Notification.ts";
import { Position } from "./Position.ts";
import { Role } from "./Role.ts";
import { Skill } from "./Skill.ts";

export class User extends Model<UserRecord, "id"> {
  static $fillable = ["first_name", "last_name", "email", "password", "role_id"] as const;
  static $hidden = ["password"] as const;
  static $guarded = [] as const;
  static $morphClass = "App\\Models\\User";
  static $casts = {
    id: "integer",
    role_id: "integer",
  } as const;

  role() {
    return this.belongsTo(() => Role);
  }

  applications() {
    return this.hasMany(() => Application);
  }

  position() {
    return this.hasOne(() => Position);
  }

  notifications() {
    return this.morphMany(() => Notification, "notifiable");
  }

  skills() {
    return this.belongsToMany(() => Skill, "skill_user", "user_id", "skill_id");
  }

  watching() {
    return this.belongsToMany(() => Position, "position_watchers", "user_id", "position_id");
  }
}

registerModelRepository(User, users);
