import { describe, expect, mock, test } from "bun:test";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import WebhookController from "../../src/modules/webhook/controller";
import { webhookServiceToken } from "../../src/modules/webhook/provider";
import { createMockCache, createMockDependencies } from "./testHelpers";

describe("WebhookController", () => {
  function createController(service: {
    listActive: () => Promise<unknown[]>;
    create: (input: unknown) => Promise<{ id: number; url: string; events: string[] }>;
    deactivate?: (id: number) => Promise<{ id: number; active: boolean }>;
    activate?: (id: number) => Promise<{ id: number; active: boolean }>;
    delete?: (id: number) => Promise<void>;
    retryDelivery?: (id: number) => Promise<void>;
  }): WebhookController {
    const container = new ServiceContainer();
    container.set(webhookServiceToken, service);

    return new WebhookController(createMockDependencies(container, createMockCache()));
  }

  test("lists active webhooks", async () => {
    const listActive = mock(async () => [
      {
        id: 1,
        organization_id: null,
        url: "http://hooks.example.com/all",
        events: ["*"],
        active: true,
      },
    ]);

    const controller = createController({
      listActive,
      create: mock(async () => ({ id: 1, url: "unused", events: ["*"] })),
    });

    const response = await controller.index();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [
        {
          id: 1,
          organization_id: null,
          url: "http://hooks.example.com/all",
          events: ["*"],
          active: true,
        },
      ],
    });
  });

  test("creates a webhook from the request body", async () => {
    const create = mock(async (input: unknown) => {
      const body = input as {
        url: string;
        secret: string;
        organizationId?: number;
        events?: string[];
      };

      return {
        id: 7,
        url: body.url,
        events: body.events ?? ["*"],
      };
    });

    const controller = createController({
      listActive: mock(async () => []),
      create,
    });

    const response = await controller.store(
      new Request("https://example.test/api/v1/webhooks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "http://hooks.example.com/new",
          secret: "secret-value",
          organization_id: 3,
          events: ["task.created"],
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      id: 7,
      url: "http://hooks.example.com/new",
      events: ["task.created"],
    });
    expect(create).toHaveBeenCalledWith({
      url: "http://hooks.example.com/new",
      secret: "secret-value",
      organizationId: 3,
      events: ["task.created"],
    });
  });

  test("deactivates, activates, deletes, and retries through route params", async () => {
    const deactivate = mock(async () => ({ id: 4, active: false }));
    const activate = mock(async () => ({ id: 4, active: true }));
    const destroy = mock(async () => undefined);
    const retryDelivery = mock(async () => undefined);
    const controller = createController({
      listActive: mock(async () => []),
      create: mock(async () => ({ id: 1, url: "unused", events: ["*"] })),
      deactivate,
      activate,
      delete: destroy,
      retryDelivery,
    });

    const withId = (url: string) => {
      const request = new Request(url, { method: "POST" }) as Request & {
        params?: { id: string };
      };
      request.params = { id: "4" };
      return request;
    };

    expect(
      await (
        await controller.deactivate(withId("https://example.test/webhooks/4/deactivate"))
      ).json(),
    ).toEqual({ id: 4, active: false });
    expect(
      await (await controller.activate(withId("https://example.test/webhooks/4/activate"))).json(),
    ).toEqual({
      id: 4,
      active: true,
    });
    expect((await controller.destroy(withId("https://example.test/webhooks/4"))).status).toBe(204);
    expect(
      await (
        await controller.retryDelivery(withId("https://example.test/webhooks/deliveries/4/retry"))
      ).json(),
    ).toEqual({ retried: true });
    expect(deactivate).toHaveBeenCalledWith(4);
    expect(activate).toHaveBeenCalledWith(4);
    expect(destroy).toHaveBeenCalledWith(4);
    expect(retryDelivery).toHaveBeenCalledWith(4);
  });

  test("lifecycle handlers require an id param", async () => {
    const controller = createController({
      listActive: mock(async () => []),
      create: mock(async () => ({ id: 1, url: "unused", events: ["*"] })),
    });

    const response = await controller.deactivate(
      new Request("https://example.test/webhooks/deactivate"),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});
