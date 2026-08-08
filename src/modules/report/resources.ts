import type { OrganizationReport, ReportSummary } from "./types";

interface ReportSummaryResource extends ReportSummary {}

interface OrganizationReportResource extends OrganizationReport {}

function toReportSummaryResource(summary: ReportSummary): ReportSummaryResource {
  return summary;
}

function toOrganizationReportResource(
  report: OrganizationReport,
): OrganizationReportResource {
  return report;
}

export {
  toOrganizationReportResource,
  toReportSummaryResource,
};
export type { OrganizationReportResource, ReportSummaryResource };
