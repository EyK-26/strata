import { hashPassword } from "../../core/auth/password";
import { hashApiToken } from "../../core/auth/tokenHash";
import { TEST_ADMIN_API_TOKEN, TEST_MEMBER_API_TOKEN } from "../../domain/auth";
import type { Seeder } from "./types";

const seeder: Seeder = {
  name: "0002_seed_users",
  async run(db) {
    const adminPasswordHash = await hashPassword("password");
    const memberPasswordHash = await hashPassword("password");

    await db`
      INSERT INTO users (id, name, email, email_lookup, role, tenant_id, password_hash)
      VALUES
        (1, 'Admin User', 'admin@workhub.test', 'admin@workhub.test', 'admin', 1, ${adminPasswordHash}),
        (2, 'Member User', 'member@workhub.test', 'member@workhub.test', 'member', 1, ${memberPasswordHash})
      ON CONFLICT (id) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        email_lookup = EXCLUDED.email_lookup,
        role = EXCLUDED.role,
        tenant_id = EXCLUDED.tenant_id
    `;
    await db`
      SELECT setval(
        pg_get_serial_sequence('users', 'id'),
        (SELECT COALESCE(MAX(id), 1) FROM users)
      )
    `;

    const adminToken = process.env.ADMIN_API_TOKEN ?? TEST_ADMIN_API_TOKEN;
    const memberToken = process.env.MEMBER_API_TOKEN ?? TEST_MEMBER_API_TOKEN;

    await db`
      INSERT INTO api_token (user_id, name, token_hash, abilities)
      VALUES
        (1, 'admin', ${hashApiToken(adminToken)}, '["*"]'::jsonb),
        (2, 'member', ${hashApiToken(memberToken)}, '["organizations:read","organizations:create","projects:read","projects:create","tasks:read","tasks:create","comments:read","comments:create"]'::jsonb)
      ON CONFLICT (token_hash) DO NOTHING
    `;

    await db`
      INSERT INTO organization_member (organization_id, user_id, role)
      VALUES
        (1, 1, 'owner'),
        (1, 2, 'admin')
      ON CONFLICT (organization_id, user_id) DO UPDATE SET
        role = EXCLUDED.role
    `;
  },
};

export default seeder;
