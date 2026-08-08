import type { AuthUser } from "../../core/auth/authContext";
import { Policy } from "../../core/auth/policy";
import type { TaskRecord } from "./types";

class TaskPolicy extends Policy {
  override create(_user: AuthUser | null): boolean {
    return true;
  }

  override update(_user: AuthUser | null, _task: TaskRecord): boolean {
    return true;
  }

  override delete(user: AuthUser | null, _task: TaskRecord): boolean {
    return user?.role === "admin" || user?.role === "member";
  }
}

export default TaskPolicy;
