import { describe, expect, test } from "bun:test";
import { runWithSqlDialect } from "@getstrata/core/database/dialect";
import { dehydrateValue, filterMassAssignable } from "@getstrata/core/database/model";
import { buildSelectQuery } from "@getstrata/core/database/query";
import { defineTable } from "@getstrata/core/database/table";
import { isAllowedMimeType } from "../../../src/core/http/uploads";

const notes = defineTable<{ id: number; status: string | null }, "id">({
  name: "notes",
  primaryKey: "id",
  columns: ["id", "status"],
});

function whereSql(where: unknown): string {
  return runWithSqlDialect("sqlite", () => {
    const { text } = buildSelectQuery(notes, { where } as never);
    return text.replace(/\s+/g, " ").split(" WHERE ")[1] ?? "";
  }) as unknown as string;
}

describe("not-equal and not-in operators", () => {
  test("ne compiles to <> with a bound parameter", () => {
    expect(whereSql({ status: { ne: "draft" } })).toBe('"notes"."status" <> ?');
  });

  test("ne null compiles to IS NOT NULL, mirroring eq null", () => {
    expect(whereSql({ status: { ne: null } })).toBe('"notes"."status" IS NOT NULL');
  });

  test("notIn compiles to NOT IN with one placeholder per value", () => {
    expect(whereSql({ status: { notIn: ["a", "b"] } })).toBe('"notes"."status" NOT IN (?, ?)');
  });

  test("notIn with no values excludes nothing", () => {
    expect(whereSql({ status: { notIn: [] } })).toBe("1 = 1");
  });

  test("in with no values still matches nothing", () => {
    expect(whereSql({ status: { in: [] } })).toBe("1 = 0");
  });

  test("ne and notIn combine with other operators on the same column", () => {
    expect(whereSql({ status: { ne: "draft", notIn: ["x"] } })).toBe(
      '"notes"."status" <> ? AND "notes"."status" NOT IN (?)',
    );
  });
});

describe("unknown query operators", () => {
  test("an unsupported operator throws instead of dropping the filter", () => {
    expect(() => whereSql({ status: { nope: "x" } })).toThrow(/Unsupported query operator/);
  });

  test("the error names the offending key and the supported set", () => {
    expect(() => whereSql({ status: { notEqual: "x" } })).toThrow(/notEqual/);
    expect(() => whereSql({ status: { notEqual: "x" } })).toThrow(/notIn/);
  });
});

describe("upload mime allowlist", () => {
  test("accepts types on the allowlist", () => {
    expect(isAllowedMimeType("image/png")).toBe(true);
    expect(isAllowedMimeType("IMAGE/PNG")).toBe(true);
    expect(isAllowedMimeType("text/csv; charset=utf-8")).toBe(true);
  });

  test("rejects a declared octet-stream instead of allowing it", () => {
    delete process.env.UPLOAD_ALLOW_UNKNOWN_MIME;
    expect(isAllowedMimeType("application/octet-stream")).toBe(false);
    expect(isAllowedMimeType("application/octet-stream; charset=x")).toBe(false);
  });

  test("rejects a missing or blank content type", () => {
    delete process.env.UPLOAD_ALLOW_UNKNOWN_MIME;
    expect(isAllowedMimeType("")).toBe(false);
    expect(isAllowedMimeType("   ")).toBe(false);
  });

  test("UPLOAD_ALLOW_UNKNOWN_MIME=true restores the permissive behaviour", () => {
    process.env.UPLOAD_ALLOW_UNKNOWN_MIME = "true";
    expect(isAllowedMimeType("application/octet-stream")).toBe(true);
    delete process.env.UPLOAD_ALLOW_UNKNOWN_MIME;
  });

  test("only the exact string true opts in", () => {
    for (const value of ["1", "yes", "TRUE", "on"]) {
      process.env.UPLOAD_ALLOW_UNKNOWN_MIME = value;
      expect(isAllowedMimeType("application/octet-stream")).toBe(false);
    }
    delete process.env.UPLOAD_ALLOW_UNKNOWN_MIME;
  });

  test("still rejects executable and markup types", () => {
    expect(isAllowedMimeType("text/html")).toBe(false);
    expect(isAllowedMimeType("application/x-httpd-php")).toBe(false);
  });
});

describe("mass assignment policy", () => {
  test("an undeclared model fails loudly instead of dropping every attribute", () => {
    expect(() => filterMassAssignable(undefined, undefined, { title: "x" })).toThrow(
      /Mass assignment is not configured/,
    );
  });

  test("the error explains both ways to opt in", () => {
    expect(() => filterMassAssignable(undefined, undefined, { title: "x" })).toThrow(/\$fillable/);
    expect(() => filterMassAssignable(undefined, undefined, { title: "x" })).toThrow(/\$guarded/);
  });

  test("an undeclared model with no attributes is still a no-op", () => {
    expect(filterMassAssignable(undefined, undefined, {})).toEqual({});
  });

  test("guarded [] allows everything, matching Laravel's default", () => {
    expect(filterMassAssignable(undefined, [], { a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
  });

  test("explicit guarded true still blocks everything without throwing", () => {
    expect(filterMassAssignable(undefined, true, { a: 1 })).toEqual({});
  });

  test("fillable and guarded keep their existing semantics", () => {
    expect(filterMassAssignable(["a"], undefined, { a: 1, b: 2 })).toEqual({ a: 1 });
    expect(filterMassAssignable(undefined, ["b"], { a: 1, b: 2 })).toEqual({ a: 1 });
    expect(filterMassAssignable(undefined, ["*"], { a: 1 })).toEqual({});
  });
});

describe("hashed cast", () => {
  test("hashes a plaintext value on write", () => {
    const stored = dehydrateValue("secret", "hashed") as string;

    expect(stored).not.toBe("secret");
    expect(stored.startsWith("$2")).toBe(true);
    expect(Bun.password.verifySync("secret", stored)).toBe(true);
  });

  test("does not re-hash a value that is already hashed", () => {
    const once = dehydrateValue("secret", "hashed") as string;
    expect(dehydrateValue(once, "hashed")).toBe(once);
  });

  test("leaves null and undefined alone", () => {
    expect(dehydrateValue(null, "hashed")).toBeNull();
    expect(dehydrateValue(undefined, "hashed")).toBeUndefined();
  });
});
