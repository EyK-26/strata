import { belongsTo } from "@getstrata/core/database/relationships";
import type { TaskRecord } from "../task/types";
import type { CommentRecord } from "./types";

const commentBelongsToTask = belongsTo<CommentRecord, TaskRecord>({
  name: "task",
  foreignKey: "task_id",
  ownerKey: "id",
});

export { commentBelongsToTask };
