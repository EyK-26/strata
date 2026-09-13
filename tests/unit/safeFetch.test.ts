import { afterEach, describe, expect, mock, test } from "bun:test";
import { BadRequestError } from "@getstrata/core/errors/http";
import { DEFAULT_FETCH_TIMEOUT_MS, safeFetch } from "@getstrata/core/security/safeFetch";
import { resetDnsLookupForTests, setDnsLookupForTests } from "@getstrata/core/security/safeUrl";

const originalFetch = globalThis.fetch;

function mockPublicDns(address = "1.1.1.1") {
  setDnsLookupForTests(async () => [{ address, family: 4 }]);
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetDnsLookupForTests();
});

describe("safeFetch", () => {
  test("returns a successful response", async () => {
    mockPublicDns();
    let fetched = "";
    let host = "";
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      fetched = String(input);
      host = new Headers(init?.headers).get("host") ?? "";
      return Promise.resolve(new Response("ok", { status: 200 }));
    }) as unknown as typeof fetch;

    const response = await safeFetch("https://example.com/hook");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(fetched).toBe("https://1.1.1.1/hook");
    expect(host).toBe("example.com");
  });

  test("follows redirects up to maxRedirects", async () => {
    mockPublicDns();
    let callCount = 0;

    globalThis.fetch = mock((input: string | URL | Request) => {
      callCount += 1;
      const url = new URL(String(input));

      if (url.pathname === "/start") {
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
    mockPublicDns();
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 302 })),
    ) as unknown as typeof fetch;

    const response = await safeFetch("https://example.com/start", {}, { maxRedirects: 1 });

    expect(response.status).toBe(302);
  });

  test("returns redirect response when maxRedirects is exceeded", async () => {
    mockPublicDns();
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

  test("resolves relative redirect locations against the original host", async () => {
    mockPublicDns();
    let secondUrl = "";

    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = new URL(String(input));

      if (url.pathname.endsWith("/start")) {
        return Promise.resolve(
          new Response(null, {
            status: 301,
            headers: { location: "/next" },
          }),
        );
      }

      secondUrl = String(input);
      return Promise.resolve(new Response("ok", { status: 200 }));
    }) as unknown as typeof fetch;

    await safeFetch("https://example.com/start", {}, { maxRedirects: 1 });

    expect(secondUrl).toBe("https://1.1.1.1/next");
  });

  test("aborts when the timeout elapses", async () => {
    mockPublicDns();
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
    mockPublicDns();
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = new URL(String(input));

      if (url.pathname === "/start") {
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
    mockPublicDns();
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = new URL(String(input));

      if (url.pathname.endsWith("/start")) {
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
