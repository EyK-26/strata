import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { interviews } from "../modules/interviews/repository.ts";
import type { InterviewRecord } from "../modules/interviews/table.ts";
import { Application } from "./Application.ts";
import { User } from "./User.ts";

export class Interview extends Model<InterviewRecord, "id"> {
  static $fillable = [
    "application_id",
    "created_by",
    "scheduled_at",
    "place",
    "notes",
    "status",
    "tenant_id",
  ] as const;
  static $guarded = [] as const;
  static $morphClass = "App\\Models\\Interview";
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

registerModelRepository(Interview, interviews);
