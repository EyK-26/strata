import { createHash } from "node:crypto";
import {
  type CreateSessionCookieOptions,
  createSessionCookieDetails,
  readSession,
} from "@getstrata/core/auth/sessionCookie";
import { repositoryConnection as db } from "@getstrata/core/database/repositoryConnection";
import { BadRequestError } from "@getstrata/core/errors/http";

interface BrowserSessionRow {
  id: string;
  user_id: number;
  expires_at: Date;
  user_agent: string | null;
  ip_address: string | null;
  last_active_at: Date | null;
}

interface BrowserSessionView extends BrowserSessionRow {
  current: boolean;
}

function hmacBrowserSessionId(userId: number, issuedAt: number): string {
  return createHash("sha256").update(`hmac:${userId}:${issuedAt}`).digest("hex");
}

function clientIpAddress(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");

  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();

    if (first) {
      return first;
    }
  }

  const realIp = request.headers.get("x-real-ip")?.trim();

  return realIp ? realIp : null;
}

function clientUserAgent(request: Request): string | null {
  const userAgent = request.headers.get("user-agent")?.trim();

  return userAgent ? userAgent : null;
}

async function recordHmacBrowserSession(options: {
  userId: number;
  issuedAt: number;
  ttlSeconds: number;
  userAgent?: string | null;
  ipAddress?: string | null;
}): Promise<string> {
  const id = hmacBrowserSessionId(options.userId, options.issuedAt);
  const expiresAt = new Date(options.issuedAt + options.ttlSeconds * 1000);
  const lastActiveAt = new Date(options.issuedAt);
  const userAgent = options.userAgent ?? null;
  const ipAddress = options.ipAddress ?? null;

  await db`
    INSERT INTO sessions (id, user_id, expires_at, user_agent, ip_address, last_active_at)
    VALUES (
      ${id},
      ${options.userId},
      ${expiresAt},
      ${userAgent},
      ${ipAddress},
      ${lastActiveAt}
    )
    ON CONFLICT (id) DO UPDATE SET
      expires_at = EXCLUDED.expires_at,
      user_agent = EXCLUDED.user_agent,
      ip_address = EXCLUDED.ip_address,
      last_active_at = EXCLUDED.last_active_at
  `;

  return id;
}

async function issueHmacBrowserSession(
  request: Request,
  userId: number,
  options: CreateSessionCookieOptions = {},
): Promise<{ header: string; id: string }> {
  const details = createSessionCookieDetails(userId, options);
  const id = await recordHmacBrowserSession({
    userId: details.userId,
    issuedAt: details.issuedAt,
    ttlSeconds: details.ttlSeconds,
    userAgent: clientUserAgent(request),
    ipAddress: clientIpAddress(request),
  });

  return { header: details.header, id };
}

async function forgetHmacBrowserSession(userId: number, issuedAt: number): Promise<void> {
  const id = hmacBrowserSessionId(userId, issuedAt);
  await db`DELETE FROM sessions WHERE id = ${id} AND user_id = ${userId}`;
}

async function forgetOtherBrowserSessions(userId: number, keepSessionId: string): Promise<void> {
  await db`DELETE FROM sessions WHERE user_id = ${userId} AND id <> ${keepSessionId}`;
}

async function forgetBrowserSessionById(userId: number, sessionId: string): Promise<boolean> {
  const deleted = (await db`
    DELETE FROM sessions
    WHERE id = ${sessionId} AND user_id = ${userId}
    RETURNING id
  `) as Array<{ id: string }>;

  return deleted.length > 0;
}

async function hasActiveHmacBrowserSession(userId: number, issuedAt: number): Promise<boolean> {
  const id = hmacBrowserSessionId(userId, issuedAt);
  const rows = (await db`
    UPDATE sessions
    SET last_active_at = NOW()
    WHERE id = ${id} AND user_id = ${userId} AND expires_at > NOW()
    RETURNING id
  `) as Array<{ id: string }>;

  return rows.length > 0;
}

function parseBrowserSessionId(raw: string | undefined): string {
  const id = raw?.trim() ?? "";

  if (!/^[a-f0-9]{64}$/i.test(id)) {
    throw new BadRequestError("Invalid browser session.");
  }

  return id.toLowerCase();
}

async function listBrowserSessionsForUser(
  userId: number,
  request?: Request,
): Promise<BrowserSessionView[]> {
  await db`DELETE FROM sessions WHERE user_id = ${userId} AND expires_at <= NOW()`;

  const rows = (await db`
    SELECT id, user_id, expires_at, user_agent, ip_address, last_active_at
    FROM sessions
    WHERE user_id = ${userId} AND expires_at > NOW()
    ORDER BY last_active_at DESC NULLS LAST, expires_at DESC
  `) as BrowserSessionRow[];

  const current = request ? readSession(request) : null;
  const currentId = current ? hmacBrowserSessionId(current.userId, current.issuedAt) : null;

  return rows.map((row) => ({
    ...row,
    current: currentId !== null && row.id === currentId,
  }));
}

export type { BrowserSessionView };
export {
  clientIpAddress,
  clientUserAgent,
  forgetBrowserSessionById,
  forgetHmacBrowserSession,
  forgetOtherBrowserSessions,
  hasActiveHmacBrowserSession,
  hmacBrowserSessionId,
  issueHmacBrowserSession,
  listBrowserSessionsForUser,
  parseBrowserSessionId,
  recordHmacBrowserSession,
};
