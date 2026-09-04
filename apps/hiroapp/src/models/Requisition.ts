import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { requisitions } from "../modules/requisitions/repository.ts";
import type { RequisitionRecord } from "../modules/requisitions/table.ts";
import { Position } from "./Position.ts";
import { User } from "./User.ts";

export class Requisition extends Model<RequisitionRecord, "id"> {
  static $fillable = [
    "position_id",
    "requested_by",
    "approved_by",
    "notes",
    "status",
    "tenant_id",
  ] as const;
  static $guarded = [] as const;
  static $morphClass = "App\\Models\\Requisition";
  static $casts = {
    id: "integer",
    position_id: "integer",
    requested_by: "integer",
    approved_by: "integer",
  } as const;

  position() {
    return this.belongsTo(() => Position);
  }

  requester() {
    return this.belongsTo(() => User, "requested_by");
  }

  approver() {
    return this.belongsTo(() => User, "approved_by");
  }
}

registerModelRepository(Requisition, requisitions);
