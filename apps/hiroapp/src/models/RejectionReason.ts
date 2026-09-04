import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { rejectionReasons } from "../modules/rejections/repository.ts";
import type { RejectionReasonRecord } from "../modules/rejections/table.ts";
import { ApplicationRejection } from "./ApplicationRejection.ts";

export class RejectionReason extends Model<RejectionReasonRecord, "id"> {
  static $fillable = ["name"] as const;
  static $guarded = [] as const;
  static $morphClass = "App\\Models\\RejectionReason";
  static $casts = {
    id: "integer",
  } as const;

  rejections() {
    return this.hasMany(() => ApplicationRejection, "reason_id");
  }
}

registerModelRepository(RejectionReason, rejectionReasons);
