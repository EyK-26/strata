import { describe, expect, test } from "bun:test";
import { ConfigStore, ServiceContainer } from "@getstrata/core/contracts/container";
import type { AppContext } from "@getstrata/core/contracts/di";
import { CORE_EVENT_BUS_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import { hasMany } from "@getstrata/core/database/relationships";
import { ValidationError } from "@getstrata/core/errors/http";
import { EventBus } from "@getstrata/core/events";
import { cache, events } from "@getstrata/core/facades";
import { readClientIp, trustForwardedFor } from "@getstrata/core/http/clientIp";
import { createdResponse, jsonResponse, withErrorHandling } from "@getstrata/core/http/response";
import {
  clearActiveApplicationContext,
  setActiveApplicationContext,
} from "@getstrata/core/runtime/applicationRegistry";
import {
  isRlsTenancy,
  isTenancyEnabled,
  readTenancyDriver,
} from "@getstrata/core/tenant/tenancyConfig";
import { createMockDependencies } from "./testHelpers";

describe("published subpath surface", () => {
  test("http/response exports JSON helpers", () => {
    expect(typeof jsonResponse).toBe("function");
    expect(typeof createdResponse).toBe("function");
    expect(typeof withErrorHandling).toBe("function");
    expect(jsonResponse({ ok: true }).status).toBe(200);
  });

  test("errors/http exports ValidationError for instanceof checks", () => {
    expect(new ValidationError()).toBeInstanceOf(ValidationError);
  });

  test("database/relationships exports relation helpers", () => {
    expect(typeof hasMany).toBe("function");
  });

  test("facades exports cache helper", () => {
    expect(typeof cache).toBe("function");
  });

  test("http/clientIp exports forwarded-for helpers", () => {
    expect(typeof readClientIp).toBe("function");
    expect(typeof trustForwardedFor).toBe("function");
    expect(trustForwardedFor({})).toBe(false);
  });

  test("tenant/tenancyConfig exports rls, column, and none", () => {
    expect(readTenancyDriver({})).toBe("rls");
    expect(isTenancyEnabled({ TENANCY_DRIVER: "none" })).toBe(false);
    expect(isRlsTenancy({ TENANCY_DRIVER: "column" })).toBe(false);
    expect(isTenancyEnabled({ TENANCY_DRIVER: "column" })).toBe(true);
  });
});

test("events facade requires a registered legacy application bus and preserves its identity", async () => {
  // Retained applicationRegistry is ambient legacy composition, not canonical execution ownership.
  const key = Symbol.for("@getstrata/applicationContext");
  const previous = (globalThis as Record<symbol, AppContext | undefined>)[key];
  if (previous) clearActiveApplicationContext(previous);
  const container = new ServiceContainer();
  const context: AppContext = {
    container,
    config: new ConfigStore(),
    dependencies: createMockDependencies(container),
  };
  try {
    expect(() => events()).toThrow("not been bootstrapped");
    setActiveApplicationContext(context);
    expect(() => events()).toThrow("core.eventBus");
    const bus = new EventBus();
    container.set(CORE_EVENT_BUS_TOKEN, bus);
    expect(events()).toBe(bus);
    const seen: number[] = [];
    bus.listen("owned", (value) => {
      seen.push(Number(value));
    });
    await events().dispatch("owned", 7);
    expect(seen).toEqual([7]);
  } finally {
    clearActiveApplicationContext(context);
    if (previous) setActiveApplicationContext(previous);
  }
});
