import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { talentPool } from "../modules/pool/repository.ts";
import type { TalentPoolEntryRecord } from "../modules/pool/table.ts";
import { Application } from "./Application.ts";
import { User } from "./User.ts";

export class TalentPoolEntry extends Model<TalentPoolEntryRecord, "id"> {
  static $fillable = [
    "user_id",
    "created_by",
    "source_application_id",
    "notes",
    "status",
    "tenant_id",
  ] as const;
  static $guarded = [] as const;
  static $morphClass = "App\\Models\\TalentPoolEntry";
  static $casts = {
    id: "integer",
    user_id: "integer",
    created_by: "integer",
    source_application_id: "integer",
  } as const;

  user() {
    return this.belongsTo(() => User);
  }

  creator() {
    return this.belongsTo(() => User, "created_by");
  }

  sourceApplication() {
    return this.belongsTo(() => Application, "source_application_id");
  }
}

registerModelRepository(TalentPoolEntry, talentPool);
