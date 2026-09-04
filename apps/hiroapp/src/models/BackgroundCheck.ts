import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { backgroundChecks } from "../modules/checks/repository.ts";
import type { BackgroundCheckRecord } from "../modules/checks/table.ts";
import { Application } from "./Application.ts";
import { User } from "./User.ts";

export class BackgroundCheck extends Model<BackgroundCheckRecord, "id"> {
  static $fillable = [
    "application_id",
    "created_by",
    "vendor",
    "notes",
    "status",
    "completed_at",
    "tenant_id",
  ] as const;
  static $guarded = [] as const;
  static $morphClass = "App\\Models\\BackgroundCheck";
  static $casts = {
    id: "integer",
    application_id: "integer",
    created_by: "integer",
  } as const;

  application() {
    return this.belongsTo(() => Application);
  }

  creator() {
    return this.belongsTo(() => User, "created_by");
  }
}

registerModelRepository(BackgroundCheck, backgroundChecks);
