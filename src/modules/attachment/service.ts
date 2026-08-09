import { randomUUID } from "node:crypto";
import { currentAuthUser } from "@getstrata/core/auth/authContext";
import {
  assertResourceInCurrentTenant,
  emptyPaginateResult,
  scopedOrganizationIds,
} from "@getstrata/core/auth/membershipScope";
import { runInTransaction } from "@getstrata/core/database";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "@getstrata/core/errors/http";
import type { ParsedUpload } from "@getstrata/core/http";
import type { StorageManager } from "@getstrata/core/storage/storage";
import type OrganizationRepository from "../organization/repository";
import type ProjectRepository from "../project/repository";
import type TaskRepository from "../task/repository";
import type AttachmentRepository from "./repository";
import type { AttachmentRecord } from "./types";

export type AttachmentWithScope = AttachmentRecord & { organization_id?: number };

interface CreateAttachmentInput {
  taskId: number;
  upload: ParsedUpload;
}

function buildStoragePath(taskId: number, fileName: string): string {
  return `attachments/task-${taskId}/${randomUUID()}-${fileName}`;
}

class AttachmentService {
  constructor(
    private readonly repository: AttachmentRepository,
    private readonly taskRepository: TaskRepository,
    private readonly projectRepository: ProjectRepository,
    private readonly organizationRepository: OrganizationRepository,
    private readonly storageManager: StorageManager,
  ) {}

  async listByTaskId(taskId: number): Promise<AttachmentRecord[]> {
    if (!(await this.canAccessTask(taskId))) {
      return [];
    }

    return await this.repository.findByTaskId(taskId);
  }

  async findByIdOrThrow(id: number): Promise<AttachmentWithScope> {
    const attachment = await this.repository.findByIdOrThrow(
      id,
      (attachmentId) => new NotFoundError(`Attachment ${attachmentId} not found.`),
    );

    const task = await this.taskRepository.findById(attachment.task_id);

    if (!task) {
      throw new NotFoundError(`Attachment ${id} not found.`);
    }

    const project = await this.projectRepository.findById(task.project_id);

    if (!project) {
      throw new NotFoundError(`Attachment ${id} not found.`);
    }

    assertResourceInCurrentTenant(attachment.tenant_id, "Attachment", id);

    if (!(await this.canAccessTask(attachment.task_id, task.project_id))) {
      throw new NotFoundError(`Attachment ${id} not found.`);
    }

    return {
      ...attachment,
      organization_id: project.organization_id,
    };
  }

  create(input: CreateAttachmentInput): Promise<AttachmentRecord> {
    const user = currentAuthUser();

    if (!user) {
      throw new UnauthorizedError("Authentication required.");
    }

    return runInTransaction(async (connection) => {
      const taskRepository = this.taskRepository.withConnection(connection);
      const attachmentRepository = this.repository.withConnection(connection);
      const projectRepository = this.projectRepository.withConnection(connection);
      const organizationRepository = this.organizationRepository.withConnection(connection);

      const task = await taskRepository.findById(input.taskId);

      if (!task) {
        throw new NotFoundError(`Task ${input.taskId} not found.`);
      }

      if (!(await this.canAccessTask(input.taskId, task.project_id))) {
        throw new ForbiddenError("You cannot upload attachments to this task.");
      }

      const project = await projectRepository.findById(task.project_id);

      if (!project) {
        throw new NotFoundError(`Task ${input.taskId} not found.`);
      }

      const organization = await organizationRepository.findById(project.organization_id);

      if (!organization) {
        throw new NotFoundError(`Task ${input.taskId} not found.`);
      }

      assertResourceInCurrentTenant(organization.tenant_id, "Task", input.taskId);

      const storagePath = buildStoragePath(input.taskId, input.upload.fileName);
      await this.storageManager.put(storagePath, input.upload.contents);

      return await attachmentRepository.create({
        task_id: input.taskId,
        tenant_id: organization.tenant_id,
        user_id: Number(user.id),
        original_name: input.upload.fileName,
        storage_path: storagePath,
        mime_type: input.upload.mimeType,
        size_bytes: input.upload.size,
        created_at: new Date(),
      });
    });
  }

  async readContents(
    id: number,
  ): Promise<{ attachment: AttachmentWithScope; contents: Uint8Array }> {
    const attachment = await this.findByIdOrThrow(id);
    const contents = await this.storageManager.get(attachment.storage_path);

    if (!contents) {
      throw new NotFoundError(`Attachment ${id} not found.`);
    }

    return { attachment, contents };
  }

  async delete(id: number): Promise<void> {
    const attachment = await this.findByIdOrThrow(id);
    const deleted = await this.repository.softDeleteById(id);

    if (!deleted) {
      throw new NotFoundError(`Attachment ${id} not found.`);
    }

    await this.storageManager.delete(attachment.storage_path);
  }

  async paginateByTaskId(taskId: number, options: { page: number; perPage: number }) {
    if (!(await this.canAccessTask(taskId))) {
      return emptyPaginateResult<AttachmentRecord>(options.page, options.perPage);
    }

    return this.repository.paginate({
      ...options,
      where: { task_id: taskId },
    });
  }

  private async canAccessTask(taskId: number, projectIdHint?: number): Promise<boolean> {
    const organizationIds = scopedOrganizationIds();

    if (organizationIds === null) {
      return true;
    }

    if (organizationIds.length === 0) {
      return false;
    }

    const task =
      projectIdHint === undefined
        ? await this.taskRepository.findById(taskId)
        : { project_id: projectIdHint };

    if (!task) {
      return false;
    }

    const project = await this.projectRepository.findById(task.project_id);

    return project ? organizationIds.includes(project.organization_id) : false;
  }
}

export default AttachmentService;
export type { CreateAttachmentInput };
export { buildStoragePath };
