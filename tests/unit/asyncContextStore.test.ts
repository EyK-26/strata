import { describe, expect, test } from "bun:test";
import { createAsyncContextStore } from "@getstrata/core/runtime/asyncContextStore";

describe("createAsyncContextStore", () => {
  test("reuses the same AsyncLocalStorage instance for a key", () => {
    const first = createAsyncContextStore<string>("@getstrata/test-context");
    const second = createAsyncContextStore<string>("@getstrata/test-context");

    expect(second).toBe(first);
    expect(first.run("value", () => first.getStore())).toBe("value");
  });
});
