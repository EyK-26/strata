import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { candidateTags } from "../modules/tags/repository.ts";
import type { CandidateTagRecord } from "../modules/tags/table.ts";
import { User } from "./User.ts";

export class CandidateTag extends Model<CandidateTagRecord, "id"> {
  static $fillable = ["user_id", "created_by", "label", "tenant_id"] as const;
  static $guarded = [] as const;
  static $morphClass = "App\\Models\\CandidateTag";
  static $casts = {
    id: "integer",
    user_id: "integer",
    created_by: "integer",
  } as const;

  user() {
    return this.belongsTo(() => User);
  }

  creator() {
    return this.belongsTo(() => User, "created_by");
  }
}

registerModelRepository(CandidateTag, candidateTags);
