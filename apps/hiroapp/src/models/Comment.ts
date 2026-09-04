import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { comments } from "../modules/comments/repository.ts";
import type { CommentRecord } from "../modules/comments/table.ts";
import { Application } from "./Application.ts";
import { Position } from "./Position.ts";
import { User } from "./User.ts";

export class Comment extends Model<CommentRecord, "id"> {
  static $fillable = ["user_id", "body"] as const;
  static $guarded = [] as const;
  static $morphClass = "App\\Models\\Comment";
  static $casts = {
    id: "integer",
    user_id: "integer",
    commentable_id: "integer",
  } as const;

  user() {
    return this.belongsTo(() => User);
  }

  commentable() {
    return this.morphTo(
      {
        "App\\Models\\Application": () => Application,
        "App\\Models\\Position": () => Position,
      },
      "commentable",
    );
  }
}

registerModelRepository(Comment, comments);
