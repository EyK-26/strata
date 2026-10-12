import type { TLSOptions } from "bun";
import { smtpEhloHost } from "../runtime/appKeyPrefix";

interface MailMessage {
  to: string;
  subject: string;
  body: string;
  html?: string;
  signal?: AbortSignal;
}

interface MailDriver {
  send(message: MailMessage): Promise<void>;
}

interface SmtpConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  from: string;
  secure: boolean;
  timeoutMs?: number;
  tls?: Pick<TLSOptions, "ca" | "serverName">;
}

type SmtpTransport = (config: SmtpConfig, message: MailMessage) => Promise<void>;

function resolveSmtpConfig(): SmtpConfig {
  const host = process.env.MAIL_HOST?.trim();

  if (!host) {
    throw new Error('MAIL_DRIVER="smtp" requires MAIL_HOST to be set.');
  }

  const from = process.env.MAIL_FROM?.trim();

  if (!from) {
    throw new Error('MAIL_DRIVER="smtp" requires MAIL_FROM to be set.');
  }

  const port = Number(process.env.MAIL_PORT ?? "587");

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('Environment variable "MAIL_PORT" must be a positive integer.');
  }

  return {
    host,
    port,
    from,
    secure: (process.env.MAIL_SECURE ?? "false") === "true",
    ...(process.env.MAIL_TIMEOUT_MS !== undefined
      ? { timeoutMs: smtpTimeout(Number(process.env.MAIL_TIMEOUT_MS)) }
      : {}),
    ...(process.env.MAIL_USERNAME?.trim() ? { username: process.env.MAIL_USERNAME.trim() } : {}),
    ...(process.env.MAIL_PASSWORD?.trim() ? { password: process.env.MAIL_PASSWORD.trim() } : {}),
  };
}

const EMAIL_SHAPE = /^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/u;

function assertSafeSmtpField(value: string, field: string): string {
  if (/[\r\n]/u.test(value)) {
    throw new Error(`Mail ${field} must not contain CR or LF.`);
  }

  for (const character of value) {
    const code = character.charCodeAt(0);
    if ((code < 32 && code !== 9) || code === 127) {
      throw new Error(`Mail ${field} must not contain control characters.`);
    }
  }
  return value;
}

function smtpEnvelopeAddress(value: string, field: string): string {
  const trimmed = assertSafeSmtpField(value, field).trim();
  const address = trimmed.includes("<") ? (trimmed.match(/<([^>]+)>/u)?.[1] ?? trimmed) : trimmed;

  if (!EMAIL_SHAPE.test(address)) {
    throw new Error(`Mail ${field} must be a valid email address.`);
  }

  return address;
}

function assertSafeSmtpAddress(value: string, field: string): string {
  smtpEnvelopeAddress(value, field);
  return assertSafeSmtpField(value, field).trim();
}

function redactMailBody(body: string): string {
  return body
    .replace(/https?:\/\/[^\s]+/giu, "[redacted-url]")
    .replace(/[?&](token|signature|expires|code)=[^&\s]+/giu, "[redacted-query]");
}

function encodeBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function smtpTimeout(value = 10000): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) {
    throw new RangeError("SMTP timeoutMs must be a positive integer within the timer range.");
  }
  return value;
}

