import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { applicationHolds } from "../modules/holds/repository.ts";
import type { ApplicationHoldRecord } from "../modules/holds/table.ts";
import { Application } from "./Application.ts";
import { User } from "./User.ts";

export class ApplicationHold extends Model<ApplicationHoldRecord, "id"> {
  static $fillable = [
    "application_id",
    "created_by",
    "released_by",
    "notes",
    "status",
    "holds_until",
    "released_at",
    "tenant_id",
  ] as const;
  static $guarded = [] as const;
  static $morphClass = "App\\Models\\ApplicationHold";
  static $casts = {
    id: "integer",
    application_id: "integer",
    created_by: "integer",
    released_by: "integer",
    holds_until: "datetime",
  } as const;

  application() {
    return this.belongsTo(() => Application);
  }

  creator() {
    return this.belongsTo(() => User, "created_by");
  }

  releasedBy() {
    return this.belongsTo(() => User, "released_by");
  }
}

registerModelRepository(ApplicationHold, applicationHolds);
