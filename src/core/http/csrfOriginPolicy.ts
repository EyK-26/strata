import { isIP } from "node:net";
import { ForbiddenError } from "../errors/http";

function parseAuthority(authority: string | null, protocol: string): string | null {
  if (!authority || authority.endsWith(":") || /[\s\\/@?#%,*]/.test(authority)) return null;
  try {
    const url = new URL(`${protocol}//${authority}`);
    const hostname = url.hostname.replace(/\.$/, "");
    const ip = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
    if (
      !isIP(ip) &&
      (hostname.length > 253 ||
        !hostname
          .split(".")
          .every(
            (label) =>
              label.length > 0 &&
              label.length <= 63 &&
              /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
          ))
    )
      return null;
    return url.host;
  } catch {
    return null;
  }
}

function parseOrigin(value: unknown, allowRootPath: boolean): string | null {
  if (typeof value !== "string" || value !== value.trim()) return null;
  const match = /^(https?):\/\/([^/?#]+)(\/?)$/i.exec(value);
  if (!match || (!allowRootPath && match[3])) return null;
  const protocol = `${match[1]?.toLowerCase()}:`;
  const host = parseAuthority(match[2] ?? null, protocol);
  return host ? `${protocol}//${host}` : null;
}

/** Explicit target policy only. Forwarding headers never select an origin or approve a host. */
function createCsrfOriginPolicy(value: unknown) {
  const origin = parseOrigin(value, true);
  if (!origin)
    throw new TypeError(
      "CSRF targetOrigin must be a single HTTP(S) origin without credentials, path, query, fragment or wildcard.",
    );
  const target = new URL(origin);
  return {
    acceptsSourceOrigin(source: string | null): boolean {
      return parseOrigin(source, false) === origin;
    },
    assertHost(request: Request): void {
      let url: URL;
      try {
        url = new URL(request.url);
      } catch {
        throw new ForbiddenError("Unrecognized request host.");
      }
      if (
        !/^https?:$/.test(url.protocol) ||
        url.username ||
        url.password ||
        parseAuthority(url.host, target.protocol) !== target.host ||
        parseAuthority(request.headers.get("host"), target.protocol) !== target.host
      )
        throw new ForbiddenError("Unrecognized request host.");
    },
  };
}

export { createCsrfOriginPolicy };
