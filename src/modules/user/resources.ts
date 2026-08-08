import type { UserRecord } from "./types";

interface UserResource {
  id: number;
  name: string;
  email: string;
  role: string;
}

function toUserResource(record: UserRecord): UserResource {
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    role: record.role,
  };
}

export { toUserResource };
export type { UserResource };
