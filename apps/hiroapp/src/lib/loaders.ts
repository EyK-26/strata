import {
  ApplicationResource,
  mergeResource,
  NamedResource,
  NotificationResource,
  PositionResource,
  UserResource,
} from "../http/resources.ts";
import { Application } from "../models/Application.ts";
import type { Notification } from "../models/Notification.ts";
import { Position } from "../models/Position.ts";
import { User } from "../models/User.ts";
import { statuses } from "../modules/catalog/repository.ts";
import { interviews } from "../modules/interviews/repository.ts";
import { serializeInterview } from "../modules/interviews/service.ts";
import { offers } from "../modules/offers/repository.ts";
import { serializeOffer } from "../modules/offers/service.ts";
import { referrals } from "../modules/referrals/repository.ts";
import { serializeReferral } from "../modules/referrals/service.ts";
import { applicationRejections, rejectionReasons } from "../modules/rejections/repository.ts";
import { serializeReason, serializeRejection } from "../modules/rejections/service.ts";
import type { UserRecord } from "../modules/users/repository.ts";

async function inboxFor(user: User | UserRecord) {
  const model = user instanceof User ? user : User.newFromRecord(user);
  const rows = (await model.notifications()) as Notification[];
  return rows.map((row) => row.toObject());
}

export async function loadUserGraph(user: UserRecord) {
  const model = User.newFromRecord(user);
  await model.load("position.department");
  const inbox = await inboxFor(model);
  const position = model.loaded<Position>("position") ?? null;
  const department = position?.loaded<{
    name: string;
    id: number;
    created_at: Date | null;
    updated_at: Date | null;
  }>("department");
  return {
    notifications: inbox,
    position: position
      ? mergeResource(new PositionResource(position), {
          department: department ? new NamedResource(department).toArray() : null,
        })
      : null,
  };
}

export async function loadPositionWithApplications(positionId: number) {
  const position = await Position.with("grade", "user", "department", "applications").findOrFail(
    positionId,
  );
  const apps = position.loaded<Application[]>("applications") ?? [];
  await Promise.all(apps.map((application) => application.load("user", "status")));
  const grade = position.loaded<{
    name: string;
    id: number;
    created_at: Date | null;
    updated_at: Date | null;
  }>("grade");
  const occupant = position.loaded<User>("user");
  const department = position.loaded<{
    name: string;
    id: number;
    created_at: Date | null;
    updated_at: Date | null;
  }>("department");

  const comments = await position.comments();
  return {
    position: mergeResource(new PositionResource(position), {
      grade: grade ? new NamedResource(grade).toArray() : null,
      user: occupant
        ? {
            id: occupant.id,
            first_name: occupant.get("first_name"),
            last_name: occupant.get("last_name"),
          }
        : null,
      department: department ? new NamedResource(department).toArray() : null,
    }),
    comments: comments.map((row) => row.toArray()),
    referrals: (await referrals.forPosition(positionId)).map(serializeReferral),
    applications: apps.map((application) => {
      const applicant = application.loaded<User>("user");
      const status = application.loaded<{
        name: string;
        id: number;
        created_at: Date | null;
        updated_at: Date | null;
      }>("status");
      return mergeResource(new ApplicationResource(application), {
        user: applicant
          ? {
              id: applicant.id,
              first_name: applicant.get("first_name"),
              last_name: applicant.get("last_name"),
            }
          : null,
        status: status ? new NamedResource(status).toArray() : null,
      });
    }),
  };
}

export async function loadCandidatePosition(positionId: number) {
  const position = await Position.with("department", "grade").find(positionId);
  if (!position) return null;
  const department = position.loaded<{
    name: string;
    id: number;
    created_at: Date | null;
    updated_at: Date | null;
  }>("department");
  const grade = position.loaded<{
    name: string;
    id: number;
    created_at: Date | null;
    updated_at: Date | null;
  }>("grade");
  return mergeResource(new PositionResource(position), {
    department: department ? new NamedResource(department).toArray() : null,
    grade: grade ? new NamedResource(grade).toArray() : null,
  });
}

export async function loadApplicationDetail(applicationId: number) {
  const application = await Application.with("user", "position", "status").findOrFail(
    applicationId,
  );
  const user = application.loaded<User>("user");
  const position = application.loaded<Position>("position");
  if (position) {
    await position.load("department");
  }
  const department = position?.loaded<{ name: string }>("department");
  const status = application.loaded<{
    name: string;
    id: number;
    created_at: Date | null;
    updated_at: Date | null;
  }>("status");

  const comments = await application.comments();
  const interviewRows = await interviews.forApplication(applicationId);
  const reasonRows = await rejectionReasons.ordered();
  const reasonName = new Map(reasonRows.map((row) => [Number(row.id), row.name]));
  const rejectionRows = await applicationRejections.forApplication(applicationId);
  return {
    application: mergeResource(new ApplicationResource(application), {
      user: user ? new UserResource(user).toArray() : null,
      position: position
        ? { name: position.get("name"), department: department ? { name: department.name } : null }
        : null,
      status: status ? new NamedResource(status).toArray() : null,
    }),
    comments: comments.map((row) => row.toArray()),
    interviews: interviewRows.map(serializeInterview),
    offers: (await offers.forApplication(applicationId)).map(serializeOffer),
    rejections: rejectionRows.map((row) => ({
      ...serializeRejection(row),
      reason_name: reasonName.get(Number(row.reason_id)) ?? null,
    })),
    rejection_reasons: reasonRows.map(serializeReason),
    all_statuses: (await statuses.all()).map((row) => new NamedResource(row).toArray()),
  };
}

export async function loadUserDetail(userId: number) {
  const user = await User.findOrFail(userId);
  await user.load("position.department");
  const inbox = await inboxFor(user);
  const position = user.loaded<Position>("position");
  const department = position?.loaded<{ name: string }>("department");
  return {
    user: new UserResource(user).toArray(),
    notifications: inbox.map((row) => new NotificationResource(row).toArray()),
    position_name: position?.get("name") ?? null,
    department_name: department?.name ?? null,
  };
}
