import { describe, expect, test } from "bun:test";
import { ForbiddenError, NotFoundError } from "../../src/core/errors/http";
import { securedBindRouteModel } from "../../src/core/http/securedRouteModelBinding";
import { setActiveApplicationContext } from "../../src/bootstrap/applicationRegistry";
import {
  ConfigStore,
  ServiceContainer,
  type AppDependencies,
} from "../../src/bootstrap/contracts";
import { CORE_AUTH_TOKEN, CORE_POLICY_GATE_TOKEN } from "../../src/bootstrap/config";
import { AuthManager, GuestGuard } from "../../src/core/auth/guard";
import { Policy, PolicyGate } from "../../src/core/auth/policy";
import type { AuthUser } from "../../src/core/auth/authContext";
import CacheRepository from "../../src/core/cache/repository";
import SimpleCache from "../../src/core/cache/simpleCache";
import SimpleCacheStore from "../../src/core/cache/simpleCacheStore";

interface WidgetRecord {
  id: number;
  name: string;
}

class WidgetPolicy extends Policy {
  override update(_user: AuthUser | null, _resource: WidgetRecord): boolean {
    return _user?.role === "admin";
  }
}

type WidgetParams = { id: string };

function bootstrapPolicyGate(): AppDependencies {
  const container = new ServiceContainer();
  const cache = new CacheRepository(
    new SimpleCacheStore(new SimpleCache(60_000, 20)),
  );
  const gate = new PolicyGate();
  gate.register("widget", new WidgetPolicy());

  container.set(CORE_AUTH_TOKEN, new AuthManager(new GuestGuard()));
  container.set(CORE_POLICY_GATE_TOKEN, gate);

  const dependencies = { container, cache };

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
      async (id) => ({ id, name: `Widget ${id}` }),
      { resource: "widget", action: "update" },
      async (_request, widget) => Response.json(widget),
    );

    await expect(
      handler({
        params: { id: "1" },
        headers: new Headers(),
      } as Request & { params: WidgetParams }),
    ).rejects.toThrow(ForbiddenError);

    const response = await handler({
      params: { id: "1" },
      headers: new Headers({
        "x-authenticated-user-id": "1",
        "x-authenticated-user-role": "admin",
      }),
    } as Request & { params: WidgetParams });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 1, name: "Widget 1" });
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
});
