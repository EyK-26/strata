import { Application } from "../models/Application.ts";
import type { Notification } from "../models/Notification.ts";
import { Position } from "../models/Position.ts";
import { User } from "../models/User.ts";
import { statuses } from "../modules/catalog/repository.ts";
import type { UserRecord } from "../modules/users/repository.ts";
import {
  serializeApplication,
  serializeNamed,
  serializeNotification,
  serializePosition,
  serializeUser,
} from "./serialize.ts";

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
      ? serializePosition(position.toObject(), {
          department: department ? serializeNamed(department) : null,
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
    position: serializePosition(position.toObject(), {
      grade: grade ? serializeNamed(grade) : null,
      user: occupant
        ? {
            id: occupant.id,
            first_name: occupant.get("first_name"),
            last_name: occupant.get("last_name"),
          }
        : null,
      department: department ? serializeNamed(department) : null,
    }),
    comments: comments.map((row) => row.toArray()),
    applications: apps.map((application) => {
      const applicant = application.loaded<User>("user");
      const status = application.loaded<{
        name: string;
        id: number;
        created_at: Date | null;
        updated_at: Date | null;
      }>("status");
      return serializeApplication(application.toObject(), {
        user: applicant
          ? {
              id: applicant.id,
              first_name: applicant.get("first_name"),
              last_name: applicant.get("last_name"),
            }
          : null,
        status: status ? serializeNamed(status) : null,
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
  return serializePosition(position.toObject(), {
    department: department ? serializeNamed(department) : null,
    grade: grade ? serializeNamed(grade) : null,
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
  return {
    application: serializeApplication(application.toObject(), {
      user: user ? serializeUser(user.toObject()) : null,
      position: position
        ? { name: position.get("name"), department: department ? { name: department.name } : null }
        : null,
      status: status ? serializeNamed(status) : null,
    }),
    comments: comments.map((row) => row.toArray()),
    all_statuses: (await statuses.all()).map(serializeNamed),
  };
}

export async function loadUserDetail(userId: number) {
  const user = await User.findOrFail(userId);
  await user.load("position.department");
  const inbox = await inboxFor(user);
  const position = user.loaded<Position>("position");
  const department = position?.loaded<{ name: string }>("department");
  return {
    user: serializeUser(user.toObject()),
    notifications: inbox.map(serializeNotification),
    position_name: position?.get("name") ?? null,
    department_name: department?.name ?? null,
  };
}
