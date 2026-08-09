interface ReportSummary {
  organization_count: number;
  project_count: number;
  task_count: number;
  comment_count: number;
  projects_by_status: Record<string, number>;
  tasks_by_status: Record<string, number>;
}

interface OrganizationReport {
  organization: {
    id: number;
    name: string;
    slug: string;
  };
  project_count: number;
  task_count: number;
  comment_count: number;
  projects_by_status: Record<string, number>;
  tasks_by_status: Record<string, number>;
}

export type { OrganizationReport, ReportSummary };
