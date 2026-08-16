import { belongsTo } from "@getstrata/core/database/relationships";
import type { ProjectRecord } from "../project/types";
import type { TaskRecord } from "./types";

const taskBelongsToProject = belongsTo<TaskRecord, ProjectRecord>({
  name: "project",
  foreignKey: "project_id",
  ownerKey: "id",
});

export { taskBelongsToProject };
