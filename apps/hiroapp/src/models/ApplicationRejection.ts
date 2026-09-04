import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { applicationRejections } from "../modules/rejections/repository.ts";
import type { ApplicationRejectionRecord } from "../modules/rejections/table.ts";
import { Application } from "./Application.ts";
import { RejectionReason } from "./RejectionReason.ts";
import { User } from "./User.ts";

export class ApplicationRejection extends Model<ApplicationRejectionRecord, "id"> {
  static $fillable = ["application_id", "reason_id", "created_by", "notes", "tenant_id"] as const;
  static $guarded = [] as const;
  static $morphClass = "App\\Models\\ApplicationRejection";
  static $casts = {
    id: "integer",
    application_id: "integer",
    reason_id: "integer",
    created_by: "integer",
  } as const;

  application() {
    return this.belongsTo(() => Application);
  }

  reason() {
    return this.belongsTo(() => RejectionReason, "reason_id");
  }

  creator() {
    return this.belongsTo(() => User, "created_by");
  }
}

registerModelRepository(ApplicationRejection, applicationRejections);
