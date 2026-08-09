import { describe, expect, test } from "bun:test";
import { formatAdminValue } from "@getstrata/core/admin/formatValue";

describe("formatAdminValue", () => {
  test("formats nullish values as empty strings", () => {
    expect(formatAdminValue(null)).toBe("");
    expect(formatAdminValue(undefined)).toBe("");
  });

  test("formats booleans", () => {
    expect(formatAdminValue(true, "boolean")).toBe("yes");
    expect(formatAdminValue(false, "boolean")).toBe("no");
  });

  test("formats numbers", () => {
    expect(formatAdminValue(42, "number")).toBe("42");
  });

  test("formats datetimes", () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    expect(formatAdminValue(date, "datetime")).toBe("2026-01-01T00:00:00.000Z");
    expect(formatAdminValue("2026-01-01", "datetime")).toBe("2026-01-01");
  });

  test("formats code values", () => {
    expect(formatAdminValue("payload", "code")).toBe("payload");
    expect(formatAdminValue({ key: "value" }, "code")).toBe('{\n  "key": "value"\n}');
  });

  test("formats objects and plain text", () => {
    expect(formatAdminValue({ nested: true })).toBe('{"nested":true}');
    expect(formatAdminValue("hello")).toBe("hello");
  });
});
