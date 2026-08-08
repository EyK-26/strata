import { currentAuthUser } from "../auth/authContext";
import { currentRequestMeta } from "../http/requestMetaContext";

interface SecurityEventDetails {
  [key: string]: unknown;
}

function logSecurityEvent(event: string, details: SecurityEventDetails = {}): void {
  const meta = currentRequestMeta();
  const user = currentAuthUser();

  console.log(
    JSON.stringify({
      level: "security",
      event,
      timestamp: new Date().toISOString(),
      ip_address: meta.ipAddress ?? null,
      user_agent: meta.userAgent ?? null,
      user_id: user?.id ?? null,
      ...details,
    }),
  );
}

export type { SecurityEventDetails };
export { logSecurityEvent };
