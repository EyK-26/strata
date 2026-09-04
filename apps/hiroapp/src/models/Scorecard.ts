import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { scorecards } from "../modules/scorecards/repository.ts";
import type { ScorecardRecord } from "../modules/scorecards/table.ts";
import { Interview } from "./Interview.ts";
import { User } from "./User.ts";

export class Scorecard extends Model<ScorecardRecord, "id"> {
  static $fillable = [
    "interview_id",
    "user_id",
    "overall_score",
    "recommendation",
    "notes",
    "tenant_id",
  ] as const;
  static $guarded = [] as const;
  static $morphClass = "App\\Models\\Scorecard";
  static $casts = {
    id: "integer",
    interview_id: "integer",
    user_id: "integer",
    overall_score: "integer",
  } as const;

  interview() {
    return this.belongsTo(() => Interview);
  }

  reviewer() {
    return this.belongsTo(() => User, "user_id");
  }
}

registerModelRepository(Scorecard, scorecards);
