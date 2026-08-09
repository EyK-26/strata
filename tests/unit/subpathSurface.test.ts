import { describe, expect, test } from "bun:test";
import { hasMany } from "@getstrata/core/database/relationships";
import { ValidationError } from "@getstrata/core/errors/http";
import { cache } from "@getstrata/core/facades";
import { readClientIp, trustForwardedFor } from "@getstrata/core/http/clientIp";
import { createdResponse, jsonResponse, withErrorHandling } from "@getstrata/core/http/response";
import {
  isRlsTenancy,
  isTenancyEnabled,
  readTenancyDriver,
} from "@getstrata/core/tenant/tenancyConfig";

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
