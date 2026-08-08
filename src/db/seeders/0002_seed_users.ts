import type { Seeder } from "./types";
import { hashApiToken } from "../../core/auth/tokenHash";
import {
  TEST_ADMIN_API_TOKEN,
  TEST_MEMBER_API_TOKEN,
} from "../../domain/auth";

const seeder: Seeder = {
  name: "0002_seed_users",
  async run(db) {
    await db`
      INSERT INTO users (id, name, email, role)
      VALUES
        (1, 'Admin User', 'admin@workhub.test', 'admin'),
        (2, 'Member User', 'member@workhub.test', 'member')
      ON CONFLICT (id) DO NOTHING
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
        (2, 'member', ${hashApiToken(memberToken)}, '["*"]'::jsonb)
      ON CONFLICT (token_hash) DO NOTHING
    `;
  },
};

export default seeder;
