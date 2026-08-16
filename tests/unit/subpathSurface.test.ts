import { describe, expect, test } from "bun:test";
import { hasMany } from "@getstrata/core/database/relationships";
import { ValidationError } from "@getstrata/core/errors/http";
import { cache } from "@getstrata/core/facades";
import { createdResponse, jsonResponse, withErrorHandling } from "@getstrata/core/http/response";

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
});
