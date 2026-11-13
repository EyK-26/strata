import { dialectFragments } from "./renderMigrations.ts";
import { type DatabaseLayer, htmlAuthKit, type StarterLayers, usesTenantTable } from "./types.ts";

function activeBoolColumn(database: DatabaseLayer): string {
  if (database === "postgres") {
    return "BOOLEAN NOT NULL DEFAULT TRUE";
  }
  if (database === "mysql") {
    return "TINYINT(1) NOT NULL DEFAULT 1";
  }
  return "INTEGER NOT NULL DEFAULT 1";
}

function webhookMigrationName(layers: StarterLayers): string | null {
  if (!layers.extras.webhooks) {
    return null;
  }
  return "0002_webhooks_schema";
}

function billingMigrationName(layers: StarterLayers): string | null {
  if (!layers.extras.billing) {
    return null;
  }
  return layers.extras.webhooks ? "0003_billing_schema" : "0002_billing_schema";
}

function renderFileMigration(
  name: string,
  upSql: string[],
  downSql: string[],
  columnCleanup?: { database: StarterLayers["database"]; table: string; column: string },
): string {
  const upCalls = upSql.map((sql) => `    await db.unsafe(${JSON.stringify(sql)});`).join("\n");
  const downCalls = downSql.map((sql) => `    await db.unsafe(${JSON.stringify(sql)});`).join("\n");
  const schemaImport = columnCleanup
    ? 'import { Schema } from "@getstrata/core/database/schema";\n'
    : "";
  const dropColumn = columnCleanup
    ? `\n    await Schema.run(db, "${columnCleanup.database === "postgres" ? "pgsql" : columnCleanup.database}", schema => {
      schema.table(${JSON.stringify(columnCleanup.table)}, table => {
        table.dropColumn(${JSON.stringify(columnCleanup.column)});
      });
    });`
    : "";
  return `${schemaImport}import type { Migration } from "@getstrata/core/database/migrations/types";

const migration: Migration = {
  name: ${JSON.stringify(name)},
  async up(db) {
${upCalls}
  },
  async down(db) {
${downCalls}${dropColumn}
  },
};

export default migration;
`;
}

function renderWebhooksMigration(layers: StarterLayers): string | null {
  const name = webhookMigrationName(layers);
  if (!name) {
    return null;
  }
  const d = dialectFragments(layers.database);
  const payloadType = layers.database === "postgres" ? "JSONB NOT NULL" : `${d.text} NOT NULL`;
  const cascade = layers.database === "sqlite" ? "" : " CASCADE";
  return renderFileMigration(
    name,
    [
      `CREATE TABLE IF NOT EXISTS webhooks (
    id ${d.id},
    url ${d.text} NOT NULL,
    secret ${d.text} NOT NULL,
    events ${d.defaultText} NOT NULL DEFAULT '*',
    active ${activeBoolColumn(layers.database)},
    created_at ${d.timestamp}
  )`,
      `CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id ${d.id},
    webhook_id INTEGER NOT NULL,
    event ${d.keyText} NOT NULL,
    payload ${payloadType},
    response_status INTEGER,
    attempt INTEGER NOT NULL DEFAULT 1,
    error ${d.text},
    created_at ${d.timestamp}
  )`,
    ],
    [
      `DROP TABLE IF EXISTS webhook_deliveries${cascade}`,
      `DROP TABLE IF EXISTS webhooks${cascade}`,
    ],
  );
}

function renderBillingMigration(layers: StarterLayers): string | null {
  const name = billingMigrationName(layers);
  if (!name) {
    return null;
  }
  const d = dialectFragments(layers.database);
  const tenancyOn = usesTenantTable(layers.tenancy);
  const cascade = layers.database === "sqlite" ? "" : " CASCADE";
  const up: string[] = [];
  if (tenancyOn) {
    up.push(`ALTER TABLE tenant ADD COLUMN stripe_customer_id ${d.keyText}`);
  }
  const tenantColumn = tenancyOn ? `\n    tenant_id INTEGER NOT NULL,` : "";
  up.push(`CREATE TABLE IF NOT EXISTS subscription (
    id ${d.id},${tenantColumn}
    stripe_subscription_id ${d.keyText} UNIQUE,
    plan ${d.defaultText} NOT NULL DEFAULT 'free',
    status ${d.defaultText} NOT NULL DEFAULT 'active',
    current_period_end ${d.timestampNull},
    created_at ${d.timestamp},
    updated_at ${d.timestamp}
  )`);
  const eventTenant = tenancyOn ? `\n    tenant_id INTEGER,` : "";
  up.push(`CREATE TABLE IF NOT EXISTS stripe_webhook_event (
    id ${d.keyText} PRIMARY KEY,
    event_type ${d.keyText} NOT NULL,${eventTenant}
    processed_at ${d.timestamp}
  )`);
  const down = [
    `DROP TABLE IF EXISTS stripe_webhook_event${cascade}`,
    `DROP TABLE IF EXISTS subscription${cascade}`,
  ];
  return renderFileMigration(
    name,
    up,
    down,
    tenancyOn
      ? { database: layers.database, table: "tenant", column: "stripe_customer_id" }
      : undefined,
  );
}

