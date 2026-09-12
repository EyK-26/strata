import { createHmac } from "node:crypto";
import { requireConfiguredSecret } from "../runtime/appKeyPrefix";

function resolveTokenPepper(): string {
  return requireConfiguredSecret(["TOKEN_HASH_PEPPER"], "token-pepper");
}

function hashApiToken(token: string): string {
  return createHmac("sha256", resolveTokenPepper()).update(token).digest("hex");
}

export { hashApiToken, resolveTokenPepper };