async function defaultSmtpTransport(config: SmtpConfig, message: MailMessage): Promise<void> {
  const timeoutMs = smtpTimeout(config.timeoutMs);
  if (
    !config.host.trim() ||
    !Number.isInteger(config.port) ||
    config.port < 1 ||
    config.port > 65535
  ) {
    throw new RangeError("SMTP requires a host and a port between 1 and 65535.");
  }
  if (Boolean(config.username) !== Boolean(config.password)) {
    throw new Error("SMTP authentication requires both username and password.");
  }
  if (config.username) assertSafeSmtpField(config.username, "username");
  if (config.password) assertSafeSmtpField(config.password, "password");
  const fromHeader = assertSafeSmtpAddress(config.from, "from");
  const toHeader = assertSafeSmtpAddress(message.to, "to");
  assertSafeSmtpField(message.subject, "subject");
  const fromEnvelope = smtpEnvelopeAddress(config.from, "from");
  const toEnvelope = smtpEnvelopeAddress(message.to, "to");
  if (/[^\x21-\x7e]/u.test(fromEnvelope + toEnvelope)) {
    throw new Error("Default SMTP transport requires ASCII envelopes; SMTPUTF8 is not negotiated.");
  }
  for (const address of [fromEnvelope, toEnvelope]) {
    const at = address.lastIndexOf("@");
    if (Buffer.byteLength(address) > 254 || Buffer.byteLength(address.slice(0, at)) > 64) {
      throw new RangeError("SMTP envelope address exceeds the path/local-part length limit.");
    }
  }
  message.signal?.throwIfAborted();

  let socket: import("bun").Socket<undefined> | undefined;
  let finished = false;
  let failed = false;
  let failure: unknown;
  let rejectFailure!: (reason: unknown) => void;
  const failurePromise = new Promise<never>((_, reject) => {
    rejectFailure = reject;
  });
  // A socket may close while no operation is awaiting it; keep rejection observed.
  void failurePromise.catch(() => {});
  const responses: string[] = [];
  const waiters: ((response: string) => void)[] = [];
  let drain: (() => void) | undefined;
  let drainVersion = 0;
  let buffer = "";
  let multilineCode: string | undefined;
  let multilineLines = 0;
  const decoder = new TextDecoder();
  const fail = (reason: unknown) => {
    if (finished || failed) return;
    failed = true;
    failure = reason;
    rejectFailure(reason);
    waiters.length = 0;
    drain?.();
    drain = undefined;
    socket?.terminate();
  };
  const onAbort = () =>
    fail(message.signal?.reason ?? new DOMException("Mail send aborted.", "AbortError"));
  const timer = setTimeout(
    () => fail(new DOMException("SMTP send deadline exceeded.", "TimeoutError")),
    timeoutMs,
  );
  message.signal?.addEventListener("abort", onAbort, { once: true });
  if (message.signal?.aborted) onAbort();
  const readResponse = async (expected: string[]) => {
    // A complete reply received before EOF remains readable, including final DATA acceptance.
    const queued = responses.shift();
    const response =
      queued ??
      (await Promise.race([
        failed ? Promise.reject(failure) : new Promise<string>((resolve) => waiters.push(resolve)),
        failurePromise,
      ]));
    const code = response.slice(0, 3);
    if (!expected.includes(code)) throw new Error(`Unexpected SMTP response code: ${code}`);
  };
  const write = async (text: string) => {
    const bytes = Buffer.from(text, "utf8");
    let offset = 0;
    while (offset < bytes.length) {
      if (failed) throw failure;
      const version = drainVersion;
      if (!socket) throw new Error("SMTP socket is not connected.");
      const written = socket.write(bytes.subarray(offset));
      if (written < 0) throw new Error("SMTP socket write failed.");
      offset += written;
      if (offset < bytes.length && version === drainVersion) {
        await Promise.race([
          new Promise<void>((resolve) => {
            drain = resolve;
          }),
          failurePromise,
        ]);
      }
    }
  };
  try {
    const connecting = Bun.connect<undefined>({
      hostname: config.host,
      port: config.port,
      ...(config.secure
        ? {
            tls: {
              ...config.tls,
              serverName: config.tls?.serverName ?? config.host,
              rejectUnauthorized: true,
            },
          }
        : {}),
      socket: {
        open(value) {
          socket = value;
          if (failed || finished) value.terminate();
        },
        data(_socket, chunk) {
          if (failed || finished) return;
          buffer += decoder.decode(chunk, { stream: true });
          if (Buffer.byteLength(buffer, "utf8") > 16384) {
            fail(new Error("SMTP response exceeded the buffer limit."));
            return;
          }
          while (buffer.includes("\r\n")) {
            const index = buffer.indexOf("\r\n");
            const line = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            const match = /^([2-5]\d{2})([- ]|$)/.exec(line);
            if (!match || (multilineCode !== undefined && match[1] !== multilineCode)) {
              fail(new Error("Malformed SMTP reply."));
              return;
            }
            if (++multilineLines > 128) {
              fail(new Error("SMTP reply exceeded the line limit."));
              return;
            }
            if (match[2] === "-") {
              multilineCode = match[1];
              continue;
            }
            multilineCode = undefined;
            multilineLines = 0;
            const waiter = waiters.shift();
            if (waiter) waiter(line);
            else {
              responses.push(line);
              if (responses.length > 32) {
                fail(new Error("Too many buffered SMTP replies."));
                return;
              }
            }
          }
        },
        drain() {
          drainVersion++;
          const waiting = drain;
          drain = undefined;
          waiting?.();
        },
        end() {
          fail(new Error("SMTP peer closed before the send completed."));
        },
        close() {
          fail(new Error("SMTP connection closed before the send completed."));
        },
        error() {
          fail(new Error("SMTP socket failed."));
        },
        connectError() {
          fail(new Error("SMTP connection failed."));
        },
        handshake(_socket, success) {
          if (!success) fail(new Error("SMTP TLS verification failed."));
        },
      },
    });
    // Connect may settle after cancellation; never leave its late socket open.
    void connecting.then(
      (value) => {
        socket = value;
        if (failed || finished) value.terminate();
      },
      () => {},
    );
    socket = await Promise.race([connecting, failurePromise]);
    await readResponse(["220"]);
    await write(`EHLO ${smtpEhloHost()}\r\n`);
    await readResponse(["250"]);
    if (config.username && config.password) {
      await write("AUTH LOGIN\r\n");
      await readResponse(["334"]);
      await write(`${encodeBase64(config.username)}\r\n`);
      await readResponse(["334"]);
      await write(`${encodeBase64(config.password)}\r\n`);
      await readResponse(["235"]);
    }
    await write(`MAIL FROM:<${fromEnvelope}>\r\n`);
    await readResponse(["250"]);
    await write(`RCPT TO:<${toEnvelope}>\r\n`);
    await readResponse(["250", "251"]);
    await write("DATA\r\n");
    await readResponse(["354"]);
    await write(buildSmtpPayload(fromHeader, { ...message, to: toHeader }));
    await readResponse(["250"]);
    // Final DATA 250 is known acceptance. QUIT failure must not turn it into a retry.
    finished = true;
    try {
      socket.write("QUIT\r\n");
    } catch {
      /* best-effort session cleanup */
    }
  } finally {
    finished = true;
    clearTimeout(timer);
    message.signal?.removeEventListener("abort", onAbort);
    waiters.length = 0;
    responses.length = 0;
    drain = undefined;
    socket?.end();
  }
}

