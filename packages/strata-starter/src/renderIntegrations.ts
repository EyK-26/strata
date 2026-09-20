import { dialectFragments } from "./renderRuntime.ts";
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

function renderFileMigration(name: string, upSql: string[], downSql: string[]): string {
  const upCalls = upSql.map((sql) => `    await db.unsafe(${JSON.stringify(sql)});`).join("\n");
  const downCalls = downSql.map((sql) => `    await db.unsafe(${JSON.stringify(sql)});`).join("\n");
  return `import type { Migration } from "@getstrata/core/database/migrations/types";

const migration: Migration = {
  name: ${JSON.stringify(name)},
  async up(db) {
${upCalls}
  },
  async down(db) {
${downCalls}
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
  return renderFileMigration(name, up, down);
}

function renderDispatchOutboundWebhookJob(): string {
  return `import { Job } from "@getstrata/core/queue";
import { isProductionEnv } from "@getstrata/core/runtime/appEnv";
import { webhookSignatureHeader } from "@getstrata/core/runtime/appKeyPrefix";
import { safeFetch } from "@getstrata/core/security/safeFetch";
import { signWebhookBody } from "@getstrata/core/security/webhookSignature";
import { getSql } from "../bootstrap/database.ts";

interface DispatchOutboundWebhookPayload {
  webhookId: number;
  url: string;
  secret: string;
  body: string;
}

class DispatchOutboundWebhookJob extends Job<DispatchOutboundWebhookPayload> {
  static readonly jobName = "webhook.dispatch";

  override async handle(payload: DispatchOutboundWebhookPayload): Promise<void> {
    const allowPrivate = !isProductionEnv() && process.env.WEBHOOK_ALLOW_PRIVATE === "true";
    let responseStatus: number | null = null;
    let error: string | null = null;
    try {
      const response = await safeFetch(
        payload.url,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [webhookSignatureHeader()]: signWebhookBody(payload.secret, payload.body),
          },
          body: payload.body,
        },
        { timeoutMs: 10_000, maxRedirects: 0, allowPrivate, allowHttp: allowPrivate },
      );
      responseStatus = response.status;
      if (!response.ok) {
        error = \`HTTP \${response.status}\`;
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : "webhook dispatch failed";
    }

    await getSql().unsafe(
      "INSERT INTO webhook_deliveries (webhook_id, event, payload, response_status, attempt, error) VALUES (?, ?, ?, ?, ?, ?)",
      [payload.webhookId, "notes.created", payload.body, responseStatus, 1, error],
    );
  }
}

export default DispatchOutboundWebhookJob;
export type { DispatchOutboundWebhookPayload };
`;
}

function renderNoteCreatedWebhookListener(): string {
  return `import { eventBus, modelEventName } from "@getstrata/core/events";
import { resolveApplicationQueue } from "@getstrata/core/runtime/applicationRegistry";
import { getSql } from "../bootstrap/database.ts";
import DispatchOutboundWebhookJob from "../jobs/dispatchOutboundWebhookJob.ts";

function registerNoteCreatedWebhookListener(): void {
  eventBus.listen(modelEventName("notes", "created"), async (payload) => {
    const rows = await getSql().unsafe<{
      id: number;
      url: string;
      secret: string;
      active: number | boolean;
    }>("SELECT id, url, secret, active FROM webhooks");
    const queue = resolveApplicationQueue();
    const body = JSON.stringify({ event: "notes.created", data: payload });
    for (const hook of rows) {
      if (!hook.active) {
        continue;
      }
      await queue.dispatch(new DispatchOutboundWebhookJob(), {
        webhookId: hook.id,
        url: hook.url,
        secret: hook.secret,
        body,
      });
    }
  });
}

export default registerNoteCreatedWebhookListener;
`;
}

function renderBillingModule(layers: StarterLayers): string {
  const tenancyOn = usesTenantTable(layers.tenancy);
  const tenantImport = tenancyOn
    ? `import { currentTenant } from "@getstrata/core/tenant/tenantContext";\n`
    : "";
  const subscriptionQuery = tenancyOn
    ? `        const tenant = currentTenant();
        if (!tenant) {
          return jsonResponse({ error: "Tenant context is required." }, { status: 500 });
        }
        const rows = await getSql().unsafe<Record<string, unknown>>(
          "SELECT plan, status, stripe_subscription_id, current_period_end FROM subscription WHERE tenant_id = ? LIMIT 1",
          [tenant.id],
        );`
    : `        const rows = await getSql().unsafe<Record<string, unknown>>(
          "SELECT plan, status, stripe_subscription_id, current_period_end FROM subscription LIMIT 1",
        );`;

  return `import type { AppModule } from "@getstrata/bootstrap/contracts";
import { jsonResponse, withErrorHandling } from "@getstrata/core/http/response";
import { verifyStripeWebhookSignature } from "@getstrata/core/security/stripeWebhook";
${tenantImport}import { getSql } from "../../bootstrap/database.ts";

function billingEnabled(): boolean {
  return process.env.FEATURE_BILLING === "true";
}

const billingModule: AppModule = {
  name: "billing",
  order: 40,
  routes({ kernel }) {
    return {
      "/billing/webhooks/stripe": {
        POST: kernel.wrap(
          "api",
          withErrorHandling(async (request) => {
            if (!billingEnabled()) {
              return new Response("Not found", { status: 404 });
            }
            const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
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
            // Persist event.id on stripe_webhook_event yourself. Stripe POSTs have no tenant ALS.
            // Wrap those writes in runWithMigrationBypass when TENANCY_DRIVER=rls.
            // See https://github.com/EyK-26/strata/blob/main/docs/INTEGRATIONS.md
            void event.data;
            return jsonResponse({ received: true, id: event.id ?? null, type: event.type ?? null });
          }),
        ),
      },
      "/api/v1/billing/subscription": {
        GET: kernel.wrapApi(
          withErrorHandling(async () => {
            if (!billingEnabled()) {
              return new Response("Not found", { status: 404 });
            }
${subscriptionQuery}
            const row = rows[0];
            if (!row) {
              return jsonResponse({ plan: "free", status: "none" });
            }
            return jsonResponse({
              plan: row.plan ?? "free",
              status: row.status ?? "none",
              stripe_subscription_id: row.stripe_subscription_id ?? null,
              current_period_end: row.current_period_end ?? null,
            });
          }),
        ),
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
  renderBillingMigration,
  renderBillingModule,
  renderDispatchOutboundWebhookJob,
  renderNoteCreatedWebhookListener,
  renderWebhooksMigration,
  webhookMigrationName,
};
