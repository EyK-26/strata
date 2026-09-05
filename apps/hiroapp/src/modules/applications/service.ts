import { runInTransaction } from "@getstrata/core/database/transaction";
import {
  ConflictError,
  ForbiddenError,
  UnprocessableEntityError,
} from "@getstrata/core/errors/http";
import { recordHiringEvent } from "../../lib/hiringEvents.ts";
import { isCandidate, isRecruiter, isStaff, STATUS } from "../../lib/roles.ts";
import { hiringFlag } from "../../lib/serialize.ts";
import { requireStaffDepartmentAccess, resolveStaffDepartmentId } from "../../lib/staffTeam.ts";
import { Application } from "../../models/Application.ts";
import { User } from "../../models/User.ts";
import { departmentService } from "../departments/service.ts";
import { endedNotification, hiredNotification, notifyUser } from "../notifications/service.ts";
import { positions } from "../positions/repository.ts";
import { referralService } from "../referrals/service.ts";
import { sourceService } from "../sources/service.ts";
import { users } from "../users/repository.ts";
import type { UserRecord } from "../users/table.ts";
import { applications } from "./repository.ts";

export type PipelineFilters = {
  search?: string;
  status_id?: number;
  department_id?: number;
};

export type PipelineCounts = {
  applied: number;
  in_progress: number;
  interview: number;
  feedback: number;
  hired: number;
  ended: number;
  total: number;
};

export type ApplyPayload = {
  position_id: number;
  attachment_text: string | null;
  attachment_file: string | null;
  source_id?: number | null;
};

export type TransferPayload = {
  position_id: number;
};

function emptyCounts(): PipelineCounts {
  return {
    applied: 0,
    in_progress: 0,
    interview: 0,
    feedback: 0,
    hired: 0,
    ended: 0,
    total: 0,
  };
}

function bumpStatus(counts: PipelineCounts, statusId: number) {
  if (statusId === STATUS.APPLIED) counts.applied += 1;
  else if (statusId === STATUS.IN_PROGRESS) counts.in_progress += 1;
  else if (statusId === STATUS.INTERVIEW) counts.interview += 1;
  else if (statusId === STATUS.FEEDBACK) counts.feedback += 1;
  else if (statusId === STATUS.HIRED) counts.hired += 1;
  else if (statusId === STATUS.ENDED) counts.ended += 1;
  counts.total += 1;
}

export async function resolveStaffPositionIds(
  user: UserRecord,
  departmentId?: number,
): Promise<number[] | null> {
  if (isRecruiter(user.role_id)) {
    const teamId = await resolveStaffDepartmentId(user);
    if (!teamId) {
      throw new ForbiddenError("Recruiter has no hiring team.");
    }
    return positions.idsInDepartment(teamId);
  }
  if (departmentId) {
    return positions.idsInDepartment(departmentId);
  }
  return null;
}

async function queryApplications(user: UserRecord, filters: PipelineFilters) {
  const search = filters.search?.trim() ?? "";
  const statusId =
    filters.status_id && Number.isInteger(filters.status_id) && filters.status_id > 0
      ? filters.status_id
      : undefined;

  // ModelQuery is thenable (`await Application.where()` runs `.get()`). Never
  // return the builder from this async function; wrap it so callers can page.
  if (isCandidate(user.role_id)) {
    let builder = Application.where({ user_id: user.id });
    if (statusId) {
      builder = builder.where({ status_id: statusId });
    }
    if (search) {
      builder = builder.whereHas("position", (related) => {
        related.where?.({ name: { ilike: `%${search}%` } });
      });
    }
    return { query: builder };
  }

  const positionIds = await resolveStaffPositionIds(user, filters.department_id);
  if (positionIds && positionIds.length === 0) {
    return { query: null };
  }

  let builder = positionIds
    ? Application.where({ position_id: { in: positionIds } })
    : Application.query();
  if (statusId) {
    builder = builder.where({ status_id: statusId });
  }
  if (search) {
    builder = builder.whereHas("position", (related) => {
      related.where?.({ name: { ilike: `%${search}%` } });
    });
  }
  return { query: builder };
}

export class ApplicationService {
  async listForActor(
    user: UserRecord,
    filters: PipelineFilters,
    pagination: { page: number; perPage: number },
  ) {
    const { query } = await queryApplications(user, filters);
    if (!query) {
      return [];
    }
    const page = await query
      .limit(pagination.perPage)
      .offset((pagination.page - 1) * pagination.perPage)
      .get();
    await Promise.all(page.map((application) => application.load("position", "status", "user")));
    return page;
  }

  async summaryForActor(user: UserRecord, departmentId?: number): Promise<PipelineCounts> {
    const counts = emptyCounts();
    const { query } = await queryApplications(user, { department_id: departmentId });
    if (!query) {
      return counts;
    }
    const rows = await query.get();
    for (const row of rows) {
      bumpStatus(counts, Number(row.get("status_id")));
    }
    return counts;
  }

  async apply(user: UserRecord, payload: ApplyPayload) {
    if (!isCandidate(user.role_id)) {
      throw new ForbiddenError("Only candidates can apply.");
    }
    const position = await positions.findById(payload.position_id);
    if (!position || hiringFlag(position.hiring) !== 1) {
      throw new UnprocessableEntityError("Position is not open for applications.");
    }
    await departmentService.assertHiringOpen(Number(position.department_id));
    if (payload.source_id != null) {
      await sourceService.assertKnown(Number(payload.source_id));
    }
    const existing = await Application.withTrashed()
      .where({ user_id: user.id, position_id: payload.position_id })
      .first();
    if (existing && !existing.get("deleted_at")) {
      throw new ConflictError("You have already applied to this position.");
    }
    let application: Application;
    if (existing) {
      await existing.restore();
      await existing.update({
        status_id: STATUS.APPLIED,
        attachment_text: payload.attachment_text,
        attachment_file: payload.attachment_file,
      });
      application = existing;
    } else {
      application = await User.newFromRecord(user).applications().create({
        position_id: payload.position_id,
        status_id: STATUS.APPLIED,
        attachment_text: payload.attachment_text,
        attachment_file: payload.attachment_file,
      });
    }
    await referralService.markApplied(user.email, payload.position_id);
    if (payload.source_id != null) {
      await sourceService.record(user, application, { source_id: Number(payload.source_id) });
    }
    return application;
  }

