import { BlockList, isIP } from "node:net";
import { ForbiddenError } from "../errors/http";
import { currentRequestMeta } from "../http/requestMetaContext";

interface PublicTenancyOptions {
  /** Application-owned lookup of approved normalized hostnames; unknown hosts return null. */
  resolveTenantId(hostname: string): Promise<number | null>;
  /** Exact immediate socket-peer IP addresses. The proxy must overwrite X-Forwarded-Host. */
  trustedProxyAddresses?: readonly string[];
}

/** Normalize an HTTP authority for approved-domain storage and lookup, without its port. */
function normalizeTenantHostname(authority: string): string {
  if (!authority || authority !== authority.trim() || /[\s\\/@?#%,]/.test(authority)) {
    throw new ForbiddenError("Invalid tenant hostname.");
  }
  let url: URL;
  try {
    url = new URL(`http://${authority}`);
  } catch {
    throw new ForbiddenError("Invalid tenant hostname.");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
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
            /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
        ))
  ) {
    throw new ForbiddenError("Invalid tenant hostname.");
  }
  return hostname;
}

function createPublicTenantSelector(options: PublicTenancyOptions) {
  const addresses = options.trustedProxyAddresses ?? [];
  if (addresses.length > 128)
    throw new Error("Public tenancy supports at most 128 trusted proxy addresses.");
  const proxies = new BlockList();
  for (const address of addresses) {
    const version = isIP(address);
    if (!version) throw new Error("Trusted proxy addresses must be literal IP addresses.");
    proxies.addAddress(address, version === 6 ? "ipv6" : "ipv4");
  }
  return async (request: Request): Promise<number> => {
    const peer = currentRequestMeta().peerAddress;
    const version = peer ? isIP(peer) : 0;
    const trusted = peer && version && proxies.check(peer, version === 6 ? "ipv6" : "ipv4");
    const forwarded = trusted ? request.headers.get("x-forwarded-host") : null;
    const authority = forwarded ?? request.headers.get("host") ?? new URL(request.url).host;
    const id = await options.resolveTenantId(normalizeTenantHostname(authority));
    if (id === null) throw new ForbiddenError("Tenant host not found.");
    if (!Number.isSafeInteger(id) || id <= 0)
      throw new Error("Public tenant resolver returned an invalid identity.");
    return id;
  };
}

export type { PublicTenancyOptions };
export { createPublicTenantSelector, normalizeTenantHostname };
