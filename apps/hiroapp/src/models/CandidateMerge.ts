import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { candidateMerges } from "../modules/merges/repository.ts";
import type { CandidateMergeRecord } from "../modules/merges/table.ts";
import { User } from "./User.ts";

export class CandidateMerge extends Model<CandidateMergeRecord, "id"> {
  static $fillable = [
    "source_user_id",
    "target_user_id",
    "merged_by",
    "applications_moved",
    "applications_skipped",
    "pool_action",
    "tenant_id",
  ] as const;
  static $guarded = [] as const;
  static $morphClass = "App\\Models\\CandidateMerge";
  static $casts = {
    id: "integer",
    source_user_id: "integer",
    target_user_id: "integer",
    merged_by: "integer",
    applications_moved: "integer",
    applications_skipped: "integer",
  } as const;

  source() {
    return this.belongsTo(() => User, "source_user_id");
  }

  target() {
    return this.belongsTo(() => User, "target_user_id");
  }

  mergedBy() {
    return this.belongsTo(() => User, "merged_by");
  }
}

registerModelRepository(CandidateMerge, candidateMerges);