function encodeSmtpHeader(value: string): string {
  if (/^[\x20-\x7e]{0,60}$/u.test(value)) return value;
  const words: string[] = [];
  let part = "";
  // Encoded words stay <=75 bytes and never split a UTF-8 code point.
  for (const character of value) {
    if (Buffer.byteLength(part + character, "utf8") > 45) {
      words.push(`=?UTF-8?B?${encodeBase64(part)}?=`);
      part = "";
    }
    part += character;
  }
  if (part) words.push(`=?UTF-8?B?${encodeBase64(part)}?=`);
  return words.join("\r\n ");
}

function smtpAddressHeader(value: string): string {
  if (!value.includes("<")) return value;
  const name = value.slice(0, value.lastIndexOf("<")).trim();
  const address = smtpEnvelopeAddress(value, "address");
  if (!name) return address;
  const encoded = encodeSmtpHeader(name);
  const display = encoded.startsWith("=?UTF-8?B?")
    ? encoded
    : `"${encoded.replace(/[\\"]/gu, "\\$&")}"`;
  return `${display} <${address}>`;
}

function smtpMimePart(type: "text/plain" | "text/html", value: string): string[] {
  const normalized = value.replace(/\r\n|\r|\n/gu, "\r\n");
  const base64 =
    /[^\t\r\n\x20-\x7e]/u.test(normalized) ||
    normalized.split("\r\n").some((line) => line.length > 998);
  return [
    `Content-Type: ${type}; charset=utf-8`,
    `Content-Transfer-Encoding: ${base64 ? "base64" : "7bit"}`,
    "",
    base64 ? (encodeBase64(normalized).match(/.{1,76}/gu) ?? []).join("\r\n") : normalized,
  ];
}

function buildSmtpPayload(from: string, message: MailMessage): string {
  const headers = [
    `From: ${smtpAddressHeader(assertSafeSmtpAddress(from, "from"))}`,
    `To: ${smtpAddressHeader(assertSafeSmtpAddress(message.to, "to"))}`,
    `Subject: ${encodeSmtpHeader(assertSafeSmtpField(message.subject, "subject"))}`,
    "MIME-Version: 1.0",
  ];
  let lines: string[];
  if (message.html) {
    let boundary: string;
    do {
      boundary = `strata-${crypto.randomUUID()}`;
    } while (message.body.includes(boundary) || message.html.includes(boundary));
    lines = [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      ...smtpMimePart("text/plain", message.body),
      `--${boundary}`,
      ...smtpMimePart("text/html", message.html),
      `--${boundary}--`,
      "",
    ];
  } else lines = [...headers, ...smtpMimePart("text/plain", message.body)];
  // Canonical CRLF plus SMTP transparency before the sole DATA terminator.
  const content = lines.join("\r\n").replace(/(^|\r\n)\./gu, "$1..");
  return `${content}${content.endsWith("\r\n") ? "" : "\r\n"}.\r\n`;
}

class LogMailDriver implements MailDriver {
  async send(message: MailMessage): Promise<void> {
    console.log(
      JSON.stringify({
        level: "info",
        channel: "mail",
        to: message.to,
        subject: message.subject,
        body: redactMailBody(message.body),
        ...(message.html ? { htmlBytes: Buffer.byteLength(message.html, "utf8") } : {}),
      }),
    );
  }
}

class SmtpMailDriver implements MailDriver {
  constructor(
    private readonly config: SmtpConfig,
    private readonly transport: SmtpTransport = defaultSmtpTransport,
  ) {}

  send(message: MailMessage): Promise<void> {
    return this.transport(this.config, message);
  }
}

class Mailer {
  constructor(private readonly driver: MailDriver) {}

  send(message: MailMessage): Promise<void> {
    assertSafeSmtpAddress(message.to, "to");
    assertSafeSmtpField(message.subject, "subject");
    return this.driver.send(message);
  }
}

function createMailDriver(): MailDriver {
  const driver = process.env.MAIL_DRIVER ?? "log";

  if (driver === "smtp") {
    return new SmtpMailDriver(resolveSmtpConfig());
  }

  return new LogMailDriver();
}

const appMailer = new Mailer(createMailDriver());

function mailer(): Mailer {
  return appMailer;
}

export type { MailDriver, MailMessage, SmtpConfig, SmtpTransport };
export {
  assertSafeSmtpAddress,
  assertSafeSmtpField,
  buildSmtpPayload,
  createMailDriver,
  defaultSmtpTransport,
  LogMailDriver,
  Mailer,
  mailer,
  redactMailBody,
  resolveSmtpConfig,
  SmtpMailDriver,
  smtpEnvelopeAddress,
};
