import { NotFoundError } from "../../core/errors/http";
import CommentRepository from "../comment/repository";
import OrganizationRepository from "../organization/repository";
import ProjectRepository from "../project/repository";
import TaskRepository from "../task/repository";
import type { OrganizationReport, ReportSummary } from "./types";

class ReportService {
  constructor(
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectRepository: ProjectRepository,
    private readonly taskRepository: TaskRepository,
    private readonly commentRepository: CommentRepository,
  ) {}

  async getSummary(): Promise<ReportSummary> {
    const [organizations, projects, tasks, comments] = await Promise.all([
      this.organizationRepository.findAll(),
      this.projectRepository.findAll(),
      this.taskRepository.findAll(),
      this.commentRepository.findAll(),
    ]);

    return {
      organization_count: organizations.length,
      project_count: projects.length,
      task_count: tasks.length,
      comment_count: comments.length,
      projects_by_status: this.countByField(projects, "status"),
      tasks_by_status: this.countByField(tasks, "status"),
    };
  }

  async getOrganizationReport(organizationId: number): Promise<OrganizationReport> {
    const organization = await this.organizationRepository.findByIdOrThrow(
      organizationId,
      (id) => new NotFoundError(`Organization ${id} not found.`),
    );

    const projects = await this.projectRepository.findAll({
      where: { organization_id: organizationId },
    });
    const projectIds = projects.map((project) => project.id);
    const tasks =
      projectIds.length === 0
        ? []
        : await this.taskRepository.findAll({
            where: { project_id: projectIds },
          });
    const taskIds = tasks.map((task) => task.id);
    const comments =
      taskIds.length === 0
        ? []
        : await this.commentRepository.findAll({
            where: { task_id: taskIds },
          });

    return {
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
      },
      project_count: projects.length,
      task_count: tasks.length,
      comment_count: comments.length,
      projects_by_status: this.countByField(projects, "status"),
      tasks_by_status: this.countByField(tasks, "status"),
    };
  }

  private countByField<TRecord extends object, K extends keyof TRecord & string>(
    records: readonly TRecord[],
    field: K,
  ): Record<string, number> {
    return records.reduce<Record<string, number>>((counts, record) => {
      const value = String(record[field]);
      counts[value] = (counts[value] ?? 0) + 1;
      return counts;
    }, {});
  }
}

export default ReportService;
