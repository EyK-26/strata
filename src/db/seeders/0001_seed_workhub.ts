import type { Seeder } from "./types";

const seeder: Seeder = {
  name: "0001_seed_workhub",
  async run(db) {
    await db`
      INSERT INTO organization (id, name, slug, tenant_id)
      VALUES
        (1, 'Acme Labs', 'acme-labs', 1),
        (2, 'Orbital Works', 'orbital-works', 1)
      ON CONFLICT (id) DO NOTHING
    `;
    await db`
      SELECT setval(
        pg_get_serial_sequence('organization', 'id'),
        (SELECT COALESCE(MAX(id), 1) FROM organization)
      )
    `;

    await db`
      INSERT INTO project (id, organization_id, tenant_id, name, status)
      VALUES
        (1, 1, 1, 'Platform Rewrite', 'active'),
        (2, 1, 1, 'Legacy Migration', 'draft'),
        (3, 2, 1, 'Docking Simulator', 'active')
      ON CONFLICT (id) DO NOTHING
    `;
    await db`
      SELECT setval(
        pg_get_serial_sequence('project', 'id'),
        (SELECT COALESCE(MAX(id), 1) FROM project)
      )
    `;

    await db`
      INSERT INTO task (id, project_id, tenant_id, title, status, priority)
      VALUES
        (1, 1, 1, 'Design module registry', 'done', 3),
        (2, 1, 1, 'Implement query layer', 'in_progress', 4),
        (3, 2, 1, 'Map legacy endpoints', 'todo', 2),
        (4, 3, 1, 'Simulate docking sequence', 'in_progress', 5)
      ON CONFLICT (id) DO NOTHING
    `;
    await db`
      SELECT setval(
        pg_get_serial_sequence('task', 'id'),
        (SELECT COALESCE(MAX(id), 1) FROM task)
      )
    `;

    await db`
      INSERT INTO comment (id, task_id, tenant_id, body)
      VALUES
        (1, 1, 1, 'Registry supports provider boot phases.'),
        (2, 1, 1, 'Auto-registration added to make:module.'),
        (3, 2, 1, 'BaseRepository covers CRUD and eager loads.'),
        (4, 4, 1, 'Needs collision detection at 30m.')
      ON CONFLICT (id) DO NOTHING
    `;
    await db`
      SELECT setval(
        pg_get_serial_sequence('comment', 'id'),
        (SELECT COALESCE(MAX(id), 1) FROM comment)
      )
    `;
  },
};

export default seeder;
