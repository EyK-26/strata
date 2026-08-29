import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { runWithTenant } from "@getstrata/core/tenant/tenantContext";
import type { WebhookRecord } from "../../src/modules/webhook/types";

const dispatched: Array<{
  webhookId: number;
  tenantId: number;
  event: string;
  payload: Record<string, unknown>;
}> = [];

let WebhookService: typeof import("../../src/modules/webhook/service").default;

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
      ] as WebhookRecord[],
  ),
};

beforeAll(async () => {
  mock.module("../../src/bootstrap/applicationRegistry", () => ({
    resolveApplicationQueue: () => ({
      dispatch: async (
        _job: unknown,
        payload: {
          webhookId: number;
          tenantId: number;
          event: string;
          payload: Record<string, unknown>;
        },
      ) => {
        dispatched.push(payload);
      },
    }),
  }));

  mock.module("@getstrata/core/queue/createAppQueue", () => ({
    createTrackedJob: (_name: string, job: unknown) => job,
  }));

  ({ default: WebhookService } = await import("../../src/modules/webhook/service"));
});

afterAll(() => {
  mock.restore();
});

describe("WebhookService", () => {
  beforeEach(() => {
    dispatched.length = 0;
    repository.create.mockClear?.();
    repository.listActive.mockClear?.();
    repository.findById.mockClear?.();
    repository.updateByIdOrThrow.mockClear?.();
    repository.deleteById.mockClear?.();
    repository.findDeliveryById.mockClear?.();
  });

  test("creates a webhook with tenant defaults", async () => {
    const service = new WebhookService(repository as never);

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
        url: "http://hooks.example.com/new",
        secret: "top-secret",
        events: ["*"],
        active: true,
      }),
    );
  });

  test("rejects unsafe webhook urls", async () => {
    const service = new WebhookService(repository as never);

    await expect(
      service.create({
        url: "http://127.0.0.1/hook",
        secret: "secret",
      }),
    ).rejects.toThrow(/blocked host/);
  });

  test("lists active webhooks", async () => {
    const service = new WebhookService(repository as never);

    const webhooks = await service.listActive();

    expect(webhooks).toHaveLength(3);
  });

  test("dispatches only matching active webhooks", async () => {
    const service = new WebhookService(repository as never);

    await service.dispatch("task.created", { id: 99 });

    expect(dispatched).toEqual([
      { webhookId: 1, tenantId: 1, event: "task.created", payload: { id: 99 } },
      { webhookId: 2, tenantId: 1, event: "task.created", payload: { id: 99 } },
    ]);
  });

  test("deactivates, activates, and deletes a webhook", async () => {
    const service = new WebhookService(repository as never);

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
    const service = new WebhookService(repository as never);

    await service.retryDelivery(8);
    await service.retryDelivery(9);
    await expect(service.retryDelivery(404)).rejects.toThrow(/delivery 404 not found/);
    await expect(service.retryDelivery(10)).rejects.toThrow(/Webhook 404 not found/);

    expect(dispatched).toEqual([
      { webhookId: 1, tenantId: 1, event: "task.created", payload: { id: 99 } },
      { webhookId: 1, tenantId: 1, event: "task.updated", payload: { id: 100 } },
    ]);
  });
});
