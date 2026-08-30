import { createHash, createHmac } from "node:crypto";
import { appDevSecret } from "../runtime/appKeyPrefix";

function resolveTokenPepper(): string {
  return process.env.TOKEN_HASH_PEPPER?.trim() ?? appDevSecret("token-pepper");
}

function hashApiToken(token: string): string {
  const pepper = resolveTokenPepper();

  if (pepper && pepper !== appDevSecret("token-pepper")) {
    return createHmac("sha256", pepper).update(token).digest("hex");
  }

  return createHash("sha256").update(token).digest("hex");
}

export { hashApiToken, resolveTokenPepper };
