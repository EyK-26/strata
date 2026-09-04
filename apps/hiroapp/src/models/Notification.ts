import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { notifications } from "../modules/notifications/repository.ts";
import type { NotificationRecord } from "../modules/notifications/table.ts";
import { User } from "./User.ts";

export class Notification extends Model<NotificationRecord, "id"> {
  static $fillable = ["id", "type", "data", "read_at"] as const;
  static $guarded = [] as const;
  static $casts = {
    notifiable_id: "integer",
  } as const;

  notifiable() {
    return this.morphTo({ "App\\Models\\User": () => User }, "notifiable");
  }
}

registerModelRepository(Notification, notifications);
