import { expect, spyOn, test } from "bun:test";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import { composeMiddleware, requestIdMiddleware } from "@getstrata/core/http/middleware";
import { currentRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { createRequestLoggingMiddleware } from "@getstrata/core/logging/requestLoggingMiddleware";
import { createMockDependencies } from "./testHelpers";

test("logging and response share canonical identity in either middleware order, including concurrent requests", async () => {
  const output = spyOn(console, "log").mockImplementation(() => {});
  try {
    for (const loggingFirst of [true, false]) {
      const logging = createRequestLoggingMiddleware();
      const handler = composeMiddleware(
        ...(loggingFirst ? [logging, requestIdMiddleware] : [requestIdMiddleware, logging]),
      )(async () => {
        await Promise.resolve();
        return Response.json({ requestId: currentRequestMeta().requestId }, { status: 401 });
      });
      for (const supplied of [undefined, "owned-correlation"]) {
        const response = await handler(
          new Request("http://local.test/account", {
            headers: supplied ? { "x-request-id": supplied } : {},
          }),
        );
        const id = response.headers.get("x-request-id");
        expect(id).toBeTruthy();
        if (!id) throw new Error("Missing response correlation ID");
        if (supplied) expect(id).toBe(supplied);
        expect(((await response.json()) as { requestId: string }).requestId).toBe(id);
        const last = output.mock.calls.at(-1)?.[0];
        expect(JSON.parse(String(last)).requestId).toBe(id);
      }
      const responses = await Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          handler(new Request(`http://local.test/concurrent/${i}`)),
        ),
      );
      const ids = responses.map((response) => response.headers.get("x-request-id"));
      expect(new Set(ids).size).toBe(4);
      const logs = output.mock.calls.slice(-4).map((call) => JSON.parse(String(call[0])).requestId);
      expect(new Set(logs)).toEqual(new Set(ids));
    }
  } finally {
    output.mockRestore();
  }
});

test("public document policies do not require auth, membership or tenant services", async () => {
  const output = spyOn(console, "log").mockImplementation(() => {});
  const kernel = new HttpKernel(createMockDependencies(new ServiceContainer()));
  try {
    const handler = kernel.wrapPublicDocument(
      async () => new Response("shell", { headers: { "content-type": "text/html" } }),
    );
    const response = await handler(new Request("http://local.test/console/orders"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toBeTruthy();
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-request-id")).toBeTruthy();
    const logs = output.mock.calls
      .map((call) => JSON.parse(String(call[0])))
      .filter((row) => row.message === "HTTP request completed");
    expect(logs).toHaveLength(1);
    expect(logs[0]?.requestId).toBe(response.headers.get("x-request-id"));
  } finally {
    kernel.dispose();
    output.mockRestore();
  }
});