function sqlParams(database: DatabaseLayer, count: number): string {
  return Array.from({ length: count }, (_, index) =>
    database === "postgres" ? `$${index + 1}` : "?",
  ).join(", ");
}

function renderDispatchOutboundWebhookJob(layers: StarterLayers): string {
  const values = sqlParams(layers.database, 6);
  return `import { Job, type JobContext } from "@getstrata/core/queue";
import { safeFetch } from "@getstrata/core/security/safeFetch";
import { signWebhookBody } from "@getstrata/core/security/webhookSignature";

interface DispatchOutboundWebhookPayload {
  webhookId: number;
  event: string;
  url: string;
  secret: string;
  body: string;
  allowPrivate: boolean;
  signatureHeader: string;
}

class DispatchOutboundWebhookJob extends Job<DispatchOutboundWebhookPayload> {
  static override readonly jobName = "webhook.dispatch";

  override async handle(payload: DispatchOutboundWebhookPayload, context?: JobContext): Promise<void> {
    if (!context?.database) throw new Error("Webhook delivery requires an owned queue invocation.");
    const allowPrivate = payload.allowPrivate === true;
    let responseStatus: number | null = null;
    let error: string | null = null;
    let failure: Error | undefined;
    try {
      const response = await safeFetch(
        payload.url,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [payload.signatureHeader]: signWebhookBody(payload.secret, payload.body),
          },
          body: payload.body,
          signal: context.signal,
        },
        { timeoutMs: 10_000, maxRedirects: 0, allowPrivate, allowHttp: allowPrivate },
      );
      responseStatus = response.status;
      if (!response.ok) {
        error = \`HTTP \${response.status}\`;
        failure = new Error(error);
      }
      // Only the status is needed. Explicit cancellation releases safeFetch's
      // transport/body deadline even when the receiver sends an unread body.
      await response.body?.cancel();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : "webhook dispatch failed";
      failure = caught instanceof Error ? caught : new Error(error, { cause: caught });
    }

    try {
      await context.database.execute({
        text: "INSERT INTO webhook_deliveries (webhook_id, event, payload, response_status, attempt, error) VALUES (${values})",
        params: [payload.webhookId, payload.event, payload.body, responseStatus, context.attempt ?? 1, error],
      });
    } catch (recordingFailure) {
      if (failure) throw new AggregateError([failure, recordingFailure], \`Webhook delivery failed: \${failure.message}; recording also failed.\`, { cause: failure });
      throw recordingFailure;
    }
    // Every transport/non-2xx failure uses the selected queue's bounded retry
    // and terminal recovery policy. Delivery remains at-least-once.
    if (failure) throw failure;
  }
}

export default DispatchOutboundWebhookJob;
export type { DispatchOutboundWebhookPayload };
`;
}

function renderNoteCreatedWebhookListener(): string {
  return `import type { ListenerDeclarations } from "@getstrata/bootstrap/discoverListeners";
import { service } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { repositoryEffects, type AfterCommitRepositoryListener } from "@getstrata/core/database/definitions";
import { STARTER_QUEUE_TOKEN, STARTER_WEBHOOK_OPTIONS_TOKEN } from "../bootstrap/providers/index.ts";
import { NoteRepository, type NoteRecord } from "../models/Note.ts";
import DispatchOutboundWebhookJob from "../jobs/dispatchOutboundWebhookJob.ts";

const noteCreated = createServiceToken<AfterCommitRepositoryListener<NoteRecord>>("starter.webhooks.note-created");
const declarations: ListenerDeclarations = Object.freeze({
  services: Object.freeze([service(noteCreated, {
    lifetime: "application",
    dependencies: [STARTER_QUEUE_TOKEN, STARTER_WEBHOOK_OPTIONS_TOKEN],
    create: (queue, options) => async (payload, { database }) => {
      const rows = await database.execute<{
        id: number;
        url: string;
        secret: string;
        active: number | boolean;
        events: string;
      }>({text: "SELECT id, url, secret, active, events FROM webhooks", params: []});
      const event = "notes.created";
      const body = JSON.stringify({ event, data: payload });
      for (const hook of rows) {
        // Only the named event or explicit wildcard subscribes to this event.
        if (!hook.active || (hook.events !== "*" && hook.events !== event)) continue;
        await queue.dispatch(new DispatchOutboundWebhookJob(), {
          webhookId: hook.id,
          event,
          url: hook.url,
          secret: hook.secret,
          body,
          allowPrivate: options.allowPrivate,
          signatureHeader: options.signatureHeader,
        });
      }
    },
  })]),
  repositoryEffects: Object.freeze([repositoryEffects(NoteRepository, [
    {action: "created", afterCommit: noteCreated},
  ])]),
});

export default declarations;
`;
}

