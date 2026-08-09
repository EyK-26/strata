import type { AppModule } from "@getstrata/bootstrap/contracts";
import { CACHE_TAGS } from "@getstrata/core/cache/tags";
import AttachmentController, { createAttachmentRoutes } from "./controller";
import attachmentProvider, { attachmentRepositoryToken, attachmentServiceToken } from "./provider";
import { attachmentTable } from "./table";
import { createAttachmentWebRoutes } from "./webController";

const attachmentModule: AppModule = {
  name: "attachment",
  order: 45,
  tableName: attachmentTable.name,
  cacheTags: [CACHE_TAGS.attachments],
  providers: [attachmentProvider],
  routes({ dependencies, cachedJson, kernel }) {
    return createAttachmentRoutes(dependencies, cachedJson, kernel);
  },
  webRoutes({ dependencies, kernel }) {
    return createAttachmentWebRoutes(dependencies, kernel);
  },
};

export default attachmentModule;
export { createAttachmentRoutes } from "./controller";
export { attachmentTable } from "./table";
export type { AttachmentRecord } from "./types";
export { createAttachmentWebRoutes } from "./webController";
export {
  AttachmentController,
  attachmentProvider,
  attachmentRepositoryToken,
  attachmentServiceToken,
};
