import { afterEach, describe, expect, mock, test } from "bun:test";
import { DispatchWebhookJob } from "@getstrata/core/jobs/dispatchWebhookJob";
import db from "../../src/db/connection";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("DispatchWebhookJob", () => {
  test("exposes retry metadata on the job class", () => {
    const job = new DispatchWebhookJob();

    expect(job.maxAttempts).toBe(3);
    expect(job.backoffMs).toBe(2_000);
  });

  test("returns early when the webhook does not exist", async () => {
    const job = new DispatchWebhookJob();

    await expect(
      job.handle({
        webhookId: 999_999,
        tenantId: 1,
        event: "task.created",
        payload: { id: 1 },
      }),
    ).resolves.toBeUndefined();

    await expect(
      job.handle({
        webhookId: 999_999,
        tenantId: 1,
        url: "http://127.0.0.1/missing-secret",
        event: "task.created",
        payload: { id: 1 },
      }),
    ).resolves.toBeUndefined();
  });

  test("delivers a webhook and records a successful delivery", async () => {
    const inserted = (await db`
      INSERT INTO webhook (organization_id, tenant_id, url, secret, events, active, created_at)
      VALUES (
        NULL,
        1,
        ${"http://hooks.example.com/workhub"},
        ${"whsec_test"},
        ${["task.created"]},
        TRUE,
        NOW()
      )
      RETURNING id
    `) as Array<{ id: number }>;

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("ok", { status: 200 })),
    ) as unknown as typeof fetch;

    const job = new DispatchWebhookJob();

    await job.handle({
      webhookId: inserted[0]!.id,
      tenantId: 1,
      event: "task.created",
      payload: { id: 42 },
    });

    const deliveries = (await db`
      SELECT response_status, error
      FROM webhook_delivery
      WHERE webhook_id = ${inserted[0]!.id}
      ORDER BY id DESC
      LIMIT 1
    `) as Array<{ response_status: number | null; error: string | null }>;

    expect(deliveries[0]?.response_status).toBe(200);
    expect(deliveries[0]?.error).toBeNull();
  });

  test("records failed deliveries and rethrows http errors", async () => {
    const inserted = (await db`
      INSERT INTO webhook (organization_id, tenant_id, url, secret, events, active, created_at)
      VALUES (
        NULL,
        1,
        ${"http://hooks.example.com/failure"},
        ${"whsec_failure"},
        ${["task.updated"]},
        TRUE,
        NOW()
      )
      RETURNING id
    `) as Array<{ id: number }>;

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("fail", { status: 500 })),
    ) as unknown as typeof fetch;

    const job = new DispatchWebhookJob();

    await expect(
      job.handle({
        webhookId: inserted[0]!.id,
        tenantId: 1,
        event: "task.updated",
        payload: { id: 7 },
      }),
    ).rejects.toThrow("Webhook delivery failed with status 500.");

    const deliveries = (await db`
      SELECT response_status, error
      FROM webhook_delivery
      WHERE webhook_id = ${inserted[0]!.id}
      ORDER BY id DESC
      LIMIT 1
    `) as Array<{ response_status: number | null; error: string | null }>;

    expect(deliveries[0]?.response_status).toBe(500);
    expect(deliveries[0]?.error).toContain("Webhook delivery failed with status 500.");
  });

  test("wraps non-error throwables before rethrowing", async () => {
    const inserted = (await db`
      INSERT INTO webhook (organization_id, tenant_id, url, secret, events, active, created_at)
      VALUES (
        NULL,
        1,
        ${"http://hooks.example.com/non-error"},
        ${"whsec_non_error"},
        ${["task.deleted"]},
        TRUE,
        NOW()
      )
      RETURNING id
    `) as Array<{ id: number }>;

    globalThis.fetch = mock(() => Promise.reject("network-down")) as unknown as typeof fetch;

    const job = new DispatchWebhookJob();

    await expect(
      job.handle({
        webhookId: inserted[0]!.id,
        tenantId: 1,
        event: "task.deleted",
        payload: { id: 3 },
      }),
    ).rejects.toThrow("network-down");

    const deliveries = (await db`
      SELECT error
      FROM webhook_delivery
      WHERE webhook_id = ${inserted[0]!.id}
      ORDER BY id DESC
      LIMIT 1
    `) as Array<{ error: string | null }>;

    expect(deliveries[0]?.error).toBe("network-down");
  });

  test("records unsafe webhook urls without failing the job", async () => {
    const inserted = (await db`
      INSERT INTO webhook (organization_id, tenant_id, url, secret, events, active, created_at)
      VALUES (
        NULL,
        1,
        ${"http://127.0.0.1/hook"},
        ${"whsec_blocked"},
        ${["*"]},
        TRUE,
        NOW()
      )
      RETURNING id
    `) as Array<{ id: number }>;

    const job = new DispatchWebhookJob();

    await expect(
      job.handle({
        webhookId: inserted[0]!.id,
        tenantId: 1,
        event: "task.created",
        payload: {},
      }),
    ).resolves.toBeUndefined();

    const deliveries = (await db`
      SELECT response_status, error
      FROM webhook_delivery
      WHERE webhook_id = ${inserted[0]!.id}
      ORDER BY id DESC
      LIMIT 1
    `) as Array<{ response_status: number | null; error: string | null }>;

    expect(deliveries[0]?.response_status).toBeNull();
    expect(deliveries[0]?.error).toMatch(/blocked host/);
  });

  test("delivers from queued url and secret without selecting the webhook row", async () => {
    const inserted = (await db`
      INSERT INTO webhook (organization_id, tenant_id, url, secret, events, active, created_at)
      VALUES (
        NULL,
        1,
        ${"https://example.com/queued-select-bypass"},
        ${"whsec_queued"},
        ${["*"]},
        TRUE,
        NOW()
      )
      RETURNING id
    `) as Array<{ id: number }>;

    const job = new DispatchWebhookJob();

    await expect(
      job.handle({
        webhookId: inserted[0]!.id,
        tenantId: 1,
        url: "http://127.0.0.1/queued-hook",
        secret: "whsec_queued",
        event: "project.created",
        payload: { organization_id: 1 },
      }),
    ).resolves.toBeUndefined();

    const deliveries = (await db`
      SELECT response_status, error
      FROM webhook_delivery
      WHERE webhook_id = ${inserted[0]!.id}
      ORDER BY id DESC
      LIMIT 1
    `) as Array<{ response_status: number | null; error: string | null }>;

    expect(deliveries[0]?.response_status).toBeNull();
    expect(deliveries[0]?.error).toMatch(/blocked host/);
  });
});