function renderApplyStripeWebhook(): string {
  return `import type { BusinessRequestPorts } from "@getstrata/bootstrap/persistenceContracts";

interface StripeWebhookEvent {
  id?: string;
  type?: string;
  data?: { object?: Record<string, unknown> };
}

/**
 * Called after the Stripe signature verifies. The default does nothing.
 * Plan and tenant updates belong here. Use the explicit ports to establish a
 * database policy from verified account data before writing tenant tables.
 */
async function applyStripeWebhook(_event: StripeWebhookEvent, _ports: BusinessRequestPorts): Promise<void> {
  return;
}

export type { StripeWebhookEvent };
export { applyStripeWebhook };
`;
}

function renderBillingModule(layers: StarterLayers): string {
  const tenancyOn = usesTenantTable(layers.tenancy);
  const tenantPlaceholder = layers.database === "postgres" ? "$1" : "?";
  const subscriptionQuery = tenancyOn
    ? `        const tenant = ports.established.tenant;
        if (!tenant) {
          return jsonResponse({ error: "Tenant context is required." }, { status: 500 });
        }
        const rows = await ports.database.execute<Record<string, unknown>>({
          text: "SELECT plan, status, stripe_subscription_id, current_period_end FROM subscription WHERE tenant_id = ${tenantPlaceholder} LIMIT 1",
          params: [tenant.id],
        });`
    : `        const rows = await ports.database.execute<Record<string, unknown>>({
          text: "SELECT plan, status, stripe_subscription_id, current_period_end FROM subscription LIMIT 1",
          params: [],
        });`;

  return `import type { AppModule } from "@getstrata/bootstrap/contracts";
import { jsonResponse } from "@getstrata/core/http/response";
import { verifyStripeWebhookSignature } from "@getstrata/core/security/stripeWebhook";
import { applyStripeWebhook } from "../../billing/applyStripeWebhook.ts";
import { STARTER_BILLING_OPTIONS_TOKEN } from "../../bootstrap/providers/index.ts";

const billingModule: AppModule = {
  name: "billing",
  order: 40,
  routes({ kernel, dependencies }) {
    const {enabled:billingEnabled,stripeSecret:secret} = dependencies.container.get(STARTER_BILLING_OPTIONS_TOKEN);
    return {
      "/billing/webhooks/stripe": {
        POST: kernel.wrap("api", kernel.wrapIdentity(async (request, ports) => {
          if (!billingEnabled) return new Response("Not found", { status: 404 });
          if (!secret) {
            return jsonResponse({ error: "STRIPE_WEBHOOK_SECRET is not set." }, { status: 503 });
          }
          const rawBody = await request.text();
          verifyStripeWebhookSignature(rawBody, request.headers.get("stripe-signature"), secret);
          let event: { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
          try {
            event = JSON.parse(rawBody) as typeof event;
          } catch {
            return jsonResponse({ error: "Invalid JSON." }, { status: 400 });
          }
          await applyStripeWebhook(event, ports);
          return jsonResponse({ received: true, id: event.id ?? null, type: event.type ?? null });
        })),
      },
      "/api/v1/billing/subscription": {
        GET: kernel.wrapApi(async (_request, ports) => {
          if (!billingEnabled) return new Response("Not found", { status: 404 });
${subscriptionQuery}
          const row = rows[0];
          if (!row) return jsonResponse({ plan: "free", status: "none" });
          return jsonResponse({
            plan: row.plan ?? "free",
            status: row.status ?? "none",
            stripe_subscription_id: row.stripe_subscription_id ?? null,
            current_period_end: row.current_period_end ?? null,
          });
        }),
      },
    };
  },
};

export default billingModule;
`;
}

function githubOAuthEnabled(layers: StarterLayers): boolean {
  return Boolean(layers.extras.oauthGithub && htmlAuthKit(layers.auth));
}

export {
  billingMigrationName,
  githubOAuthEnabled,
  renderApplyStripeWebhook,
  renderBillingMigration,
  renderBillingModule,
  renderDispatchOutboundWebhookJob,
  renderNoteCreatedWebhookListener,
  renderWebhooksMigration,
  webhookMigrationName,
};
