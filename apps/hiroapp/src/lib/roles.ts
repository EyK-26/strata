export const ROLE = {
  ADMIN: 1,
  CANDIDATE: 2,
  RECRUITER: 3,
} as const;

export const STATUS = {
  APPLIED: 1,
  IN_PROGRESS: 2,
  INTERVIEW: 3,
  FEEDBACK: 4,
  HIRED: 5,
  ENDED: 6,
} as const;

export const GRADE = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
} as const;

export type RoleId = (typeof ROLE)[keyof typeof ROLE];

function asRoleId(roleId: number | string) {
  return Number(roleId);
}

export function roleName(roleId: number | string) {
  if (asRoleId(roleId) === ROLE.ADMIN) return "admin";
  if (asRoleId(roleId) === ROLE.RECRUITER) return "recruiter";
  return "candidate";
}

export function isAdmin(roleId: number | string) {
  return asRoleId(roleId) === ROLE.ADMIN;
}

export function isCandidate(roleId: number | string) {
  return asRoleId(roleId) === ROLE.CANDIDATE;
}

export function isRecruiter(roleId: number | string) {
  return asRoleId(roleId) === ROLE.RECRUITER;
}

export function isStaff(roleId: number | string) {
  return asRoleId(roleId) === ROLE.ADMIN || asRoleId(roleId) === ROLE.RECRUITER;
}
