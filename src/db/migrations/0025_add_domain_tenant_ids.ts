import type { Migration } from "./types";

const migration: Migration = {
  name: "0025_add_domain_tenant_ids",
  async up(db) {
    await db`ALTER TABLE project ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenant(id)`;
    await db`
      UPDATE project
      SET tenant_id = organization.tenant_id
      FROM organization
      WHERE project.organization_id = organization.id
        AND project.tenant_id IS NULL
    `;
    await db`UPDATE project SET tenant_id = 1 WHERE tenant_id IS NULL`;
    await db`ALTER TABLE project ALTER COLUMN tenant_id SET NOT NULL`;
    await db`CREATE INDEX IF NOT EXISTS idx_project_tenant_id ON project(tenant_id)`;

    await db`ALTER TABLE task ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenant(id)`;
    await db`
      UPDATE task
      SET tenant_id = project.tenant_id
      FROM project
      WHERE task.project_id = project.id
        AND task.tenant_id IS NULL
    `;
    await db`UPDATE task SET tenant_id = 1 WHERE tenant_id IS NULL`;
    await db`ALTER TABLE task ALTER COLUMN tenant_id SET NOT NULL`;
    await db`CREATE INDEX IF NOT EXISTS idx_task_tenant_id ON task(tenant_id)`;

    await db`ALTER TABLE comment ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenant(id)`;
    await db`
      UPDATE comment
      SET tenant_id = task.tenant_id
      FROM task
      WHERE comment.task_id = task.id
        AND comment.tenant_id IS NULL
    `;
    await db`UPDATE comment SET tenant_id = 1 WHERE tenant_id IS NULL`;
    await db`ALTER TABLE comment ALTER COLUMN tenant_id SET NOT NULL`;
    await db`CREATE INDEX IF NOT EXISTS idx_comment_tenant_id ON comment(tenant_id)`;

    await db`ALTER TABLE webhook ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenant(id)`;
    await db`
      UPDATE webhook
      SET tenant_id = organization.tenant_id
      FROM organization
      WHERE webhook.organization_id = organization.id
        AND webhook.tenant_id IS NULL
    `;
    await db`UPDATE webhook SET tenant_id = 1 WHERE tenant_id IS NULL`;
    await db`ALTER TABLE webhook ALTER COLUMN tenant_id SET NOT NULL`;
    await db`CREATE INDEX IF NOT EXISTS idx_webhook_tenant_id ON webhook(tenant_id)`;
  },
  async down(db) {
    await db`ALTER TABLE webhook DROP COLUMN IF EXISTS tenant_id`;
    await db`ALTER TABLE comment DROP COLUMN IF EXISTS tenant_id`;
    await db`ALTER TABLE task DROP COLUMN IF EXISTS tenant_id`;
    await db`ALTER TABLE project DROP COLUMN IF EXISTS tenant_id`;
  },
};

export default migration;
