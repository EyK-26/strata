import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { statuses } from "../modules/catalog/repository.ts";
import type { StatusRecord } from "../modules/catalog/tables.ts";
import { Application } from "./Application.ts";

export class Status extends Model<StatusRecord, "id"> {
  static $fillable = ["name"] as const;
  static $guarded = [] as const;
  static $casts = { id: "integer" } as const;

  applications() {
    return this.hasMany(() => Application);
  }
}

registerModelRepository(Status, statuses);
