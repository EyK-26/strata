import { createHash, createHmac } from "node:crypto";

function resolveTokenPepper(): string {
  return process.env.TOKEN_HASH_PEPPER?.trim() ?? "workhub-dev-token-pepper";
}

function hashApiToken(token: string): string {
  const pepper = resolveTokenPepper();

  if (pepper && pepper !== "workhub-dev-token-pepper") {
    return createHmac("sha256", pepper).update(token).digest("hex");
  }

  return createHash("sha256").update(token).digest("hex");
}

export { hashApiToken, resolveTokenPepper };