  async move(actor: UserRecord, application: Application) {
    const id = Number(application.id);
    const statusId = Number(application.get("status_id"));
    if (statusId < STATUS.FEEDBACK) {
      await applications.updateById(id, { status_id: statusId + 1 });
      await recordHiringEvent(
        "application.stage_changed",
        {
          application_id: id,
          user_id: Number(application.get("user_id")),
          position_id: Number(application.get("position_id")),
          from_status_id: statusId,
          to_status_id: statusId + 1,
        },
        { type: "application", id },
      );
      return Application.findOrFail(id);
    }
    if (statusId !== STATUS.FEEDBACK) {
      throw new ForbiddenError("Application cannot be moved further.");
    }
    if (!application.get("position_id")) {
      throw new UnprocessableEntityError("Application has no position.");
    }

    await runInTransaction(async () => {
      await applications.updateById(id, { status_id: STATUS.HIRED });
      await recordHiringEvent(
        "application.hired",
        {
          application_id: id,
          user_id: Number(application.get("user_id")),
          position_id: Number(application.get("position_id")),
        },
        { type: "application", id },
      );
      const position = await application.position().first();
      if (!position) {
        throw new UnprocessableEntityError("Application has no position.");
      }
      const userId = Number(application.get("user_id"));
      const oldSeat = await positions.findByUserId(userId);
      if (oldSeat) {
        await positions.updateById(oldSeat.id, { user_id: null });
      }
      await position.update({ user_id: userId, hiring: false });

      const siblings = await position.applications();
      const rejectedIds: number[] = [];
      for (const sibling of siblings) {
        const siblingId = Number(sibling.id);
        if (siblingId !== id && Number(sibling.get("status_id")) !== STATUS.ENDED) {
          await applications.updateById(siblingId, { status_id: STATUS.ENDED });
          rejectedIds.push(Number(sibling.get("user_id")));
        }
      }

      const hired = await users.findByIdOrThrow(userId);
      const positionName = String(position.get("name"));
      await notifyUser({
        userId: hired.id,
        ...hiredNotification({
          firstName: hired.first_name,
          positionName,
          recruiter: actor,
          to: hired.email,
        }),
      });
      for (const rejectedId of rejectedIds) {
        const rejected = await users.findById(rejectedId);
        if (!rejected) continue;
        await notifyUser({
          userId: rejected.id,
          ...endedNotification({
            firstName: rejected.first_name,
            positionName,
            recruiter: actor,
            to: rejected.email,
          }),
        });
      }
    });
    return Application.findOrFail(id);
  }

  async transfer(actor: UserRecord, application: Application, payload: TransferPayload) {
    if (!isStaff(actor.role_id)) {
      throw new ForbiddenError("Only staff can transfer applications.");
    }
    const statusId = Number(application.get("status_id"));
    if (statusId === STATUS.HIRED || statusId === STATUS.ENDED) {
      throw new UnprocessableEntityError("A hired or ended application cannot be transferred.");
    }
    const targetId = Number(payload.position_id);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      throw new UnprocessableEntityError("Position is not open for applications.");
    }
    const fromPositionId = Number(application.get("position_id"));
    if (fromPositionId === targetId) {
      throw new UnprocessableEntityError("Application is already on this hiring seat.");
    }
    const target = await positions.findById(targetId);
    if (!target || hiringFlag(target.hiring) !== 1) {
      throw new UnprocessableEntityError("Position is not open for applications.");
    }
    await departmentService.assertHiringOpen(Number(target.department_id));
    await requireStaffDepartmentAccess(actor, Number(target.department_id));
    const userId = Number(application.get("user_id"));
    const existing = await Application.withTrashed()
      .where({ user_id: userId, position_id: targetId })
      .first();
    if (existing) {
      throw new ConflictError("This candidate already has an application for that position.");
    }
    const id = Number(application.id);
    await applications.updateById(id, { position_id: targetId });
    await recordHiringEvent(
      "application.transferred",
      {
        application_id: id,
        user_id: userId,
        from_position_id: Number.isInteger(fromPositionId) ? fromPositionId : null,
        to_position_id: targetId,
      },
      { type: "application", id },
    );
    return Application.findOrFail(id);
  }

  async end(actor: UserRecord, application: Application) {
    const id = Number(application.id);
    if (Number(application.get("status_id")) === STATUS.ENDED) {
      throw new ForbiddenError("Application is already ended.");
    }
    await applications.updateById(id, { status_id: STATUS.ENDED });
    await recordHiringEvent(
      "application.ended",
      {
        application_id: id,
        user_id: Number(application.get("user_id")),
        position_id: Number(application.get("position_id")),
      },
      { type: "application", id },
    );
    if (!isCandidate(actor.role_id)) {
      const applicant = await users.findByIdOrThrow(Number(application.get("user_id")));
      const relatedPosition = await application.position().first();
      const message = endedNotification({
        firstName: applicant.first_name,
        positionName: relatedPosition?.get("name") ?? "this position",
        recruiter: actor,
        to: applicant.email,
      });
      await notifyUser({ userId: applicant.id, ...message });
    }
    return Application.findOrFail(id);
  }
}

export const applicationService = new ApplicationService();
