import { type AppModule } from "../../bootstrap/contracts";
import { CACHE_TAGS } from "../../core/cache/tags";
import CommentController from "./controller";
import commentProvider, {
  commentRepositoryToken,
  commentServiceToken,
} from "./provider";
import { createCommentRoutes } from "./routes";
import { commentTable } from "./table";

const commentModule: AppModule = {
  name: "comment",
  order: 30,
  tableName: commentTable.name,
  cacheTags: [CACHE_TAGS.comments],
  providers: [commentProvider],
  routes({ dependencies, cachedJson, kernel }) {
    return createCommentRoutes(dependencies, cachedJson, kernel);
  },
};

export default commentModule;
export { commentBelongsToTask } from "./relationships";
export { commentProvider, commentRepositoryToken, commentServiceToken };
export { CommentController };
export {
  parseCommentIdParams,
  parseCommentListQuery,
  parseCreateCommentBody,
  parseTaskCommentParams,
} from "./requests";
export { toCommentResource, toCommentResourceCollection } from "./resources";
export { createCommentRoutes } from "./routes";
export { default as CommentRepository } from "./repository";
export { default as CommentService } from "./service";
export { commentTable } from "./table";
export type { CommentRecord } from "./types";
