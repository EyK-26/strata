import type { AuthUser } from "../../core/auth/authContext";
import { Policy } from "../../core/auth/policy";
import type { ProjectRecord } from "./types";

class ProjectPolicy extends Policy {
  override create(_user: AuthUser | null): boolean {
    return true;
  }

  override update(_user: AuthUser | null, _project: ProjectRecord): boolean {
    return true;
  }

  override delete(user: AuthUser | null, _project: ProjectRecord): boolean {
    return user?.role === "admin" || user?.role === "member";
  }
}

export default ProjectPolicy;
