import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { applications } from "../modules/applications/repository.ts";
import type { ApplicationRecord } from "../modules/applications/table.ts";
import { Comment } from "./Comment.ts";
import { Interview } from "./Interview.ts";
import { Offer } from "./Offer.ts";
import { Position } from "./Position.ts";
import { Status } from "./Status.ts";
import { User } from "./User.ts";

export class Application extends Model<ApplicationRecord, "id"> {
  static $fillable = [
    "user_id",
    "position_id",
    "status_id",
    "attachment_text",
    "attachment_file",
  ] as const;
  static $guarded = [] as const;
  static $morphClass = "App\\Models\\Application";
  static $casts = {
    id: "integer",
    user_id: "integer",
    position_id: "integer",
    status_id: "integer",
  } as const;

  user() {
    return this.belongsTo(() => User);
  }

  position() {
    return this.belongsTo(() => Position);
  }

  status() {
    return this.belongsTo(() => Status);
  }

  comments() {
    return this.morphMany(() => Comment, "commentable");
  }

  interviews() {
    return this.hasMany(() => Interview);
  }

  offers() {
    return this.hasMany(() => Offer);
  }
}

registerModelRepository(Application, applications);
