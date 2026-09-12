import { smtpEhloHost } from "../runtime/appKeyPrefix";

interface MailMessage {
  to: string;
  subject: string;
  body: string;
  html?: string;
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
}

type SmtpTransport = (config: SmtpConfig, message: MailMessage) => Promise<void>;

interface SmtpSocket {
  write: (data: string | ArrayBuffer | Uint8Array) => number | Promise<number>;
  end: () => void;
}

function resolveSmtpConfig(): SmtpConfig {
  const host = process.env.MAIL_HOST?.trim();

  if (!host) {
    throw new Error('MAIL_DRIVER="smtp" requires MAIL_HOST to be set.');
  }

  const from = process.env.MAIL_FROM?.trim();

  if (!from) {
    throw new Error('MAIL_DRIVER="smtp" requires MAIL_FROM to be set.');
  }

  const port = Number.parseInt(process.env.MAIL_PORT ?? "587", 10);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('Environment variable "MAIL_PORT" must be a positive integer.');
  }

  return {
    host,
    port,
    from,
    secure: (process.env.MAIL_SECURE ?? "false") === "true",
    ...(process.env.MAIL_USERNAME?.trim() ? { username: process.env.MAIL_USERNAME.trim() } : {}),
    ...(process.env.MAIL_PASSWORD?.trim() ? { password: process.env.MAIL_PASSWORD.trim() } : {}),
  };
}

const EMAIL_SHAPE = /^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/u;

function assertSafeSmtpField(value: string, field: string): string {
  if (/[\r\n]/u.test(value)) {
    throw new Error(`Mail ${field} must not contain CR or LF.`);
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

function parseSmtpResponses(buffer: string): { responses: string[]; remainder: string } {
  const responses: string[] = [];
  let remainder = buffer;

  while (remainder.includes("\r\n")) {
    const index = remainder.indexOf("\r\n");
    const line = remainder.slice(0, index);
    remainder = remainder.slice(index + 2);

    if (line.length >= 4 && line[3] === "-") {
      continue;
    }

    responses.push(line);
  }

  return { responses, remainder };
}

async function waitForSmtpResponse(
  readResponse: () => Promise<string>,
  expectedCodes: string[],
): Promise<string> {
  const response = await readResponse();
  const code = response.slice(0, 3);

  if (!expectedCodes.includes(code)) {
    throw new Error(`Unexpected SMTP response: ${response}`);
  }

  return response;
}

async function openSmtpConnection(config: SmtpConfig): Promise<{
  socket: SmtpSocket;
  readResponse: () => Promise<string>;
}> {
  let buffer = "";
  const waiters: Array<{ resolve: (value: string) => void; reject: (error: Error) => void }> = [];

  const readResponse = (): Promise<string> =>
    new Promise((resolve, reject) => {
      const parsed = parseSmtpResponses(buffer);

      if (parsed.responses.length > 0) {
        buffer = parsed.remainder;
        resolve(parsed.responses.shift() as string);
        return;
      }

      waiters.push({ resolve, reject });
    });

  const socket = await Bun.connect({
    hostname: config.host,
    port: config.port,
    socket: {
      open() {},
      data(_socket, chunk) {
        buffer += Buffer.from(chunk).toString("utf8");
        const parsed = parseSmtpResponses(buffer);
        buffer = parsed.remainder;

        while (parsed.responses.length > 0 && waiters.length > 0) {
          const response = parsed.responses.shift() as string;
          waiters.shift()?.resolve(response);
        }
      },
      error(_socket, error) {
        const pending = waiters.splice(0);

        for (const waiter of pending) {
          waiter.reject(error instanceof Error ? error : new Error(String(error)));
        }
      },
    },
  });

  return { socket, readResponse };
}

async function defaultSmtpTransport(config: SmtpConfig, message: MailMessage): Promise<void> {
  const { socket, readResponse } = await openSmtpConnection(config);

  try {
    await waitForSmtpResponse(readResponse, ["220"]);
    await socket.write(`EHLO ${smtpEhloHost()}\r\n`);
    await waitForSmtpResponse(readResponse, ["250"]);

    if (config.username && config.password) {
      await socket.write("AUTH LOGIN\r\n");
      await waitForSmtpResponse(readResponse, ["334"]);
      await socket.write(`${encodeBase64(config.username)}\r\n`);
      await waitForSmtpResponse(readResponse, ["334"]);
      await socket.write(`${encodeBase64(config.password)}\r\n`);
      await waitForSmtpResponse(readResponse, ["235"]);
    }

    const fromHeader = assertSafeSmtpAddress(config.from, "from");
    const toHeader = assertSafeSmtpAddress(message.to, "to");
    const from = smtpEnvelopeAddress(config.from, "from");
    const to = smtpEnvelopeAddress(message.to, "to");
    await socket.write(`MAIL FROM:<${from}>\r\n`);
    await waitForSmtpResponse(readResponse, ["250"]);
    await socket.write(`RCPT TO:<${to}>\r\n`);
    await waitForSmtpResponse(readResponse, ["250", "251"]);
    await socket.write("DATA\r\n");
    await waitForSmtpResponse(readResponse, ["354"]);

    const payload = buildSmtpPayload(fromHeader, {
      ...message,
      to: toHeader,
      subject: assertSafeSmtpField(message.subject, "subject"),
    });

    await socket.write(payload);
    await waitForSmtpResponse(readResponse, ["250"]);
    await socket.write("QUIT\r\n");
    await waitForSmtpResponse(readResponse, ["221"]);
  } finally {
    socket.end();
  }
}

function buildSmtpPayload(from: string, message: MailMessage): string {
  const safeFrom = assertSafeSmtpAddress(from, "from");
  const safeTo = assertSafeSmtpAddress(message.to, "to");
  const safeSubject = assertSafeSmtpField(message.subject, "subject");
  const headers = [
    `From: ${safeFrom}`,
    `To: ${safeTo}`,
    `Subject: ${safeSubject}`,
    "MIME-Version: 1.0",
  ];

  if (message.html) {
    const boundary = `strata-${Date.now().toString(36)}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    const parts = [
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      message.body,
      `--${boundary}`,
      "Content-Type: text/html; charset=utf-8",
      "",
      message.html,
      `--${boundary}--`,
      "",
    ];
    return [...headers, "", ...parts, ".", ""].join("\r\n");
  }

  headers.push("Content-Type: text/plain; charset=utf-8");
  return [...headers, "", message.body, ".", ""].join("\r\n");
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
  LogMailDriver,
  Mailer,
  mailer,
  redactMailBody,
  resolveSmtpConfig,
  SmtpMailDriver,
  smtpEnvelopeAddress,
};
