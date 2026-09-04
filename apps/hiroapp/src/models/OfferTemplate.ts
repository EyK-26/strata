import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { offerTemplates } from "../modules/offerTemplates/repository.ts";
import type { OfferTemplateRecord } from "../modules/offerTemplates/table.ts";
import { User } from "./User.ts";

export class OfferTemplate extends Model<OfferTemplateRecord, "id"> {
  static $fillable = ["created_by", "name", "body", "salary", "tenant_id"] as const;
  static $guarded = [] as const;
  static $morphClass = "App\\Models\\OfferTemplate";
  static $casts = {
    id: "integer",
    created_by: "integer",
    salary: "integer",
  } as const;

  creator() {
    return this.belongsTo(() => User, "created_by");
  }
}

registerModelRepository(OfferTemplate, offerTemplates);
