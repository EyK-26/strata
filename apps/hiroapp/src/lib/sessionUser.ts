import type { HiroSessionUser } from "../bootstrap/providers/auth.ts";
import type { UserRecord } from "../modules/users/table.ts";

export function toSessionUser(user: UserRecord): HiroSessionUser {
  return {
    id: user.id,
    name: `${user.first_name} ${user.last_name}`,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    role_id: Number(user.role_id),
    is_admin: Number(user.role_id) === 1,
    email_verified_at: user.email_verified_at ?? null,
  };
}
