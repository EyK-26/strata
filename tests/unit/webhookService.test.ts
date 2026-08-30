import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Queue } from "@getstrata/core/queue";
import { runWithTenant } from "@getstrata/core/tenant/tenantContext";
import WebhookService from "../../src/modules/webhook/service";
import type { WebhookRecord } from "../../src/modules/webhook/types";

const dispatched: Array<{
  webhookId: number;
  tenantId: number;
  url?: string;
  secret?: string;
  event: string;
  payload: Record<string, unknown>;
}> = [];

const sampleWebhook: WebhookRecord = {
  id: 1,
  organization_id: null,
  tenant_id: 1,
  url: "http://hooks.example.com/all",
  secret: "secret-all",
  events: ["*"],
  active: true,
  created_at: new Date(),
};

const repository = {
  create: mock(async (input: Omit<WebhookRecord, "id">) => ({
    id: 42,
    ...input,
  })),
  findById: mock(async (id: number) => (id === sampleWebhook.id ? sampleWebhook : null)),
  updateByIdOrThrow: mock(async (id: number, values: Partial<WebhookRecord>) => ({
    ...sampleWebhook,
    id,
    ...values,
  })),
  deleteById: mock(async () => true),
  findDeliveryById: mock(async (id: number) =>
    id === 8
      ? {
          id: 8,
          webhook_id: 1,
          event: "task.created",
          payload: { id: 99 },
          response_status: 500,
          created_at: new Date(),
        }
      : id === 9
        ? {
            id: 9,
            webhook_id: 1,
            event: "task.updated",
            payload: JSON.stringify({ id: 100 }),
            response_status: null,
            created_at: new Date(),
          }
        : id === 10
          ? {
              id: 10,
              webhook_id: 404,
              event: "task.deleted",
              payload: { id: 1 },
              response_status: null,
              created_at: new Date(),
            }
          : null,
  ),
  findAll: mock(async () => repository.listActive()),
  listActive: mock(
    async () =>
      [
        {
          id: 1,
          organization_id: null,
          tenant_id: 1,
          url: "http://hooks.example.com/all",
          secret: "secret-all",
          events: ["*"],
          active: true,
          created_at: new Date(),
        },
        {
          id: 2,
          organization_id: null,
          tenant_id: 1,
          url: "http://hooks.example.com/task-created",
          secret: "secret-task",
          events: ["task.created"],
          active: true,
          created_at: new Date(),
        },
        {
          id: 3,
          organization_id: null,
          tenant_id: 1,
          url: "http://hooks.example.com/other",
          secret: "secret-other",
          events: ["project.created"],
          active: true,
          created_at: new Date(),
        },
        {
          id: 4,
          organization_id: 7,
          tenant_id: 1,
          url: "http://hooks.example.com/team-7",
          secret: "secret-team-7",
          events: ["*"],
          active: true,
          created_at: new Date(),
        },
        {
          id: 5,
          organization_id: 8,
          tenant_id: 1,
          url: "http://hooks.example.com/team-8",
          secret: "secret-team-8",
          events: ["*"],
          active: true,
          created_at: new Date(),
        },
      ] as WebhookRecord[],
  ),
};

const queue = {
  async dispatch(
    _job: unknown,
    payload: {
      webhookId: number;
      tenantId: number;
      url?: string;
      secret?: string;
      event: string;
      payload: Record<string, unknown>;
    },
  ) {
    dispatched.push(payload);
  },
} as Queue;

function makeService(): WebhookService {
  return new WebhookService(repository as never, queue);
}

