import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { grades } from "../modules/catalog/repository.ts";
import type { GradeRecord } from "../modules/catalog/tables.ts";
import { Position } from "./Position.ts";

export class Grade extends Model<GradeRecord, "id"> {
  static $fillable = ["name"] as const;
  static $guarded = [] as const;
  static $casts = { id: "integer" } as const;

  positions() {
    return this.hasMany(() => Position);
  }
}

registerModelRepository(Grade, grades);
