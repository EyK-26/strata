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

function parseCanonicalDottedDecimal(hostname: string): number[] | null {
  const parts = hostname.split(".");

  if (parts.length !== 4) {
    return null;
  }

  const octets: number[] = [];

  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/u.test(part)) {
      return null;
    }

    const value = Number.parseInt(part, 10);
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      return null;
    }

    octets.push(value);
  }

  return octets;
}

function parseDottedIpv4(hostname: string): number[] | null {
  return parseCanonicalDottedDecimal(hostname);
}

function isBlockedIpv4Octets(octets: number[]): boolean {
  const [a = 0, b = 0] = octets;

  if (a === 10 || a === 127 || a === 0) {
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

  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }

  if (a === 198 && (b === 18 || b === 19)) {
    return true;
  }

  return false;
}

function expandIpv6(hostname: string): number[] | null {
  const trimmed = hostname.trim().toLowerCase();
  if (trimmed.includes("%")) {
    return null;
  }

  const mapped = trimmed.match(/^::ffff:([0-9a-fx.]+)$/iu);
  if (mapped?.[1]) {
    const octets = parseDottedIpv4(mapped[1]);
    if (!octets) {
      return null;
    }
    return [
      0,
      0,
      0,
      0,
      0,
      0xffff,
      ((octets[0] as number) << 8) | (octets[1] as number),
      ((octets[2] as number) << 8) | (octets[3] as number),
    ];
  }

  const halves = trimmed.split("::");
  if (halves.length > 2) {
    return null;
  }

  const parseGroup = (part: string): number | null => {
    if (!/^[0-9a-f]{1,4}$/u.test(part)) {
      return null;
    }
    return Number.parseInt(part, 16);
  };

  if (halves.length === 1) {
    const groups = trimmed.split(":");
    if (groups.length !== 8) {
      return null;
    }
    const values = groups.map(parseGroup);
    return values.every((value): value is number => value !== null) ? values : null;
  }

  const head = halves[0] ? halves[0].split(":").filter(Boolean) : [];
  const tail = halves[1] ? halves[1].split(":").filter(Boolean) : [];
  if (head.length + tail.length > 8) {
    return null;
  }

  const values: number[] = [];
  for (const part of head) {
    const value = parseGroup(part);
    if (value === null) {
      return null;
    }
    values.push(value);
  }
  while (values.length < 8 - tail.length) {
    values.push(0);
  }
  for (const part of tail) {
    const value = parseGroup(part);
    if (value === null) {
      return null;
    }
    values.push(value);
  }

  return values.length === 8 ? values : null;
}

function isBlockedIpv6(hostname: string): boolean {
  const groups = expandIpv6(hostname);
  if (!groups) {
    return hostname.includes(":");
  }

  const first = groups[0] ?? 0;
  const second = groups[1] ?? 0;

  if (groups.every((group) => group === 0)) {
    return true;
  }

  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) {
    return true;
  }

  if ((first & 0xffc0) === 0xfe80) {
    return true;
  }

  if ((first & 0xfe00) === 0xfc00) {
    return true;
  }

  if ((first & 0xff00) === 0xff00) {
    return true;
  }

  if (
    first === 0 &&
    second === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0xffff
  ) {
    const a = (groups[6] ?? 0) >> 8;
    const b = (groups[6] ?? 0) & 0xff;
    const c = (groups[7] ?? 0) >> 8;
    const d = (groups[7] ?? 0) & 0xff;
    return isBlockedIpv4Octets([a, b, c, d]);
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
    return isBlockedIpv6(normalized);
  }

  if (/^\d+$/u.test(normalized)) {
    return true;
  }

  if (normalized.includes(".")) {
    const canonical = parseCanonicalDottedDecimal(normalized);
    if (canonical) {
      return isBlockedIpv4Octets(canonical);
    }

    if (/^[0-9a-fx.]+$/iu.test(normalized)) {
      return true;
    }
  }

  return false;
}

function assertSafeOutboundUrl(
  rawUrl: string,
  options: { allowHttp?: boolean; allowPrivate?: boolean } = {},
): URL {
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

  if (!options.allowPrivate && isBlockedHostname(parsed.hostname)) {
    throw new BadRequestError("Webhook URL targets a blocked host.");
  }

  return parsed;
}

function isBlockedIpAddress(address: string): boolean {
  return isBlockedHostname(address.trim().toLowerCase());
}

function isLiteralIpHostname(hostname: string): boolean {
  return parseCanonicalDottedDecimal(hostname) !== null || expandIpv6(hostname) !== null;
}

function pinUrlToAddress(url: URL, address: string): URL {
  const pinned = new URL(url.toString());
  pinned.hostname = address;
  return pinned;
}

interface ResolvedOutboundUrl {
  url: URL;
  addresses: string[];
}

async function resolveSafeOutboundTarget(
  rawUrl: string,
  options: { allowHttp?: boolean; resolveDns?: boolean; allowPrivate?: boolean } = {},
): Promise<ResolvedOutboundUrl> {
  const parsed = assertSafeOutboundUrl(rawUrl, options);

  if (options.resolveDns === false || options.allowPrivate) {
    return { url: parsed, addresses: [] };
  }

  const hostname = parsed.hostname.trim().toLowerCase();
  if (isLiteralIpHostname(hostname)) {
    return { url: parsed, addresses: [hostname] };
  }

  let results: DnsLookupResult[];
  try {
    results = await dnsLookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new BadRequestError("Webhook URL targets a blocked host.");
  }

  if (results.length === 0 || results.some((result) => isBlockedIpAddress(result.address))) {
    throw new BadRequestError("Webhook URL targets a blocked host.");
  }

  return { url: parsed, addresses: results.map((result) => result.address) };
}

async function assertSafeOutboundUrlResolved(
  rawUrl: string,
  options: { allowHttp?: boolean; resolveDns?: boolean; allowPrivate?: boolean } = {},
): Promise<URL> {
  return (await resolveSafeOutboundTarget(rawUrl, options)).url;
}

function setDnsLookupForTests(lookupFn: DnsLookup): void {
  dnsLookup = lookupFn;
}

function resetDnsLookupForTests(): void {
  dnsLookup = dnsLookupImpl;
}

export type { ResolvedOutboundUrl };
export {
  assertSafeOutboundUrl,
  assertSafeOutboundUrlResolved,
  isBlockedHostname,
  isBlockedIpAddress,
  pinUrlToAddress,
  resetDnsLookupForTests,
  resolveSafeOutboundTarget,
  setDnsLookupForTests,
};
