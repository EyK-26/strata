import { createHash, createHmac } from "node:crypto";
import { appDevSecret, requireConfiguredSecret } from "../runtime/appKeyPrefix";

function resolveTokenPepper(): string {
  return requireConfiguredSecret(["TOKEN_HASH_PEPPER"], "token-pepper");
}

function hashApiToken(token: string): string {
  const pepper = resolveTokenPepper();

  if (pepper && pepper !== appDevSecret("token-pepper")) {
    return createHmac("sha256", pepper).update(token).digest("hex");
  }

  return createHash("sha256").update(token).digest("hex");
}

export { hashApiToken, resolveTokenPepper };
