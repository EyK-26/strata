import type { AppModule } from "@getstrata/bootstrap/contracts";
import { CACHE_TAGS } from "@getstrata/core/cache/tags";
import TaskController from "./controller";
import taskProvider, { taskRepositoryToken, taskServiceToken } from "./provider";
import { createTaskRoutes } from "./routes";
import { taskTable } from "./table";
import { createTaskWebRoutes } from "./webRoutes";

const taskModule: AppModule = {
  name: "task",
  order: 40,
  tableName: taskTable.name,
  cacheTags: [CACHE_TAGS.tasks, CACHE_TAGS.reports, CACHE_TAGS.comments],
  providers: [taskProvider],
  routes({ dependencies, cachedJson, kernel }) {
    return createTaskRoutes(dependencies, cachedJson, kernel);
  },
  webRoutes({ dependencies, kernel }) {
    return createTaskWebRoutes(dependencies, kernel);
  },
};

export default taskModule;
export { TaskFactory, taskFactory } from "./factory";
export { TaskModel, taskRepository } from "./model";
export { taskBelongsToProject } from "./relationships";
export { default as TaskRepository } from "./repository";
export {
  parseCreateTaskBody,
  parseTaskIdParams,
  parseTaskListQuery,
  parseUpdateTaskBody,
} from "./requests";
export { toTaskResource, toTaskResourceCollection } from "./resources";
export { createTaskRoutes } from "./routes";
export { default as TaskService } from "./service";
export { taskTable } from "./table";
export type { TaskRecord, TaskWithProjectRecord } from "./types";
export { TaskController, taskProvider, taskRepositoryToken, taskServiceToken };
