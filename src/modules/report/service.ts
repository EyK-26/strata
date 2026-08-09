import { assertResourceInCurrentTenant } from "@getstrata/core/auth/membershipScope";
import { NotFoundError } from "@getstrata/core/errors/http";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import type CommentRepository from "../comment/repository";
import type OrganizationRepository from "../organization/repository";
import type ProjectRepository from "../project/repository";
import type TaskRepository from "../task/repository";
import type { OrganizationReport, ReportSummary } from "./types";

class ReportService {
  constructor(
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectRepository: ProjectRepository,
    private readonly taskRepository: TaskRepository,
    private readonly commentRepository: CommentRepository,
  ) {}

  async getSummary(): Promise<ReportSummary> {
    const tenantId = currentTenantId();
    const organizations = await this.organizationRepository.findAll({
      where: { tenant_id: tenantId },
    });
    const organizationIds = new Set(organizations.map((organization) => organization.id));
    const projects =
      organizationIds.size === 0
        ? []
        : await this.projectRepository.findAll({
            where: { organization_id: [...organizationIds] },
          });
    const projectIds = new Set(projects.map((project) => project.id));
    const scopedTasks =
      projectIds.size === 0
        ? []
        : await this.taskRepository.findAll({
            where: { project_id: [...projectIds] },
          });
    const taskIds = new Set(scopedTasks.map((task) => task.id));
    const scopedComments =
      taskIds.size === 0
        ? []
        : await this.commentRepository.findAll({
            where: { task_id: [...taskIds] },
          });

    return {
      organization_count: organizations.length,
      project_count: projects.length,
      task_count: scopedTasks.length,
      comment_count: scopedComments.length,
      projects_by_status: this.countByField(projects, "status"),
      tasks_by_status: this.countByField(scopedTasks, "status"),
    };
  }

  async getOrganizationReport(organizationId: number): Promise<OrganizationReport> {
    const organization = await this.organizationRepository.findByIdOrThrow(
      organizationId,
      (id) => new NotFoundError(`Organization ${id} not found.`),
    );

    assertResourceInCurrentTenant(organization.tenant_id, "Organization", organizationId);

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
