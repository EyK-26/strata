import assert from "node:assert/strict";
import { type MailDriver, Mailer, type MailMessage } from "@getstrata/core/mail/mailer";

export async function verifyMailDelegation() {
  const reason = new Error("owned provider failure");
  const signal = new AbortController().signal;
  const message: MailMessage = {
    to: "one@example.test",
    subject: "Příliš žluťoučký",
    body: "Plain",
    html: "<p>HTML</p>",
    signal,
  };
  let sent: MailMessage | undefined;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const driver: MailDriver = {
    send(value) {
      sent = value;
      return pending;
    },
  };
  assert.equal(new Mailer(driver).send(message), pending);
  assert.equal(sent, message);
  assert.equal(sent.signal, signal);
  release();
  await pending;
  await assert.rejects(
    new Mailer({
      async send() {
        throw reason;
      },
    }).send(message),
    (error) => error === reason,
  );
  assert.throws(
    () =>
      new Mailer({
        send() {
          throw reason;
        },
      }).send(message),
    (error) => error === reason,
  );
  return { mailDelegation: true, errorIdentity: true };
}

/** Owned test transport, not a provider SDK: production drivers own protocol and outcome policy. */
class FixtureHttpDriver implements MailDriver {
  constructor(
    private readonly endpoint: URL,
    private readonly idempotencyKey: string,
    private readonly timeoutMs = 200,
  ) {}
  async send(message: MailMessage) {
    const deadline = new AbortController();
    const timer = setTimeout(
      () => deadline.abort(new DOMException("Provider deadline", "TimeoutError")),
      this.timeoutMs,
    );
    const signal = message.signal
      ? AbortSignal.any([message.signal, deadline.signal])
      : deadline.signal;
    try {
      signal.throwIfAborted();
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": this.idempotencyKey },
        body: JSON.stringify({
          to: message.to,
          subject: message.subject,
          body: message.body,
          html: message.html,
        }),
        signal,
      });
      await response.text(); // The deadline also bounds response-body consumption.
      if (!response.ok) throw new Error(`Provider rejected: ${response.status}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function verifyHttpMailExtension() {
  const message = {
    to: "one@example.test",
    subject: "Příliš žluťoučký",
    body: "Plain",
    html: "<p>Žluťoučký</p>",
  };
  const received: { path: string; key: string | null; message: unknown }[] = [];
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      received.push({
        path,
        key: request.headers.get("idempotency-key"),
        message: await request.json(),
      });
      if (path === "/hold") {
        entered();
        await hold;
      }
      if (path === "/body")
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("pending"));
            },
          }),
        );
      return new Response("owned response", { status: path === "/reject" ? 503 : 202 });
    },
  });
  const mailer = (path: string, timeout = 200) =>
    new Mailer(new FixtureHttpDriver(new URL(path, server.url), "owned-attempt-1", timeout));
  try {
    await mailer("/accept").send(message);
    assert.deepEqual(received[0], { path: "/accept", key: "owned-attempt-1", message });
    await assert.rejects(mailer("/reject").send(message), /Provider rejected: 503/);
    assert.equal(received.length, 2, "failed provider calls are not silently retried");
    const cancelled = new AbortController(),
      reason = new Error("application cancelled");
    cancelled.abort(reason);
    await assert.rejects(
      mailer("/unused").send({ ...message, signal: cancelled.signal }),
      (error) => error === reason,
    );
    assert.equal(received.length, 2, "pre-cancelled attempt must not reach the provider");
    const active = new AbortController();
    const operation = mailer("/hold", 3000).send({ ...message, signal: active.signal });
    await started;
    active.abort(reason);
    await assert.rejects(operation, (error) => error === reason);
    await assert.rejects(
      mailer("/hold").send(message),
      (error) => error instanceof DOMException && error.name === "TimeoutError",
    );
    await assert.rejects(
      mailer("/body").send(message),
      (error) => error instanceof DOMException && error.name === "TimeoutError",
    );
    assert.equal(received.length, 5);
  } finally {
    release();
    await server.stop(true);
  }
  return {
    httpMailExtension: true,
    providerIdempotency: true,
    callerCancellation: true,
    wholeSendDeadline: true,
  };
}
