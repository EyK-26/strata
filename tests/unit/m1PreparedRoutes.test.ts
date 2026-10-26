import { expect, test } from "bun:test";
import {
  defineApplicationRoutes,
  validateGuardedRoutes,
} from "../../src/bootstrap/m1/guardedRoutes";

test("prepared route maps retain their compiled callback identity at collection", () => {
  let calls = 0;
  const prepared = defineApplicationRoutes()({
    "/prepared": () => {
      calls++;
      return new Response();
    },
  });
  expect(validateGuardedRoutes(prepared, "api:prepared")).toBe(prepared);
  expect(validateGuardedRoutes(prepared, "web:prepared")).toBe(prepared);
  expect(calls).toBe(0);
  expect(Object.isFrozen(prepared)).toBe(true);
  expect(Object.getOwnPropertySymbols(prepared)).toEqual([]);
});
test("prepared Response state is rechecked without recompiling its declarations", async () => {
  const response = new Response("owned");
  const prepared = defineApplicationRoutes()({ "/response": response });
  await response.text();
  expect(() => validateGuardedRoutes(prepared, "api:prepared")).toThrow("consumed-response");
});
test("a locked static Response is rejected before it can fail cloning during dispatch", async () => {
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    }),
  );
  const reader = response.body?.getReader();
  try {
    expect(() => validateGuardedRoutes({ "/locked": response }, "fixture")).toThrow(
      "uncloneable-response",
    );
  } finally {
    reader?.releaseLock();
  }
});
