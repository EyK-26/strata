import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { offers } from "../modules/offers/repository.ts";
import type { OfferRecord } from "../modules/offers/table.ts";
import { Application } from "./Application.ts";
import { User } from "./User.ts";

export class Offer extends Model<OfferRecord, "id"> {
  static $fillable = [
    "application_id",
    "created_by",
    "salary",
    "starts_on",
    "status",
    "notes",
    "tenant_id",
  ] as const;
  static $guarded = [] as const;
  static $morphClass = "App\\Models\\Offer";
  static $casts = {
    id: "integer",
    application_id: "integer",
    created_by: "integer",
    salary: "integer",
  } as const;

  application() {
    return this.belongsTo(() => Application);
  }

  creator() {
    return this.belongsTo(() => User, "created_by");
  }
}

registerModelRepository(Offer, offers);
