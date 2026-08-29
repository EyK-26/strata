import type { Seeder } from "./types";

const seeder: Seeder = {
  name: "0003_seed_notifications",
  async run(db) {
    await db`
      INSERT INTO notification (user_id, tenant_id, type, title, body, data, read_at, created_at)
      VALUES
        (
          1,
          1,
          'welcome',
          'Welcome to WorkHub',
          'Your admin inbox is live. Mark this read from the bell.',
          '{}'::jsonb,
          NULL,
          NOW()
        ),
        (
          2,
          1,
          'welcome',
          'Welcome to WorkHub',
          'You can follow tasks and comments from this inbox.',
          '{}'::jsonb,
          NULL,
          NOW()
        )
    `;
  },
};

export default seeder;
