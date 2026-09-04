import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { applicationSources } from "../modules/sources/repository.ts";
import type { ApplicationSourceRecord } from "../modules/sources/table.ts";
import { ApplicationAttribution } from "./ApplicationAttribution.ts";

export class ApplicationSource extends Model<ApplicationSourceRecord, "id"> {
  static $fillable = ["name"] as const;
  static $guarded = [] as const;
  static $morphClass = "App\\Models\\ApplicationSource";
  static $casts = {
    id: "integer",
  } as const;

  attributions() {
    return this.hasMany(() => ApplicationAttribution, "source_id");
  }
}

registerModelRepository(ApplicationSource, applicationSources);