describe("WebhookService", () => {
  beforeEach(() => {
    dispatched.length = 0;
    repository.create.mockClear?.();
    repository.findAll.mockClear?.();
    repository.listActive.mockClear?.();
    repository.findById.mockClear?.();
    repository.updateByIdOrThrow.mockClear?.();
    repository.deleteById.mockClear?.();
    repository.findDeliveryById.mockClear?.();
  });

  test("creates a webhook with tenant defaults", async () => {
    const service = makeService();

    const created = await runWithTenant({ id: 1, slug: "default", plan: "pro", region: "eu" }, () =>
      service.create({
        url: "http://hooks.example.com/new",
        secret: "top-secret",
      }),
    );

    expect(created.id).toBe(42);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 1,
        organization_id: null,
        url: "http://hooks.example.com/new",
        secret: "top-secret",
        events: ["*"],
        active: true,
      }),
    );
  });

  test("creates a webhook for an explicit organization", async () => {
    const service = makeService();

    await runWithTenant({ id: 1, slug: "default", plan: "pro", region: "eu" }, () =>
      service.create({
        url: "http://hooks.example.com/org",
        secret: "org-secret",
        organizationId: 7,
      }),
    );

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 1,
        organization_id: 7,
        url: "http://hooks.example.com/org",
      }),
    );
  });

  test("rejects unsafe webhook urls", async () => {
    const service = makeService();

    await expect(
      service.create({
        url: "http://127.0.0.1/hook",
        secret: "secret",
      }),
    ).rejects.toThrow(/blocked host/);
  });

  test("lists active webhooks", async () => {
    const service = makeService();

    const webhooks = await service.listActive();

    expect(webhooks).toHaveLength(5);
  });

  test("lists HTML webhooks for one team plus tenant-wide endpoints", async () => {
    const service = makeService();

    const scoped = await service.listForHtml(7);
    const all = await service.listForHtml();

    expect(scoped.map((webhook) => webhook.id)).toEqual([1, 2, 3, 4]);
    expect(all).toHaveLength(5);
  });

  test("dispatches only matching active webhooks", async () => {
    const service = makeService();

    await service.dispatch("task.created", { id: 99 });

    expect(dispatched).toEqual([
      {
        webhookId: 1,
        tenantId: 1,
        url: "http://hooks.example.com/all",
        secret: "secret-all",
        event: "task.created",
        payload: { id: 99 },
      },
      {
        webhookId: 2,
        tenantId: 1,
        url: "http://hooks.example.com/task-created",
        secret: "secret-task",
        event: "task.created",
        payload: { id: 99 },
      },
    ]);
  });

  test("skips webhooks whose events list is not a string array", async () => {
    repository.listActive.mockImplementationOnce(
      async () =>
        [
          {
            ...sampleWebhook,
            id: 6,
            events: { invalid: true } as unknown as string[],
          },
          {
            ...sampleWebhook,
            id: 7,
            events: [1, "task.created"] as unknown as string[],
          },
          {
            ...sampleWebhook,
            id: 8,
            events: '["task.created"]' as unknown as string[],
          },
        ] as WebhookRecord[],
    );
    const service = makeService();

    await service.dispatch("task.created", { id: 99 });

    expect(dispatched).toEqual([
      {
        webhookId: 7,
        tenantId: 1,
        url: "http://hooks.example.com/all",
        secret: "secret-all",
        event: "task.created",
        payload: { id: 99 },
      },
      {
        webhookId: 8,
        tenantId: 1,
        url: "http://hooks.example.com/all",
        secret: "secret-all",
        event: "task.created",
        payload: { id: 99 },
      },
    ]);
  });

  test("matches team-scoped webhooks when organization_id is a driver string", async () => {
    repository.listActive.mockImplementationOnce(
      async () =>
        [
          {
            ...sampleWebhook,
            id: 11,
            organization_id: "7" as unknown as number,
            events: ["*"],
          },
          {
            ...sampleWebhook,
            id: 12,
            organization_id: "8" as unknown as number,
            events: ["*"],
          },
        ] as WebhookRecord[],
    );
    const service = makeService();
    const payload = { organization_id: 7, id: 99 };

    await service.dispatch("task.created", payload);

    expect(dispatched).toEqual([
      {
        webhookId: 11,
        tenantId: 1,
        url: "http://hooks.example.com/all",
        secret: "secret-all",
        event: "task.created",
        payload,
      },
    ]);
  });

  test("dispatches team-scoped webhooks only when the payload org matches", async () => {
    const service = makeService();
    const payload = { organization_id: 7, id: 99 };

    await service.dispatch("task.created", payload);

    expect(dispatched).toEqual([
      {
        webhookId: 1,
        tenantId: 1,
        url: "http://hooks.example.com/all",
        secret: "secret-all",
        event: "task.created",
        payload,
      },
      {
        webhookId: 2,
        tenantId: 1,
        url: "http://hooks.example.com/task-created",
        secret: "secret-task",
        event: "task.created",
        payload,
      },
      {
        webhookId: 4,
        tenantId: 1,
        url: "http://hooks.example.com/team-7",
        secret: "secret-team-7",
        event: "task.created",
        payload,
      },
    ]);
  });

  test("deactivates, activates, and deletes a webhook", async () => {
    const service = makeService();

    await expect(service.deactivate(1)).resolves.toEqual(
      expect.objectContaining({ id: 1, active: false }),
    );
    await expect(service.activate(1)).resolves.toEqual(
      expect.objectContaining({ id: 1, active: true }),
    );
    await service.delete(1);
    expect(repository.deleteById).toHaveBeenCalledWith(1);
    await expect(service.deactivate(99)).rejects.toThrow(/Webhook 99 not found/);
  });

  test("retries a stored delivery and parses JSON string payloads", async () => {
    const service = makeService();

    await service.retryDelivery(8);
    await service.retryDelivery(9);
    await expect(service.retryDelivery(404)).rejects.toThrow(/delivery 404 not found/);
    await expect(service.retryDelivery(10)).rejects.toThrow(/Webhook 404 not found/);

    expect(dispatched).toEqual([
      {
        webhookId: 1,
        tenantId: 1,
        url: "http://hooks.example.com/all",
        secret: "secret-all",
        event: "task.created",
        payload: { id: 99 },
      },
      {
        webhookId: 1,
        tenantId: 1,
        url: "http://hooks.example.com/all",
        secret: "secret-all",
        event: "task.updated",
        payload: { id: 100 },
      },
    ]);
  });
});
