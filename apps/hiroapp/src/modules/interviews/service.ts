import { ForbiddenError, NotFoundError, ValidationError } from "@getstrata/core/errors/http";
import { temporarySignedUrl } from "@getstrata/core/http/signedUrl";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { recordHiringEvent } from "../../lib/hiringEvents.ts";
import { isCandidate, isStaff } from "../../lib/roles.ts";
import { iso } from "../../lib/serialize.ts";
import { Application } from "../../models/Application.ts";
import type { Interview } from "../../models/Interview.ts";
import { applications } from "../applications/repository.ts";
import { resolveStaffPositionIds } from "../applications/service.ts";
import { interviewNotification, notifyUser } from "../notifications/service.ts";
import { users } from "../users/repository.ts";
import type { UserRecord } from "../users/table.ts";
import { interviews } from "./repository.ts";
import type { InterviewRecord, InterviewStatus } from "./table.ts";

export type ScheduleInterviewInput = {
  application_id: number;
  scheduled_at: string;
  place?: string | null;
  notes?: string | null;
  text?: string;
};

function asStatus(value: unknown): InterviewStatus {
  if (
    value === "scheduled" ||
    value === "confirmed" ||
    value === "completed" ||
    value === "cancelled"
  ) {
    return value;
  }
  return "scheduled";
}

export function serializeInterview(row: Interview | InterviewRecord) {
  const record =
    typeof (row as Interview).toObject === "function"
      ? (row as Interview).toObject()
      : (row as InterviewRecord);
  return {
    id: Number(record.id),
    application_id: Number(record.application_id),
    created_by: Number(record.created_by),
    scheduled_at: iso(record.scheduled_at),
    place: record.place,
    notes: record.notes,
    status: asStatus(record.status),
  };
}

function parseScheduleDate(value: string) {
  const scheduledAt = new Date(value);
  if (Number.isNaN(scheduledAt.getTime())) {
    throw new ValidationError("The given data was invalid.", {
      scheduled_at: ["The interview time is invalid."],
    });
  }
  return scheduledAt;
}

async function requireApplication(applicationId: number) {
  const application = await Application.find(applicationId);
  if (!application) {
    throw new NotFoundError("Application not found.");
  }
  return application;
}

async function assertCanViewApplication(actor: UserRecord, application: Application) {
  if (isStaff(actor.role_id)) {
    return;
  }
  if (Number(application.get("user_id")) !== Number(actor.id)) {
    throw new ForbiddenError("You cannot view this interview.");
  }
}

export class InterviewService {
  async listForActor(user: UserRecord) {
    if (isCandidate(user.role_id)) {
      const own = await applications.forUser(user.id);
      return interviews.forApplications(own.map((row) => Number(row.id)));
    }
    const positionIds = await resolveStaffPositionIds(user);
    if (positionIds && positionIds.length === 0) {
      return [];
    }
    const rows = positionIds
      ? await applications.forPositions(positionIds)
      : await applications.findAll();
    return interviews.forApplications(rows.map((row) => Number(row.id)));
  }

  async listForApplication(actor: UserRecord, applicationId: number) {
    const application = await requireApplication(applicationId);
    await assertCanViewApplication(actor, application);
    return interviews.forApplication(applicationId);
  }

  async schedule(actor: UserRecord, input: ScheduleInterviewInput) {
    if (!isStaff(actor.role_id)) {
      throw new ForbiddenError("Only staff can schedule interviews.");
    }
    const application = await requireApplication(input.application_id);
    const scheduledAt = parseScheduleDate(input.scheduled_at);
    const place = input.place?.trim() || null;
    const notes = input.notes?.trim() || null;
    const created = await interviews.create({
      application_id: Number(application.id),
      created_by: actor.id,
      tenant_id: currentTenantId(),
      scheduled_at: scheduledAt,
      place,
      notes,
      status: "scheduled",
    });
    await recordHiringEvent(
      "interview.scheduled",
      {
        interview_id: created.id,
        application_id: Number(application.id),
        user_id: Number(application.get("user_id")),
        scheduled_at: iso(scheduledAt),
        place,
      },
      { type: "interview", id: created.id },
    );
    const applicant = await users.findByIdOrThrow(Number(application.get("user_id")));
    const confirmPath = temporarySignedUrl(`/api/interviews/${created.id}/confirm`, 60 * 60 * 24);
    const message = interviewNotification({
      text: `${input.text ?? ""}\nConfirm: ${confirmPath}`.trim(),
      datetime: input.scheduled_at,
      place: place ?? "",
      sender: {
        first_name: actor.first_name,
        last_name: actor.last_name,
        email: actor.email,
      },
      to: applicant.email,
    });
    await notifyUser({ userId: applicant.id, ...message });
    return { interview: created, confirm_url: confirmPath };
  }

  async confirm(actor: UserRecord, interview: Interview) {
    const application = await requireApplication(Number(interview.get("application_id")));
    if (Number(application.get("user_id")) !== Number(actor.id)) {
      throw new ForbiddenError("Signed interview confirm is for another user.");
    }
    if (asStatus(interview.get("status")) !== "scheduled") {
      throw new ForbiddenError("Interview cannot be confirmed.");
    }
    const updated = await interviews.updateByIdOrThrow(Number(interview.id), {
      status: "confirmed",
    });
    await recordHiringEvent(
      "interview.confirmed",
      { interview_id: updated.id, application_id: updated.application_id },
      { type: "interview", id: updated.id },
    );
    return updated;
  }

  async complete(actor: UserRecord, interview: Interview, notes?: string | null) {
    if (!isStaff(actor.role_id)) {
      throw new ForbiddenError("Only staff can complete interviews.");
    }
    const status = asStatus(interview.get("status"));
    if (status !== "scheduled" && status !== "confirmed") {
      throw new ForbiddenError("Interview cannot be completed.");
    }
    const updated = await interviews.updateByIdOrThrow(Number(interview.id), {
      status: "completed",
      notes: notes?.trim() || interview.get("notes") || null,
    });
    await recordHiringEvent(
      "interview.completed",
      { interview_id: updated.id, application_id: updated.application_id },
      { type: "interview", id: updated.id },
    );
    return updated;
  }

  async cancel(actor: UserRecord, interview: Interview) {
    if (!isStaff(actor.role_id)) {
      throw new ForbiddenError("Only staff can cancel interviews.");
    }
    const status = asStatus(interview.get("status"));
    if (status !== "scheduled" && status !== "confirmed") {
      throw new ForbiddenError("Interview cannot be cancelled.");
    }
    const updated = await interviews.updateByIdOrThrow(Number(interview.id), {
      status: "cancelled",
    });
    await recordHiringEvent(
      "interview.cancelled",
      { interview_id: updated.id, application_id: updated.application_id },
      { type: "interview", id: updated.id },
    );
    return updated;
  }
}

export const interviewService = new InterviewService();
