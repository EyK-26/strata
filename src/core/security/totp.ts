import { createHmac } from "node:crypto";

function decodeBase32(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = input.replace(/=+$/u, "").toUpperCase();
  let bits = "";

  for (const char of normalized) {
    const value = alphabet.indexOf(char);

    if (value === -1) {
      throw new Error("Invalid base32 character in MFA secret.");
    }

    bits += value.toString(2).padStart(5, "0");
  }

  const bytes: number[] = [];

  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }

  return Buffer.from(bytes);
}

function generateTotp(secret: string, counter: number, digits = 6): string {
  const key = decodeBase32(secret);
  const buffer = Buffer.alloc(8);

  buffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac("sha1", key).update(buffer).digest();
  const lastByte = digest[digest.length - 1] ?? 0;
  const offset = lastByte & 0x0f;
  const b0 = digest[offset] ?? 0;
  const b1 = digest[offset + 1] ?? 0;
  const b2 = digest[offset + 2] ?? 0;
  const b3 = digest[offset + 3] ?? 0;
  const code = ((b0 & 0x7f) << 24) | ((b1 & 0xff) << 16) | ((b2 & 0xff) << 8) | (b3 & 0xff);

  return String(code % 10 ** digits).padStart(digits, "0");
}

function verifyTotp(secret: string, token: string, window = 1): boolean {
  const normalized = token.trim();

  if (!/^\d{6}$/u.test(normalized)) {
    return false;
  }

  const timestep = Math.floor(Date.now() / 30_000);

  for (let offset = -window; offset <= window; offset += 1) {
    if (generateTotp(secret, timestep + offset) === normalized) {
      return true;
    }
  }

  return false;
}

export { generateTotp, verifyTotp };
