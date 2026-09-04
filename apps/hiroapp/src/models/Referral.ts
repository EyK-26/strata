import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { referrals } from "../modules/referrals/repository.ts";
import type { ReferralRecord } from "../modules/referrals/table.ts";
import { Position } from "./Position.ts";
import { User } from "./User.ts";

export class Referral extends Model<ReferralRecord, "id"> {
  static $fillable = [
    "position_id",
    "referred_by",
    "email",
    "name",
    "notes",
    "status",
    "tenant_id",
  ] as const;
  static $guarded = [] as const;
  static $morphClass = "App\\Models\\Referral";
  static $casts = {
    id: "integer",
    position_id: "integer",
    referred_by: "integer",
  } as const;

  position() {
    return this.belongsTo(() => Position);
  }

  referrer() {
    return this.belongsTo(() => User, "referred_by");
  }
}

registerModelRepository(Referral, referrals);
