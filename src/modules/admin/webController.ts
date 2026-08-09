import type { AppDependencies } from "@getstrata/bootstrap/contracts";
import { resolveService } from "@getstrata/bootstrap/contracts";
import { CORE_VIEW_TOKEN } from "@getstrata/bootstrap/providers/view";
import { withErrorHandling } from "@getstrata/core/http";
import { resolveCsrfTokenForRequest } from "@getstrata/core/http/csrfToken";
import type { ViewEngine } from "@getstrata/core/view";
import { htmlResponse, isHtmxRequest } from "@getstrata/core/view";
import { adminServiceToken } from "./provider";
import type AdminService from "./service";

function parseAdminPageQuery(request?: Request): { page: number; perPage: number } {
  const url = request ? new URL(request.url) : new URL("http://localhost/");
  const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
  const perPage = Number.parseInt(url.searchParams.get("per_page") ?? "25", 10);

  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    perPage: Number.isInteger(perPage) && perPage > 0 ? Math.min(perPage, 100) : 25,
  };
}

class AdminWebController {
  constructor(private readonly dependencies: AppDependencies) {}

  private get service(): AdminService {
    return resolveService(this.dependencies, adminServiceToken);
  }

  private get view(): ViewEngine {
    return resolveService(this.dependencies, CORE_VIEW_TOKEN);
  }

  readonly dashboard = withErrorHandling(async (request?: Request) => {
    const auditQuery = parseAdminPageQuery(request);
    const [stats, tenants, features, queueMetrics, failedJobs, auditResult] = await Promise.all([
      this.service.stats(),
      this.service.listTenants(),
      Promise.resolve(this.service.featureFlags()),
      this.service.queueMetrics(),
      this.service.listFailedJobs(10),
      this.service.paginateAuditLogs({ page: auditQuery.page, perPage: 10 }),
    ]);
    const httpMetrics = this.service.httpMetricsSummary();
    const csrfToken = request ? resolveCsrfTokenForRequest(request) : "";

    return htmlResponse(
      await this.view.render("admin/dashboard", {
        title: "Admin dashboard",
        stats,
        tenants,
        features,
        queueMetrics,
        httpMetrics,
        failedJobs,
        auditLogs: auditResult.data,
        auditMeta: auditResult.meta,
        csrfToken,
      }),
    );
  });

  readonly queue = withErrorHandling(async (request?: Request) => {
    const [queueMetrics, failedJobs] = await Promise.all([
      this.service.queueMetrics(),
      this.service.listFailedJobs(),
    ]);
    const csrfToken = request ? resolveCsrfTokenForRequest(request) : "";

    return htmlResponse(
      await this.view.render("admin/queue", {
        title: "Queue monitor",
        queueMetrics,
        failedJobs,
        csrfToken,
      }),
    );
  });

  readonly queueStatus = withErrorHandling(async (request?: Request) => {
    const [queueMetrics, failedJobs] = await Promise.all([
      this.service.queueMetrics(),
      this.service.listFailedJobs(),
    ]);
    const csrfToken = request ? resolveCsrfTokenForRequest(request) : "";

    return htmlResponse(
      await this.view.render(
        "admin/_queue_status",
        {
          queueMetrics,
          failedJobs,
          csrfToken,
        },
        { layout: false },
      ),
    );
  });

  private async renderFailedJobsPanel(request: Request, flashMessage?: string): Promise<Response> {
    const [queueMetrics, failedJobs] = await Promise.all([
      this.service.queueMetrics(),
      this.service.listFailedJobs(),
    ]);

    return htmlResponse(
      await this.view.render(
        "admin/_failed_jobs",
        {
          queueMetrics,
          failedJobs,
          csrfToken: resolveCsrfTokenForRequest(request),
          flashMessage,
        },
        { layout: false },
      ),
    );
  }

  readonly retryFailedJob = withErrorHandling(async (request: Request) => {
    const params = (request as Request & { params?: { id: string } }).params;
    const id = Number.parseInt(params?.id ?? "", 10);

    if (!Number.isInteger(id) || id <= 0) {
      throw new Error("Failed job id is required.");
    }

    await this.service.retryFailedJob(id);

    return this.renderFailedJobsPanel(request, `Retried failed job #${id}.`);
  });

  readonly deleteFailedJob = withErrorHandling(async (request: Request) => {
    const params = (request as Request & { params?: { id: string } }).params;
    const id = Number.parseInt(params?.id ?? "", 10);

    if (!Number.isInteger(id) || id <= 0) {
      throw new Error("Failed job id is required.");
    }

    await this.service.deleteFailedJob(id);

    return this.renderFailedJobsPanel(request, `Deleted failed job #${id}.`);
  });

  readonly audit = withErrorHandling(async (request?: Request) => {
    const query = parseAdminPageQuery(request);
    const result = await this.service.paginateAuditLogs(query);
    const viewData = {
      title: "Audit log",
      auditLogs: result.data,
      auditMeta: result.meta,
      csrfToken: request ? resolveCsrfTokenForRequest(request) : "",
    };

    if (request && isHtmxRequest(request)) {
      return htmlResponse(await this.view.render("admin/_audit_logs", viewData, { layout: false }));
    }

    return htmlResponse(await this.view.render("admin/audit", viewData));
  });

  readonly resources = withErrorHandling(async (request?: Request) => {
    return htmlResponse(
      await this.view.render("admin/resources", {
        title: "Admin resources",
        resources: this.service.listResources(),
        csrfToken: request ? resolveCsrfTokenForRequest(request) : "",
      }),
    );
  });

  readonly resourceIndex = withErrorHandling(async (request?: Request) => {
    const params = (request as Request & { params?: { name: string } }).params;
    const name = params?.name ?? "";
    const query = parseAdminPageQuery(request);
    const resource = this.service.listResources().find((entry) => entry.name === name);

    if (!resource) {
      throw new Error(`Admin resource "${name}" not found.`);
    }

    const result = await this.service.paginateResource(name, query);

    return htmlResponse(
      await this.view.render("admin/resource_index", {
        title: resource.labelPlural,
        resource,
        rows: result.data,
        meta: result.meta,
        csrfToken: request ? resolveCsrfTokenForRequest(request) : "",
      }),
    );
  });

  readonly resourceShow = withErrorHandling(async (request?: Request) => {
    const params = (request as Request & { params?: { name: string; id: string } }).params;
    const name = params?.name ?? "";
    const id = Number.parseInt(params?.id ?? "", 10);

    if (!Number.isInteger(id) || id <= 0) {
      throw new Error("Resource id is required.");
    }

    const { resource, record } = await this.service.findResourceRecord(name, id);

    return htmlResponse(
      await this.view.render("admin/resource_show", {
        title: `${resource.label} #${id}`,
        resource,
        record,
        csrfToken: request ? resolveCsrfTokenForRequest(request) : "",
      }),
    );
  });
}

export default AdminWebController;
