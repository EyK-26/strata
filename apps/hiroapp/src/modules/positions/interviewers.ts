import { ForbiddenError, UnprocessableEntityError } from "@getstrata/core/errors/http";
import { recordHiringEvent } from "../../lib/hiringEvents.ts";
import { isStaff } from "../../lib/roles.ts";
import type { Position } from "../../models/Position.ts";
import { users } from "../users/repository.ts";
import type { UserRecord } from "../users/table.ts";

export type SyncInterviewersInput = {
  user_ids: number[];
  role?: string;
};

function panelRole(role?: string) {
  const trimmed = role?.trim() ?? "";
  return trimmed || "panel";
}

export class InterviewerService {
  async list(position: Position) {
    return position.interviewers();
  }

  async sync(actor: UserRecord, position: Position, input: SyncInterviewersInput) {
    if (!isStaff(actor.role_id)) {
      throw new ForbiddenError("Only staff can assign interviewers.");
    }
    const unique = [...new Set(input.user_ids.map(Number))].filter(
      (id) => Number.isInteger(id) && id > 0,
    );
    const staffIds: number[] = [];
    for (const id of unique) {
      const user = await users.findById(id);
      if (!user || !isStaff(user.role_id)) {
        throw new UnprocessableEntityError("Interviewers must be staff users.");
      }
      staffIds.push(user.id);
    }
    const role = panelRole(input.role);
    await position.interviewers().withPivotValues({ role }).sync(staffIds);
    await recordHiringEvent(
      "position.interviewers_synced",
      {
        position_id: Number(position.id),
        user_ids: staffIds,
        role,
        assigned_by: actor.id,
      },
      { type: "position", id: Number(position.id) },
    );
    return position.interviewers();
  }
}

export const interviewerService = new InterviewerService();
