import { BadRequestError } from "../errors/http";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "metadata.google.internal",
]);

function isPrivateIpv4(hostname: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);

  if (!match) {
    return false;
  }

  const octets = match.slice(1, 5).map((part) => Number.parseInt(part, 10));

  if (octets.some((octet) => octet < 0 || octet > 255)) {
    return true;
  }

  const [a = 0, b = 0] = octets;

  if (a === 10) {
    return true;
  }

  if (a === 127) {
    return true;
  }

  if (a === 0) {
    return true;
  }

  if (a === 169 && b === 254) {
    return true;
  }

  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }

  if (a === 192 && b === 168) {
    return true;
  }

  return false;
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();

  if (normalized.length === 0) {
    return true;
  }

  if (BLOCKED_HOSTNAMES.has(normalized)) {
    return true;
  }

  if (normalized.endsWith(".local") || normalized.endsWith(".internal")) {
    return true;
  }

  if (normalized.includes(":")) {
    return true;
  }

  return isPrivateIpv4(normalized);
}

function assertSafeOutboundUrl(rawUrl: string, options: { allowHttp?: boolean } = {}): URL {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new BadRequestError("Webhook URL is invalid.");
  }

  if (parsed.protocol !== "https:" && !(options.allowHttp && parsed.protocol === "http:")) {
    throw new BadRequestError("Webhook URL must use HTTPS.");
  }

  if (parsed.username || parsed.password) {
    throw new BadRequestError("Webhook URL must not include credentials.");
  }

  if (isBlockedHostname(parsed.hostname)) {
    throw new BadRequestError("Webhook URL targets a blocked host.");
  }

  return parsed;
}

export { assertSafeOutboundUrl, isBlockedHostname };
