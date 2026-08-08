import { parsePositiveIntParam } from "../../core/http";

type OrganizationReportParams = { id: string };

function parseOrganizationReportParams(params: OrganizationReportParams): { id: number } {
  return {
    id: parsePositiveIntParam(params.id, "organization id"),
  };
}

export type { OrganizationReportParams };
export { parseOrganizationReportParams };
