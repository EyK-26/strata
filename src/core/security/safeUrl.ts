import { lookup as dnsLookupImpl } from "node:dns/promises";
import { BadRequestError } from "@getstrata/core/errors/http";

type DnsLookupResult = { address: string; family: number };
type DnsLookup = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<DnsLookupResult[]>;

let dnsLookup: DnsLookup = dnsLookupImpl;

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

function isBlockedIpAddress(address: string): boolean {
  return isBlockedHostname(address.trim().toLowerCase());
}

async function assertSafeOutboundUrlResolved(
  rawUrl: string,
  options: { allowHttp?: boolean; resolveDns?: boolean } = {},
): Promise<URL> {
  const parsed = assertSafeOutboundUrl(rawUrl, options);

  if (options.resolveDns === false) {
    return parsed;
  }

  const hostname = parsed.hostname.trim().toLowerCase();

  const results = await dnsLookup(hostname, { all: true, verbatim: true });

  if (results.some((result) => isBlockedIpAddress(result.address))) {
    throw new BadRequestError("Webhook URL targets a blocked host.");
  }

  return parsed;
}

function setDnsLookupForTests(lookupFn: DnsLookup): void {
  dnsLookup = lookupFn;
}

function resetDnsLookupForTests(): void {
  dnsLookup = dnsLookupImpl;
}

export {
  assertSafeOutboundUrl,
  assertSafeOutboundUrlResolved,
  isBlockedHostname,
  isBlockedIpAddress,
  resetDnsLookupForTests,
  setDnsLookupForTests,
};
