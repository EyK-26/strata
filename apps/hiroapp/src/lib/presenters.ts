import { ROLE } from "./roles.ts";

export function homePathForRole(roleId: number) {
  if (roleId === ROLE.ADMIN) return "/";
  if (roleId === ROLE.RECRUITER) return "/";
  return "/";
}

export function displayName(user: { first_name: string; last_name: string }) {
  return `${user.first_name} ${user.last_name}`;
}
