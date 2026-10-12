import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SmtpConfig } from "@getstrata/core/mail/mailer";
import { defaultSmtpTransport } from "@getstrata/core/mail/mailer";
import type { Socket, TLSOptions } from "bun";

type Mode =
  | "normal"
  | "close-greeting"
  | "close-ehlo"
  | "close-data"
  | "silent-greeting"
  | "silent-data"
  | "accepted-close"
  | "accepted-quit-stall"
  | "reject"
  | "oversized"
  | "malformed";
function fixture(mode: Mode, tls?: TLSOptions) {
  const sockets = new Set<Socket<{ buffer: string; data: boolean; auth: number }>>();
  const messages: string[] = [];
  const commands: string[] = [];
  const server = Bun.listen<{ buffer: string; data: boolean; auth: number }>({
    hostname: "127.0.0.1",
    port: 0,
    ...(tls ? { tls } : {}),
    socket: {
      open(socket) {
        socket.data = { buffer: "", data: false, auth: 0 };
        sockets.add(socket);
        if (mode === "close-greeting") {
          socket.end();
          return;
        }
        if (mode === "silent-greeting") return;
        socket.write("220 fixture ready\r\n");
      },
      close(socket) {
        sockets.delete(socket);
      },
      error() {},
      data(socket, bytes) {
        socket.data.buffer += bytes.toString();
        if (socket.data.data) {
          const end = socket.data.buffer.indexOf("\r\n.\r\n");
          if (end < 0) return;
          messages.push(socket.data.buffer.slice(0, end));
          socket.data.buffer = socket.data.buffer.slice(end + 5);
          socket.data.data = false;
          if (mode === "close-data") {
            socket.end();
            return;
          }
          if (mode === "silent-data") return;
          if (mode === "accepted-close") {
            socket.end("250 accepted\r\n");
            return;
          }
          socket.write("250 accepted\r\n");
        }
        while (socket.data.buffer.includes("\r\n")) {
          const end = socket.data.buffer.indexOf("\r\n");
          const line = socket.data.buffer.slice(0, end);
          socket.data.buffer = socket.data.buffer.slice(end + 2);
          commands.push(line);
          if (line.startsWith("EHLO")) {
            if (mode === "close-ehlo") {
              socket.end();
              return;
            }
            if (mode === "oversized") {
              socket.write(`250-${"x".repeat(17000)}`);
              return;
            }
            if (mode === "malformed") {
              socket.write("250-first\r\n550 mismatched\r\n");
              return;
            }
            socket.write("250-fixture\r\n250 AUTH LOGIN\r\n");
          } else if (line === "AUTH LOGIN") {
            socket.data.auth = 1;
            socket.write("334 username\r\n");
          } else if (socket.data.auth === 1) {
            socket.data.auth = 2;
            socket.write("334 password\r\n");
          } else if (socket.data.auth === 2) {
            socket.data.auth = 0;
            socket.write("235 authenticated\r\n");
          } else if (line.startsWith("MAIL FROM:")) socket.write("250 sender\r\n");
          else if (line.startsWith("RCPT TO:"))
            socket.write(
              mode === "reject" ? "550 synthetic-secret-is-not-for-logs\r\n" : "250 recipient\r\n",
            );
          else if (line === "DATA") {
            socket.data.data = true;
            socket.write("354 proceed\r\n");
            return;
          } else if (line === "QUIT" && mode !== "accepted-quit-stall") socket.end("221 bye\r\n");
        }
      },
    },
  });
  const config: SmtpConfig = {
    host: "localhost",
    port: server.port,
    secure: Boolean(tls),
    from: "sender@example.test",
    timeoutMs: 1000,
  };
  return {
    config,
    messages,
    commands,
    sockets,
    close() {
      for (const socket of sockets) socket.terminate();
      server.stop(true);
    },
  };
}
const message = {
  to: "recipient@example.test",
  subject: "Synthetic SMTP fixture",
  body: "Synthetic body",
};
async function closed(sockets: Set<unknown>) {
  const deadline = Date.now() + 1000;
  while (sockets.size > 0 && Date.now() < deadline) await Bun.sleep(5);
  expect(sockets.size).toBe(0);
}

