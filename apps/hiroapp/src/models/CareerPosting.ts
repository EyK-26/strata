import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { careerPostings } from "../modules/careers/repository.ts";
import type { CareerPostingRecord } from "../modules/careers/table.ts";
import { Position } from "./Position.ts";
import { User } from "./User.ts";

export class CareerPosting extends Model<CareerPostingRecord, "id"> {
  static $fillable = ["position_id", "published_by", "status", "tenant_id"] as const;
  static $guarded = [] as const;
  static $morphClass = "App\\Models\\CareerPosting";
  static $casts = {
    id: "integer",
    position_id: "integer",
    published_by: "integer",
  } as const;

  position() {
    return this.belongsTo(() => Position);
  }

  publisher() {
    return this.belongsTo(() => User, "published_by");
  }
}

registerModelRepository(CareerPosting, careerPostings);
