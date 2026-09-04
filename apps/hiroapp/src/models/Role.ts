import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { roles } from "../modules/catalog/repository.ts";
import type { RoleRecord } from "../modules/catalog/tables.ts";
import { User } from "./User.ts";

export class Role extends Model<RoleRecord, "id"> {
  static $fillable = ["name"] as const;
  static $guarded = [] as const;
  static $casts = { id: "integer" } as const;

  users() {
    return this.hasMany(() => User);
  }
}

registerModelRepository(Role, roles);
