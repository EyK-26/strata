import { expect, test } from "bun:test";
import { applyCasts, dehydrateValue, hydrateValue } from "@getstrata/core/database/model";

test("public model casts preserve nullish values, date identity and JSON values", () => {
  for (const value of [null, undefined]) {
    expect(hydrateValue(value, "json")).toBe(value);
    expect(dehydrateValue(value, "json")).toBe(value);
  }
  const date = new Date("2026-01-02T03:04:05Z");
  for (const cast of ["date", "datetime"] as const) {
    expect(hydrateValue(date, cast)).toBe(date);
    expect(dehydrateValue(date, cast)).toBe(date);
    expect(hydrateValue(date.toISOString(), cast)).toEqual(date);
    expect(dehydrateValue(date.toISOString(), cast)).toEqual(date);
  }
  const data = { count: 2 };
  expect(hydrateValue(data, "json")).toBe(data);
  expect(hydrateValue(JSON.stringify(data), "json")).toEqual(data);
  expect(dehydrateValue(data, "json")).toBe(JSON.stringify(data));
  expect(dehydrateValue(JSON.stringify(data), "json")).toBe(JSON.stringify(data));
  expect(hydrateValue("existing-password-value", "hashed")).toBe("existing-password-value");
});

test("public integer and boolean casts preserve their existing conversion rules", () => {
  for (const cast of ["int", "integer"] as const) {
    expect(hydrateValue("", cast)).toBeNull();
    expect(dehydrateValue("", cast)).toBeNull();
    expect(hydrateValue("42", cast)).toBe(42);
    expect(dehydrateValue("42", cast)).toBe(42);
  }
  for (const cast of ["bool", "boolean"] as const) {
    for (const value of [true, 1, "1", "true"]) expect(hydrateValue(value, cast)).toBe(true);
    for (const value of [false, 0, "0", "false"]) expect(hydrateValue(value, cast)).toBe(false);
    expect(dehydrateValue("false", cast)).toBe(true);
    expect(dehydrateValue(0, cast)).toBe(false);
  }
});

test("untyped callers retain the existing pass-through for unrecognized cast tags", () => {
  const data = { preserved: true };
  // Reflect models a JavaScript caller; the public CastType union remains narrow.
  expect(Reflect.apply(hydrateValue, undefined, [data, "unrecognized"])).toBe(data);
  expect(Reflect.apply(dehydrateValue, undefined, [data, "unrecognized"])).toBe(data);
});

test("cast maps preserve an uncast input and do not add absent columns", async () => {
  const input = { id: 1, count: "2" };
  expect(applyCasts(input, {}, "hydrate")).toBe(input);
  expect(await applyCasts(input, {}, "dehydrate")).toBe(input);
  const casts = { count: "int", absent: "json", unspecified: undefined } as const;
  expect(applyCasts(input, casts, "hydrate")).toEqual({ id: 1, count: 2 });
  expect(await applyCasts(input, casts, "dehydrate")).toEqual({ id: 1, count: 2 });
  expect(input).toEqual({ id: 1, count: "2" });
});
