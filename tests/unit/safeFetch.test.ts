import { afterEach, describe, expect, mock, test } from "bun:test";
import { BadRequestError } from "@getstrata/core/errors/http";
import { DEFAULT_FETCH_TIMEOUT_MS, safeFetch } from "../../src/core/security/safeFetch";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("safeFetch", () => {
  test("returns a successful response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("ok", { status: 200 })),
    ) as unknown as typeof fetch;

    const response = await safeFetch("https://example.com/hook");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  test("follows redirects up to maxRedirects", async () => {
    let callCount = 0;

    globalThis.fetch = mock((input: string | URL | Request) => {
      callCount += 1;
      const url = String(input);

      if (url === "https://example.com/start") {
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "https://example.com/final" },
          }),
        );
      }

      return Promise.resolve(new Response("done", { status: 200 }));
    }) as unknown as typeof fetch;

    const response = await safeFetch("https://example.com/start", {}, { maxRedirects: 1 });

    expect(callCount).toBe(2);
    expect(response.status).toBe(200);
  });

  test("returns redirect response when location header is missing", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 302 })),
    ) as unknown as typeof fetch;

    const response = await safeFetch("https://example.com/start", {}, { maxRedirects: 1 });

    expect(response.status).toBe(302);
  });

  test("returns redirect response when maxRedirects is exceeded", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: "https://example.com/loop" },
        }),
      ),
    ) as unknown as typeof fetch;

    const response = await safeFetch("https://example.com/start", {}, { maxRedirects: 0 });

    expect(response.status).toBe(302);
  });

  test("resolves relative redirect locations against the current url", async () => {
    let secondUrl = "";

    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = String(input);

      if (url.endsWith("/start")) {
        return Promise.resolve(
          new Response(null, {
            status: 301,
            headers: { location: "/next" },
          }),
        );
      }

      secondUrl = url;
      return Promise.resolve(new Response("ok", { status: 200 }));
    }) as unknown as typeof fetch;

    await safeFetch("https://example.com/start", {}, { maxRedirects: 1 });

    expect(secondUrl).toBe("https://example.com/next");
  });

  test("aborts when the timeout elapses", async () => {
    globalThis.fetch = mock(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;

          if (signal) {
            signal.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }
        }),
    ) as unknown as typeof fetch;

    await expect(safeFetch("https://example.com/slow", {}, { timeoutMs: 25 })).rejects.toThrow();
  });

  test("exports the default timeout constant", () => {
    expect(DEFAULT_FETCH_TIMEOUT_MS).toBe(10_000);
  });

  test("rejects blocked initial URLs", async () => {
    await expect(safeFetch("https://127.0.0.1/hook")).rejects.toBeInstanceOf(BadRequestError);
  });

  test("rejects redirects to blocked hosts", async () => {
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = String(input);

      if (url === "https://example.com/start") {
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "https://169.254.169.254/latest/meta-data" },
          }),
        );
      }

      return Promise.resolve(new Response("ok", { status: 200 }));
    }) as unknown as typeof fetch;

    await expect(safeFetch("https://example.com/start", {}, { maxRedirects: 1 })).rejects.toThrow(
      /blocked host/,
    );
  });

  test("rejects relative redirects to blocked hosts", async () => {
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = String(input);

      if (url.endsWith("/start")) {
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "//127.0.0.1/private" },
          }),
        );
      }

      return Promise.resolve(new Response("ok", { status: 200 }));
    }) as unknown as typeof fetch;

    await expect(safeFetch("https://example.com/start", {}, { maxRedirects: 1 })).rejects.toThrow(
      /blocked host/,
    );
  });
});
