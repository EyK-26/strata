import { formatAdminValue } from "@getstrata/core/admin/formatValue";
import type { AdminResourceRegistry } from "@getstrata/core/admin/registry";
import { NotFoundError } from "@getstrata/core/errors/http";
import { prometheusRegistry } from "@getstrata/core/metrics/prometheus";
import type { PaginatedResult } from "@getstrata/core/pagination";
import { createFailedJobService } from "@getstrata/core/queue/createAppQueue";
import type FailedJobService from "@getstrata/core/queue/failedJobService";
import { jobRegistry } from "@getstrata/core/queue/jobRegistry";
import { runQueueJob } from "@getstrata/core/queue/jobRunner";
import { collectQueueMetrics, type QueueMetricsSnapshot } from "@getstrata/core/queue/queueMetrics";
import type { FailedJobRecord } from "@getstrata/core/queue/types";
import { featureFlags } from "../../config/features";
import db from "../../db/connection";
import AuditLogRepository from "../audit/repository";
import type { AuditLogRecord } from "../audit/types";
import { createWorkHubAdminResources } from "./resources.ts";

interface AdminStats {
  user_count: number;
  organization_count: number;
  project_count: number;
  task_count: number;
  tenant_count: number;
}

interface TenantSummary {
  id: number;
  name: string;
  slug: string;
  plan: string;
  organization_count: number;
}

interface OrganizationMemberSummary {
  id: number;
  organization_id: number;
  user_id: number;
  role: string;
  created_at: string;
}

class AdminService {
  private readonly resources: AdminResourceRegistry;

  constructor(
    private readonly failedJobs: FailedJobService = createFailedJobService(),
    private readonly auditLogs: AuditLogRepository = new AuditLogRepository(),
    resources: AdminResourceRegistry = createWorkHubAdminResources(),
  ) {
    this.resources = resources;
  }

  async stats(): Promise<AdminStats> {
    const [users, organizations, projects, tasks, tenants] = await Promise.all([
      db`SELECT COUNT(*)::int AS count FROM users`,
      db`SELECT COUNT(*)::int AS count FROM organization WHERE deleted_at IS NULL`,
      db`SELECT COUNT(*)::int AS count FROM project WHERE deleted_at IS NULL`,
      db`SELECT COUNT(*)::int AS count FROM task WHERE deleted_at IS NULL`,
      db`SELECT COUNT(*)::int AS count FROM tenant`,
    ]);

    return {
      user_count: (users[0] as { count: number }).count,
      organization_count: (organizations[0] as { count: number }).count,
      project_count: (projects[0] as { count: number }).count,
      task_count: (tasks[0] as { count: number }).count,
      tenant_count: (tenants[0] as { count: number }).count,
    };
  }

  async listTenants(): Promise<TenantSummary[]> {
    const rows = (await db`
      SELECT
        t.id,
        t.name,
        t.slug,
        t.plan,
        COUNT(o.id)::int AS organization_count
      FROM tenant t
      LEFT JOIN organization o ON o.tenant_id = t.id AND o.deleted_at IS NULL
      GROUP BY t.id, t.name, t.slug, t.plan
      ORDER BY t.id
    `) as Array<{
      id: number;
      name: string;
      slug: string;
      plan: string;
      organization_count: number;
    }>;

    return rows;
  }

  async listOrganizationMembers(limit = 100): Promise<OrganizationMemberSummary[]> {
    const rows = (await db`
      SELECT id, organization_id, user_id, role, created_at
      FROM organization_member
      ORDER BY id
      LIMIT ${limit}
    `) as Array<{
      id: number;
      organization_id: number;
      user_id: number;
      role: string;
      created_at: Date;
    }>;

    return rows.map((row) => ({
      ...row,
      created_at: row.created_at.toISOString(),
    }));
  }

  featureFlags(): typeof featureFlags {
    return featureFlags;
  }

  queueMetrics(): Promise<QueueMetricsSnapshot> {
    return collectQueueMetrics();
  }

  httpMetricsSummary() {
    return prometheusRegistry.getHttpRequestSummary();
  }

  listFailedJobs(limit = 50): Promise<FailedJobRecord[]> {
    return this.failedJobs.listRecent(limit);
  }

  async retryFailedJob(id: number): Promise<FailedJobRecord> {
    const failedJob = await this.failedJobs.retry(id);
    const job = jobRegistry.create(failedJob.job_name);

    if (!job) {
      throw new Error(`Unknown job "${failedJob.job_name}".`);
    }

    await runQueueJob(
      {
        name: failedJob.job_name,
        payload: failedJob.payload,
        attempts: 0,
      },
      this.failedJobs,
    );

    return failedJob;
  }

  async deleteFailedJob(id: number): Promise<void> {
    await this.failedJobs.delete(id);
  }

  paginateAuditLogs(options: {
    page: number;
    perPage: number;
  }): Promise<PaginatedResult<AuditLogRecord>> {
    return this.auditLogs.paginate(options);
  }

  listResources() {
    return this.resources.list();
  }

  paginateResource(name: string, options: { page: number; perPage: number }) {
    const resource = this.resources.get(name);

    if (!resource) {
      throw new NotFoundError(`Admin resource "${name}" not found.`);
    }

    return resource.handlers.paginate(options);
  }

  async findResourceRecord(name: string, id: number) {
    const resource = this.resources.get(name);

    if (!resource?.handlers.findById) {
      throw new NotFoundError(`Admin resource "${name}" not found.`);
    }

    const record = await resource.handlers.findById(id);

    if (!record) {
      throw new NotFoundError(`${resource.label} ${id} not found.`);
    }

    return { resource, record };
  }

  formatResourceValue(value: unknown, type?: Parameters<typeof formatAdminValue>[1]) {
    return formatAdminValue(value, type);
  }
}

export default AdminService;
export type { AdminStats, OrganizationMemberSummary, TenantSummary };
