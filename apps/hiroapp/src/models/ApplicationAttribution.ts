import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { applicationAttributions } from "../modules/sources/repository.ts";
import type { ApplicationAttributionRecord } from "../modules/sources/table.ts";
import { Application } from "./Application.ts";
import { ApplicationSource } from "./ApplicationSource.ts";
import { User } from "./User.ts";

export class ApplicationAttribution extends Model<ApplicationAttributionRecord, "id"> {
  static $fillable = ["application_id", "source_id", "created_by", "notes", "tenant_id"] as const;
  static $guarded = [] as const;
  static $morphClass = "App\\Models\\ApplicationAttribution";
  static $casts = {
    id: "integer",
    application_id: "integer",
    source_id: "integer",
    created_by: "integer",
  } as const;

  application() {
    return this.belongsTo(() => Application);
  }

  source() {
    return this.belongsTo(() => ApplicationSource, "source_id");
  }

  creator() {
    return this.belongsTo(() => User, "created_by");
  }
}

registerModelRepository(ApplicationAttribution, applicationAttributions);
