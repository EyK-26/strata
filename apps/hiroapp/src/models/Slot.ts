import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { slots } from "../modules/slots/repository.ts";
import type { SlotRecord } from "../modules/slots/table.ts";
import { Interview } from "./Interview.ts";
import { Position } from "./Position.ts";
import { User } from "./User.ts";

export class Slot extends Model<SlotRecord, "id"> {
  static $fillable = [
    "position_id",
    "created_by",
    "starts_at",
    "ends_at",
    "status",
    "booked_by",
    "interview_id",
    "tenant_id",
  ] as const;
  static $guarded = [] as const;
  static $morphClass = "App\\Models\\Slot";
  static $casts = {
    id: "integer",
    position_id: "integer",
    created_by: "integer",
    booked_by: "integer",
    interview_id: "integer",
  } as const;

  position() {
    return this.belongsTo(() => Position);
  }

  creator() {
    return this.belongsTo(() => User, "created_by");
  }

  bookedBy() {
    return this.belongsTo(() => User, "booked_by");
  }

  interview() {
    return this.belongsTo(() => Interview);
  }
}

registerModelRepository(Slot, slots);
