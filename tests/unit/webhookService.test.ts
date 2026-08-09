import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { runWithTenant } from "../../src/core/tenant/tenantContext";
import type { WebhookRecord } from "../../src/modules/webhook/types";

const dispatched: Array<{ webhookId: number; event: string; payload: Record<string, unknown> }> =
  [];

let WebhookService: typeof import("../../src/modules/webhook/service").default;

const repository = {
  create: mock(async (input: Omit<WebhookRecord, "id">) => ({
    id: 42,
    ...input,
  })),
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
        payload: { webhookId: number; event: string; payload: Record<string, unknown> },
      ) => {
        dispatched.push(payload);
      },
    }),
  }));

  mock.module("../../src/core/queue/createAppQueue", () => ({
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
      { webhookId: 1, event: "task.created", payload: { id: 99 } },
      { webhookId: 2, event: "task.created", payload: { id: 99 } },
    ]);
  });
});