test("native SMTP immediate greeting, multiline EHLO, AUTH and complete DATA succeed", async () => {
  const server = fixture("normal");
  try {
    await defaultSmtpTransport(
      { ...server.config, username: "synthetic-user", password: "synthetic-password" },
      message,
    );
    expect(server.messages).toHaveLength(1);
    expect(server.messages[0]).toContain(message.body);
    expect(server.commands).toContain(Buffer.from("synthetic-user").toString("base64"));
    await closed(server.sockets);
  } finally {
    server.close();
  }
});
for (const mode of ["close-greeting", "close-ehlo", "close-data"] as const) {
  test(`native SMTP ${mode} rejects instead of hanging`, async () => {
    const server = fixture(mode);
    try {
      await expect(defaultSmtpTransport(server.config, message)).rejects.toThrow(/closed|failed/);
      await closed(server.sockets);
    } finally {
      server.close();
    }
  });
}
for (const mode of ["silent-greeting", "silent-data"] as const) {
  test(`native SMTP ${mode} has a bounded deadline and closes its socket`, async () => {
    const server = fixture(mode);
    try {
      const error = await defaultSmtpTransport({ ...server.config, timeoutMs: 80 }, message).catch(
        (error) => error,
      );
      expect(error.name).toBe("TimeoutError");
      await closed(server.sockets);
    } finally {
      server.close();
    }
  });
}
test("native SMTP cancellation preserves the reason and closes active DATA", async () => {
  const server = fixture("silent-data");
  const controller = new AbortController();
  try {
    const send = defaultSmtpTransport(server.config, { ...message, signal: controller.signal });
    const deadline = Date.now() + 1000;
    while (!server.messages.length && Date.now() < deadline) await Bun.sleep(5);
    expect(server.messages).toHaveLength(1);
    const reason = new Error("Synthetic caller cancellation");
    controller.abort(reason);
    expect(await send.catch((error) => error)).toBe(reason);
    await closed(server.sockets);
  } finally {
    server.close();
  }
});
for (const mode of ["accepted-close", "accepted-quit-stall"] as const) {
  test(`final DATA acceptance stays successful with ${mode}`, async () => {
    const server = fixture(mode);
    try {
      await defaultSmtpTransport(server.config, message);
      expect(server.messages).toHaveLength(1);
      await closed(server.sockets);
    } finally {
      server.close();
    }
  });
}
for (const mode of ["reject", "oversized", "malformed"] as const) {
  test(`native SMTP ${mode} rejects with bounded sanitized protocol errors`, async () => {
    const server = fixture(mode);
    try {
      const error = await defaultSmtpTransport(server.config, message).catch((error) => error);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).not.toContain("synthetic-secret");
      expect(error.name).not.toBe("TimeoutError");
      await closed(server.sockets);
    } finally {
      server.close();
    }
  });
}
test("native SMTP drains partial writes without truncating a large DATA body", async () => {
  const server = fixture("normal");
  const body = `${"x".repeat(8 * 1024 * 1024)}END-OF-SYNTHETIC-BODY`;
  try {
    await defaultSmtpTransport({ ...server.config, timeoutMs: 10000 }, { ...message, body });
    expect(server.messages).toHaveLength(1);
    expect(server.messages[0]?.endsWith(body)).toBe(true);
  } finally {
    server.close();
  }
}, 15000);

test("secure SMTP uses verified implicit TLS and refuses plaintext/untrusted peers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "strata-smtp-tls-"));
  const key = join(directory, "key.pem"),
    cert = join(directory, "cert.pem");
  const generated = Bun.spawn(
    [
      "openssl",
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost",
      "-days",
      "1",
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
  const plain = fixture("normal");
  let secure: ReturnType<typeof fixture> | undefined;
  try {
    expect(await generated.exited).toBe(0);
    secure = fixture("normal", { key: Bun.file(key), cert: Bun.file(cert) });
    await defaultSmtpTransport({ ...secure.config, tls: { ca: Bun.file(cert) } }, message);
    expect(secure.messages).toHaveLength(1);
    await expect(defaultSmtpTransport(secure.config, message)).rejects.toThrow();
    await expect(
      defaultSmtpTransport(
        { ...secure.config, tls: { ca: Bun.file(cert), serverName: "wrong.example.test" } },
        message,
      ),
    ).rejects.toThrow();
    await expect(
      defaultSmtpTransport({ ...plain.config, secure: true }, message),
    ).rejects.toThrow();
    expect(plain.messages).toHaveLength(0);
    expect(plain.commands.some((command) => command.startsWith("EHLO"))).toBe(false);
  } finally {
    plain.close();
    secure?.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
