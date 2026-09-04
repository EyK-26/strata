import { recordHiringEvent } from "../../lib/hiringEvents.ts";
import { STATUS } from "../../lib/roles.ts";
import { Application } from "../../models/Application.ts";
import { positions } from "../positions/repository.ts";
import type { UserRecord } from "../users/table.ts";
import { applications } from "./repository.ts";

export type DashboardFilters = {
  department_id?: number;
  feedback?: boolean;
  hired?: boolean;
  rejected?: boolean;
  interview?: boolean;
  month?: boolean;
};

export function startOfUtcMonth(now = new Date()) {
  const start = new Date(now.getTime());
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

export class ApplicationReportingService {
  async dashboard(filters: DashboardFilters = {}) {
    const departmentId = Number(filters.department_id ?? 0);
    const positionIds = departmentId ? await positions.idsInDepartment(departmentId) : [];
    const extra: Record<string, unknown> = {};
    if (filters.feedback) extra.status_id = STATUS.FEEDBACK;
    if (filters.hired) extra.status_id = STATUS.HIRED;
    if (filters.rejected) extra.status_id = STATUS.ENDED;
    if (filters.interview) extra.status_id = STATUS.INTERVIEW;
    if (filters.month) {
      extra.created_at = { gte: startOfUtcMonth() };
    }
    return applications.forPositions(positionIds, extra);
  }

  async exportAll(actor: UserRecord) {
    const rows: Array<Record<string, unknown>> = [];
    await Application.chunk(50, async (batch) => {
      for (const application of batch) {
        rows.push(application.toArray());
      }
    });
    const cursor = await Application.cursorPaginate({ perPage: 50 });
    await recordHiringEvent(
      "applications.exported",
      { count: rows.length, user_id: actor.id },
      { type: "application" },
    );
    return {
      count: rows.length,
      data: rows,
      cursor: {
        count: cursor.data.length,
        has_more: cursor.meta.has_more,
        next_cursor: cursor.meta.next_cursor,
      },
    };
  }
}

export const reportingService = new ApplicationReportingService();
