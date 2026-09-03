import type { AppModule } from "@getstrata/bootstrap/contracts";
import { CACHE_TAGS } from "@getstrata/core/cache/tags";
import CommentController from "./controller";
import commentProvider, { commentRepositoryToken, commentServiceToken } from "./provider";
import { createCommentRoutes } from "./routes";
import { commentTable } from "./table";
import { createCommentWebRoutes } from "./webController";

const commentModule: AppModule = {
  name: "comment",
  order: 30,
  tableName: commentTable.name,
  cacheTags: [CACHE_TAGS.comments],
  providers: [commentProvider],
  routes({ dependencies, cachedJson, kernel }) {
    return createCommentRoutes(dependencies, cachedJson, kernel);
  },
  webRoutes({ dependencies, kernel }) {
    return createCommentWebRoutes(dependencies, kernel);
  },
};

export default commentModule;
export { CommentFactory, commentFactory } from "./factory";
export { CommentModel, commentRepository } from "./model";
export { commentBelongsToTask } from "./relationships";
export { default as CommentRepository } from "./repository";
export {
  parseCommentIdParams,
  parseCommentListQuery,
  parseCreateCommentBody,
  parseTaskCommentParams,
} from "./requests";
export { toCommentResource, toCommentResourceCollection } from "./resources";
export { createCommentRoutes } from "./routes";
export { default as CommentService } from "./service";
export { commentTable } from "./table";
export type { CommentRecord } from "./types";
export { CommentController, commentProvider, commentRepositoryToken, commentServiceToken };
