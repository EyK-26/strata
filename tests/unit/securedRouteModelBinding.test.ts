import { describe, expect, test } from "bun:test";
import { setActiveApplicationContext } from "../../src/bootstrap/applicationRegistry";
import { CORE_AUTH_TOKEN, CORE_POLICY_GATE_TOKEN } from "../../src/bootstrap/config";
import { type AppDependencies, ConfigStore, ServiceContainer } from "../../src/bootstrap/contracts";
import type { AuthUser } from "../../src/core/auth/authContext";
import { AuthManager, GuestGuard } from "../../src/core/auth/guard";
import { Policy, PolicyGate } from "../../src/core/auth/policy";
import CacheRepository from "../../src/core/cache/repository";
import SimpleCache from "../../src/core/cache/simpleCache";
import SimpleCacheStore from "../../src/core/cache/simpleCacheStore";
import { ForbiddenError, NotFoundError, PreconditionFailedError } from "../../src/core/errors/http";
import { etagFromResource } from "../../src/core/http/etag";
import { securedBindRouteModel } from "../../src/core/http/securedRouteModelBinding";
import { createStorageDriver, StorageManager } from "../../src/core/storage/storage";

interface WidgetRecord {
  id: number;
  name: string;
  updated_at: string;
}

class WidgetPolicy extends Policy {
  override view(_user: AuthUser | null, _resource: WidgetRecord): boolean {
    return true;
  }

  override update(_user: AuthUser | null, _resource: WidgetRecord): boolean {
    return _user?.role === "admin";
  }
}

type WidgetParams = { id: string };

function bootstrapPolicyGate(): AppDependencies {
  const container = new ServiceContainer();
  const cache = new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20)));
  const gate = new PolicyGate();
  gate.register("widget", new WidgetPolicy());

  container.set(CORE_AUTH_TOKEN, new AuthManager(new GuestGuard()));
  container.set(CORE_POLICY_GATE_TOKEN, gate);

  const dependencies = { container, cache, storage: new StorageManager(createStorageDriver()) };

  setActiveApplicationContext({
    container,
    config: new ConfigStore(),
    dependencies,
  });

  return dependencies;
}

describe("securedBindRouteModel", () => {
  test("authorizes against the resolved model before running the handler", async () => {
    bootstrapPolicyGate();

    const handler = securedBindRouteModel(
      "id",
      async (id) => ({
        id,
        name: `Widget ${id}`,
        updated_at: "2026-01-01T00:00:00.000Z",
      }),
      { resource: "widget", action: "update" },
      async (_request, widget) => Response.json(widget),
    );

    await expect(
      handler({
        params: { id: "1" },
        headers: new Headers(),
      } as Request & { params: WidgetParams }),
    ).rejects.toThrow(ForbiddenError);

    const model = {
      id: 1,
      name: "Widget 1",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    const etag = etagFromResource(model);

    const response = await handler({
      params: { id: "1" },
      headers: new Headers({
        "x-authenticated-user-id": "1",
        "x-authenticated-user-role": "admin",
        "if-match": etag,
      }),
    } as Request & { params: WidgetParams });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(model);
  });

  test("propagates resolver failures before authorization runs", async () => {
    bootstrapPolicyGate();

    const handler = securedBindRouteModel(
      "id",
      async (id) => {
        throw new NotFoundError(`Widget ${id} not found.`);
      },
      { resource: "widget", action: "update" },
      async () => Response.json({ ok: true }),
    );

    await expect(
      handler({
        params: { id: "404" },
        headers: new Headers({
          "x-authenticated-user-id": "1",
          "x-authenticated-user-role": "admin",
        }),
      } as Request & { params: WidgetParams }),
    ).rejects.toThrow("Widget 404 not found.");
  });

  test("returns 304 for view when If-None-Match matches", async () => {
    bootstrapPolicyGate();

    const model = {
      id: 1,
      name: "Widget 1",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    const etag = etagFromResource(model);

    const handler = securedBindRouteModel(
      "id",
      async () => model,
      { resource: "widget", action: "view" },
      async (_request, widget) => Response.json(widget),
    );

    const response = await handler({
      params: { id: "1" },
      headers: new Headers({
        "if-none-match": etag,
      }),
    } as Request & { params: WidgetParams });

    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe(etag);
  });

  test("rejects update when If-Match does not match", async () => {
    bootstrapPolicyGate();

    const handler = securedBindRouteModel(
      "id",
      async (id) => ({
        id,
        name: `Widget ${id}`,
        updated_at: "2026-01-01T00:00:00.000Z",
      }),
      { resource: "widget", action: "update" },
      async (_request, widget) => Response.json(widget),
    );

    await expect(
      handler({
        params: { id: "1" },
        headers: new Headers({
          "x-authenticated-user-id": "1",
          "x-authenticated-user-role": "admin",
          "if-match": 'W/"stale"',
        }),
      } as Request & { params: WidgetParams }),
    ).rejects.toThrow(PreconditionFailedError);
  });

  test("rejects update when If-Match header is missing", async () => {
    bootstrapPolicyGate();

    const handler = securedBindRouteModel(
      "id",
      async (id) => ({
        id,
        name: `Widget ${id}`,
        updated_at: "2026-01-01T00:00:00.000Z",
      }),
      { resource: "widget", action: "update" },
      async (_request, widget) => Response.json(widget),
    );

    await expect(
      handler({
        params: { id: "1" },
        headers: new Headers({
          "x-authenticated-user-id": "1",
          "x-authenticated-user-role": "admin",
        }),
      } as Request & { params: WidgetParams }),
    ).rejects.toThrow(PreconditionFailedError);
  });
});
