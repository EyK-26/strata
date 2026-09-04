import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { departments } from "../modules/departments/repository.ts";
import type { DepartmentRecord } from "../modules/departments/table.ts";
import { Application } from "./Application.ts";
import { Position } from "./Position.ts";

export class Department extends Model<DepartmentRecord, "id"> {
  static $fillable = ["name"] as const;
  static $guarded = [] as const;
  static $casts = { id: "integer" } as const;

  positions() {
    return this.hasMany(() => Position);
  }

  applications() {
    return this.hasManyThrough(
      () => Application,
      () => Position,
    );
  }
}

registerModelRepository(Department, departments);
