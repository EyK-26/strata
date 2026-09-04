import { Application } from "./Application.ts";
import { Comment } from "./Comment.ts";
import { Department } from "./Department.ts";
import { Grade } from "./Grade.ts";
import { Notification } from "./Notification.ts";
import { Position } from "./Position.ts";
import { Role } from "./Role.ts";
import { Skill } from "./Skill.ts";
import { Status } from "./Status.ts";
import { User } from "./User.ts";

let registered = false;

export function registerHiroModels() {
  if (registered) {
    return;
  }
  registered = true;
}

export {
  Application,
  Comment,
  Department,
  Grade,
  Notification,
  Position,
  Role,
  Skill,
  Status,
  User,
};
