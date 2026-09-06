import { currentRequestMeta } from "@getstrata/core/http/requestMetaContext";

type EnvRecord = Record<string, string | undefined>;

function trustForwardedFor(env: EnvRecord = process.env): boolean {
  return (env.TRUST_FORWARDED_FOR ?? "false") === "true";
}

function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^::ffff:/i, "");
  return (
    ip === "::1" ||
    ip === "localhost" ||
    /^127\./.test(ip) ||
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^169\.254\./.test(ip) ||
    /^f[cd][0-9a-f]{2}:/i.test(ip) ||
    /^fe80:/i.test(ip)
  );
}

/**
 * Proxies append to X-Forwarded-For, so the client-controlled entries are on
 * the left. Take the rightmost public hop; fall back to the rightmost entry
 * when every hop is private (an internal client).
 */
function forwardedClientIp(request: Request): string | undefined {
  const hops = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);

  for (let index = hops.length - 1; index >= 0; index -= 1) {
    const hop = hops[index];
    if (hop && !isPrivateAddress(hop)) {
      return hop;
    }
  }
  if (hops.length > 0) {
    return hops[hops.length - 1];
  }

  return request.headers.get("x-real-ip")?.trim() || undefined;
}

/** Forwarded headers only when trusted; otherwise the socket address the server recorded. */
function readClientIp(request: Request, env: EnvRecord = process.env): string | undefined {
  if (trustForwardedFor(env)) {
    const forwarded = forwardedClientIp(request);
    if (forwarded) {
      return forwarded;
    }
  }

  return currentRequestMeta().ipAddress ?? undefined;
}

export { isPrivateAddress, readClientIp, trustForwardedFor };
