import { createHmac, timingSafeEqual } from "node:crypto";
import { requireConfiguredSecret } from "../runtime/appKeyPrefix";

interface JwtPayload {
  sub: string | number;
  role?: string;
  abilities?: string[];
  emailVerifiedAt?: Date | string | null;
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

interface SignJwtOptions {
  secret?: string;
  ttlSeconds?: number;
}

function resolveJwtSecret(secret?: string): string {
  if (secret?.trim()) {
    return secret.trim();
  }

  return requireConfiguredSecret(["JWT_SECRET", "SESSION_SECRET"], "jwt-secret");
}

function jwtTtlSeconds(override?: number): number {
  if (typeof override === "number" && Number.isInteger(override) && override > 0) {
    return override;
  }

  const parsed = Number.parseInt(process.env.JWT_TTL_SECONDS ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 3600;
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeJson<T>(value: string): T | null {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function signPart(headerAndPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(headerAndPayload).digest("base64url");
}

function signaturesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function signJwt(payload: JwtPayload, options: SignJwtOptions = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const body: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + jwtTtlSeconds(options.ttlSeconds),
  };
  const header = encodeJson({ alg: "HS256", typ: "JWT" });
  const data = encodeJson(body);
  const unsigned = `${header}.${data}`;
  const signature = signPart(unsigned, resolveJwtSecret(options.secret));
  return `${unsigned}.${signature}`;
}

function verifyJwt(token: string, secret?: string): JwtPayload | null {
  const parts = token.split(".");

  if (parts.length !== 3) {
    return null;
  }

  const [header, data, signature] = parts;

  if (!header || !data || !signature) {
    return null;
  }

  const expected = signPart(`${header}.${data}`, resolveJwtSecret(secret));

  if (!signaturesMatch(signature, expected)) {
    return null;
  }

  const parsedHeader = decodeJson<{ alg?: string; typ?: string }>(header);

  if (parsedHeader?.alg !== "HS256") {
    return null;
  }

  const payload = decodeJson<JwtPayload>(data);

  if (!payload || payload.sub === undefined || payload.sub === null) {
    return null;
  }

  if (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now()) {
    return null;
  }

  return payload;
}

export type { JwtPayload, SignJwtOptions };
export { jwtTtlSeconds, resolveJwtSecret, signJwt, verifyJwt };
