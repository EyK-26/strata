import { describe, expect, test } from "bun:test";
import { API_PREFIX } from "./client";

describe("api client", () => {
  test("uses /api/v1 prefix", () => {
    expect(API_PREFIX).toBe("/api/v1");
  });
});
