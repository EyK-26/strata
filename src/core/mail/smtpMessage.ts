import type { MailMessage } from "./mailer.ts";

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

function encodeBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
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

export {
  assertSafeSmtpAddress,
  assertSafeSmtpField,
  buildSmtpPayload,
  encodeBase64,
  smtpEnvelopeAddress,
};
