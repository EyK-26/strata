import { BaseRepository } from "../../core/database";
import ProjectRepository from "../project/repository";
import { taskBelongsToProject } from "./relationships";
import { taskTable } from "./table";
import type { TaskRecord, TaskWithProjectRecord } from "./types";

class TaskRepository extends BaseRepository<TaskRecord, "id"> {
  constructor(private readonly projectRepository: ProjectRepository = new ProjectRepository()) {
    super(taskTable);
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
