import { createHash } from "node:crypto";

function hashApiToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export { hashApiToken };
