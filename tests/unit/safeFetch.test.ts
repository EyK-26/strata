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

describe("safeFetch lifecycle", () => {
  test("rejects an already aborted caller before DNS or fetch", async () => {
    const dns = mock(async () => [{ address: "1.1.1.1", family: 4 }]);
    const fetchMock = mock(() => Promise.resolve(new Response("unused")));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    setDnsLookupForTests(dns);
    const reason = new Error("caller canceled");
    await expect(
      safeFetch("https://example.com", { signal: AbortSignal.abort(reason) }),
    ).rejects.toBe(reason);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dns).not.toHaveBeenCalled();
  });

  test("bounds DNS resolution and never starts a late fetch", async () => {
    let finishDns: ((value: Array<{ address: string; family: number }>) => void) | undefined;
    setDnsLookupForTests(
      () =>
        new Promise((resolve) => {
          finishDns = resolve;
        }),
    );
    const fetchMock = mock(() => Promise.resolve(new Response("unused")));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(safeFetch("https://example.com", {}, { timeoutMs: 15 })).rejects.toMatchObject({
      name: "TimeoutError",
    });
    finishDns?.([{ address: "1.1.1.1", family: 4 }]);
    await Bun.sleep(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("forwards caller cancellation during fetch with its reason", async () => {
    mockPublicDns();
    globalThis.fetch = mock(() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const caller = new AbortController();
    const pending = safeFetch("https://example.com", { signal: caller.signal });
    const reason = new Error("request ended");
    caller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  test("times out a stalled body and cancels the underlying stream", async () => {
    mockPublicDns();
    const cancel = mock(() => {});
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(new ReadableStream({ cancel }))),
    ) as unknown as typeof fetch;
    const response = await safeFetch("https://example.com", {}, { timeoutMs: 15 });
    await expect(response.text()).rejects.toMatchObject({ name: "TimeoutError" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  test("releases unread response bodies on deadline", async () => {
    mockPublicDns();
    const cancel = mock(() => {});
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(new ReadableStream({ cancel }))),
    ) as unknown as typeof fetch;
    const response = await safeFetch("https://example.com", {}, { timeoutMs: 15 });
    await Bun.sleep(30);
    expect(cancel).toHaveBeenCalledTimes(1);
    await expect(response.text()).rejects.toMatchObject({ name: "TimeoutError" });
  });

  test("preserves streaming and aborts the body after headers", async () => {
    mockPublicDns();
    const cancel = mock(() => {});
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("first"));
            },
            cancel,
          }),
        ),
      ),
    ) as unknown as typeof fetch;
    const caller = new AbortController();
    const response = await safeFetch("https://example.com", { signal: caller.signal });
    const body = response.body;
    if (!body) throw new Error("Expected response body.");
    const reader = body.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("first");
    const pending = reader.read();
    const reason = new Error("caller ended streaming");
    caller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  test("consumer cancellation releases the caller listener and timeout", async () => {
    mockPublicDns();
    const cancel = mock(() => {});
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(new ReadableStream({ cancel }))),
    ) as unknown as typeof fetch;
    const caller = new AbortController();
    const remove = mock(caller.signal.removeEventListener.bind(caller.signal));
    caller.signal.removeEventListener = remove;
    const response = await safeFetch(
      "https://example.com",
      { signal: caller.signal },
      { timeoutMs: 15 },
    );
    await response.body?.cancel("consumer finished");
    await Bun.sleep(30);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith("consumer finished");
    expect(remove).toHaveBeenCalledTimes(1);
  });

  test("preserves metadata and clone semantics and releases after EOF", async () => {
    mockPublicDns();
    const original = new Response("hello", {
      status: 201,
      statusText: "Created",
      headers: { "x-fixture": "ok" },
    });
    Object.defineProperties(original, {
      url: { value: "https://example.com/final" },
      redirected: { value: true },
      type: { value: "basic" },
    });
    globalThis.fetch = mock(() => Promise.resolve(original)) as unknown as typeof fetch;
    const caller = new AbortController();
    const remove = mock(caller.signal.removeEventListener.bind(caller.signal));
    caller.signal.removeEventListener = remove;
    const response = await safeFetch("https://example.com", { signal: caller.signal });
    const clone = response.clone();
    expect(clone.url).toBe(original.url);
    expect(clone.redirected).toBe(true);
    expect(clone.type).toBe("basic");
    expect(response.status).toBe(201);
    expect(response.statusText).toBe("Created");
    expect(response.headers.get("x-fixture")).toBe("ok");
    expect(await response.text()).toBe("hello");
    expect(await clone.text()).toBe("hello");
    expect(remove).toHaveBeenCalledTimes(1);
    caller.abort();
    expect(response.bodyUsed).toBe(true);
  });

  test("releases deadlines for responses without a body", async () => {
    mockPublicDns();
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    ) as unknown as typeof fetch;
    const response = await safeFetch("https://example.com", {}, { timeoutMs: 15 });
    await Bun.sleep(30);
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });

  test("cancels intermediate bodies and keeps one redirect deadline", async () => {
    mockPublicDns();
    const cancel = mock(() => {});
    let calls = 0;
    globalThis.fetch = mock(() => {
      calls++;
      return Promise.resolve(
        calls === 1
          ? new Response(new ReadableStream({ cancel }), {
              status: 302,
              headers: { location: "/slow" },
            })
          : new Response(new ReadableStream()),
      );
    }) as unknown as typeof fetch;
    const response = await safeFetch(
      "https://example.com/start",
      {},
      { maxRedirects: 1, timeoutMs: 15 },
    );
    expect(cancel).toHaveBeenCalledTimes(1);
    await expect(response.json()).rejects.toMatchObject({ name: "TimeoutError" });
  });

  test("propagates body failures without waiting for a deadline", async () => {
    mockPublicDns();
    const failure = new Error("body failed");
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(failure);
            },
          }),
        ),
      ),
    ) as unknown as typeof fetch;
    const response = await safeFetch("https://example.com");
    await expect(response.arrayBuffer()).rejects.toBe(failure);
  });

  test("rejects invalid deadlines", async () => {
    for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(safeFetch("https://example.com", {}, { timeoutMs })).rejects.toBeInstanceOf(
        RangeError,
      );
    }
  });

  test("real Bun transport cancels a stalled body after receiving headers", async () => {
    globalThis.fetch = originalFetch;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"pending":'));
            },
          }),
        );
      },
    });
    try {
      const response = await safeFetch(
        `http://127.0.0.1:${server.port}/`,
        {},
        { allowPrivate: true, allowHttp: true, resolveDns: false, timeoutMs: 40 },
      );
      await expect(response.json()).rejects.toMatchObject({ name: "TimeoutError" });
    } finally {
      await server.stop(true);
    }
  });
});
