import { BaseRepository } from "@getstrata/core/database";
import type { QueryWhere } from "@getstrata/core/database/types";
import ProjectRepository from "../project/repository";
import { taskBelongsToProject } from "./relationships";
import { taskTable } from "./table";
import type { TaskRecord, TaskWithProjectRecord } from "./types";

interface TaskSearchHit {
  type: "task";
  id: number;
  snippet: string;
  rank: number;
}

class TaskRepository extends BaseRepository<TaskRecord, "id"> {
  constructor(private readonly projectRepository: ProjectRepository = new ProjectRepository()) {
    super(taskTable);
  }

  async searchFullText(query: string, tenantId: number, limit: number): Promise<TaskSearchHit[]> {
    const rows = await this.findAll({
      joins: [
        {
          type: "inner",
          table: "project",
          on: [
            {
              left: { table: "task", column: "project_id" },
              right: { table: "project", column: "id" },
            },
          ],
        },
        {
          type: "inner",
          table: "organization",
          on: [
            {
              left: { table: "project", column: "organization_id" },
              right: { table: "organization", column: "id" },
            },
          ],
        },
      ],
      where: {
        "organization.tenant_id": tenantId,
        search_vector: { tsMatch: query },
      } as QueryWhere<TaskRecord>,
      select: [
        { kind: "literalText", value: "task", as: "type" },
        { kind: "column", table: "task", column: "id", as: "id" },
        { kind: "column", table: "task", column: "title", as: "snippet" },
        { kind: "tsRank", table: "task", column: "search_vector", query, as: "rank" },
      ],
      limit,
    });

    return rows as unknown as TaskSearchHit[];
  }

  async findByProjectId(projectId: number): Promise<TaskRecord[]> {
    return await this.findWhere({ project_id: projectId });
  }

  async attachProjects(tasks: readonly TaskRecord[]): Promise<TaskWithProjectRecord[]> {
    if (tasks.length === 0) {
      return [];
    }

    const projectsById = await this.loadBelongsToForParents(
      tasks,
      taskBelongsToProject,
      this.projectRepository,
    );

    return tasks.map((task) => {
      const project = projectsById.get(task.project_id);

      return {
        ...task,
        ...(project
          ? {
              project: {
                id: project.id,
                name: project.name,
                organization_id: project.organization_id,
              },
            }
          : {}),
      };
    });
  }
}

export default TaskRepository;
export type { TaskSearchHit };
