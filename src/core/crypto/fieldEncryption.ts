import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const ENCRYPTION_PREFIX = "enc:v1:";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function resolveEncryptionKey(): Buffer | null {
  const raw = process.env.KMS_ENCRYPTION_KEY?.trim();

  if (!raw) {
    return null;
  }

  if (/^[0-9a-f]{64}$/i.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  const decoded = Buffer.from(raw, "base64");

  if (decoded.length === 32) {
    return decoded;
  }

  throw new Error("KMS_ENCRYPTION_KEY must be 32 bytes (hex or base64).");
}

function isFieldEncryptionEnabled(): boolean {
  const featureFlag = process.env.FEATURE_FIELD_ENCRYPTION;

  if (featureFlag === "false") {
    return false;
  }

  if (featureFlag === "true") {
    return true;
  }

  return Boolean(resolveFieldEncryptionKeyring() || resolveEncryptionKey());
}

function encryptField(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, encrypted, tag]).toString("base64");

  return `${ENCRYPTION_PREFIX}${payload}`;
}

function decryptField(value: string, key: Buffer): string {
  if (!value.startsWith(ENCRYPTION_PREFIX)) {
    return value;
  }

  const payload = Buffer.from(value.slice(ENCRYPTION_PREFIX.length), "base64");
  const iv = payload.subarray(0, IV_LENGTH);
  const tag = payload.subarray(payload.length - TAG_LENGTH);
  const ciphertext = payload.subarray(IV_LENGTH, payload.length - TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function hashLookupValue(normalizedValue: string, key: Buffer): string {
  return createHmac("sha256", key).update(normalizedValue).digest("hex");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function protectEmail(email: string): { storedEmail: string; emailLookup: string } {
  const normalized = normalizeEmail(email);
  const configured = resolveFieldEncryptionKeyring();
  if (configured && isFieldEncryptionEnabled()) {
    return {
      storedEmail: configured.encrypt(normalized, "email"),
      emailLookup: configured.keyring.lookup(normalized),
    };
  }
  const key = resolveEncryptionKey();

  if (!key || !isFieldEncryptionEnabled()) {
    return { storedEmail: normalized, emailLookup: normalized };
  }

  return {
    storedEmail: encryptField(normalized, key),
    emailLookup: hashLookupValue(normalized, key),
  };
}

function revealEmail(storedEmail: string): string {
  const configured = resolveFieldEncryptionKeyring();
  if (configured && storedEmail.startsWith("enc:"))
    return configured.keyring.decrypt(storedEmail, "email");
  if (storedEmail.startsWith("enc:") && !storedEmail.startsWith(ENCRYPTION_PREFIX))
    throw new Error("Identified encrypted fields require KMS_ENCRYPTION_KEYRING.");
  const key = resolveEncryptionKey();

  if (!key || !storedEmail.startsWith(ENCRYPTION_PREFIX)) {
    return storedEmail;
  }

  return decryptField(storedEmail, key);
}

function emailLookupForQuery(email: string): string {
  const normalized = normalizeEmail(email);
  const configured = resolveFieldEncryptionKeyring();
  if (configured && isFieldEncryptionEnabled()) return configured.keyring.lookup(normalized);
  const key = resolveEncryptionKey();

  if (!key || !isFieldEncryptionEnabled()) {
    return normalized;
  }

  return hashLookupValue(normalized, key);
}

export {
  decryptField,
  emailLookupForQuery,
  encryptField,
  hashLookupValue,
  isFieldEncryptionEnabled,
  normalizeEmail,
  protectEmail,
  resolveEncryptionKey,
  revealEmail,
};

interface FieldEncryptionKeyringOptions {
  /** Public stable identifiers; never reuse an ID for different key material. */
  activeKeyId: string;
  encryptionKeys: Readonly<Record<string, Uint8Array>>;
  /** Explicitly retained key for unidentified enc:v1 records and historical backups. */
  legacyV1Key?: Uint8Array;
  /** Pinned independently of write-key rotation. Use the original key to preserve v1 email hashes. */
  lookupKey: Uint8Array;
}
interface FieldEncryptionKeyring {
  encrypt(plaintext: string, purpose: string): string;
  decrypt(ciphertext: string, purpose: string): string;
  /** Input must already be normalized using the application's existing lookup contract. */
  lookup(normalizedValue: string): string;
}

/** Opt-in primitives only. This does not activate auth rotation or migrate persisted rows. */
function createFieldEncryptionKeyring(
  options: FieldEncryptionKeyringOptions,
): FieldEncryptionKeyring {
  const identifier = /^[A-Za-z0-9_-]{1,64}$/;
  const copyKey = (value: Uint8Array): Buffer => {
    if (!(value instanceof Uint8Array) || value.byteLength !== 32)
      throw new TypeError("Field encryption keys must be 32 bytes.");
    return Buffer.from(value);
  };
  const entries = Object.entries(options.encryptionKeys);
  if (entries.length < 1 || entries.length > 32)
    throw new TypeError("Field encryption keyrings require 1 to 32 keys.");
  const keys = new Map<string, Buffer>();
  for (const [id, key] of entries) {
    if (!identifier.test(id)) throw new TypeError("Invalid field encryption key identifier.");
    keys.set(id, copyKey(key));
  }
  const activeKeyId = options.activeKeyId;
  const active = keys.get(activeKeyId);
  if (!active) throw new TypeError("Active field encryption key is not retained.");
  const legacy = options.legacyV1Key === undefined ? undefined : copyKey(options.legacyV1Key);
  const lookup = copyKey(options.lookupKey);
  const associatedData = (id: string, purpose: string): Buffer => {
    if (!identifier.test(purpose)) throw new TypeError("Invalid field encryption purpose.");
    return Buffer.from(`strata:field:v2:${id}:${purpose}`, "utf8");
  };
  const decodePayload = (encoded: string): Buffer => {
    const payload = Buffer.from(encoded, "base64");
    if (payload.length < IV_LENGTH + TAG_LENGTH || payload.toString("base64") !== encoded)
      throw new Error("Invalid encrypted field.");
    return payload;
  };
  return Object.freeze({
    encrypt(plaintext: string, purpose: string): string {
      const aad = associatedData(activeKeyId, purpose);
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv("aes-256-gcm", active, iv, { authTagLength: TAG_LENGTH });
      cipher.setAAD(aad);
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const payload = Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString("base64");
      return `enc:v2:${activeKeyId}:${payload}`;
    },
    decrypt(value: string, purpose: string): string {
      // Validate purpose even for legacy values, whose old format did not authenticate it.
      associatedData(activeKeyId, purpose);
      try {
        if (value.startsWith(ENCRYPTION_PREFIX)) {
          if (!legacy) throw new Error("Missing legacy key");
          decodePayload(value.slice(ENCRYPTION_PREFIX.length));
          return decryptField(value, legacy);
        }
        const parts = value.split(":");
        if (parts.length !== 4 || parts[0] !== "enc" || parts[1] !== "v2")
          throw new Error("Invalid envelope");
        const id = parts[2] ?? "";
        const key = keys.get(id);
        if (!key) throw new Error("Missing retained key");
        const payload = decodePayload(parts[3] ?? "");
        const decipher = createDecipheriv("aes-256-gcm", key, payload.subarray(0, IV_LENGTH), {
          authTagLength: TAG_LENGTH,
        });
        decipher.setAAD(associatedData(id, purpose));
        decipher.setAuthTag(payload.subarray(payload.length - TAG_LENGTH));
        return Buffer.concat([
          decipher.update(payload.subarray(IV_LENGTH, payload.length - TAG_LENGTH)),
          decipher.final(),
        ]).toString("utf8");
      } catch {
        // Neither ciphertext, key IDs, key material nor native exception details enter errors.
        throw new Error("Unable to decrypt encrypted field.");
      }
    },
    lookup(normalizedValue: string): string {
      return hashLookupValue(normalizedValue, lookup);
    },
  });
}

export type { FieldEncryptionKeyring, FieldEncryptionKeyringOptions };
export { createFieldEncryptionKeyring };

interface ConfiguredFieldEncryption {
  readonly keyring: FieldEncryptionKeyring;
  readonly writeVersion: 1 | 2;
  encrypt(plaintext: string, purpose: string): string;
}
/** Stateless resolution keeps separately bundled auth entrypoints on the same configuration. */
function resolveFieldEncryptionKeyring(
  env: Record<string, string | undefined> = process.env,
): ConfiguredFieldEncryption | null {
  const raw = env.KMS_ENCRYPTION_KEYRING;
  if (raw === undefined) return null;
  try {
    if (!raw.trim() || raw.length > 16384 || env.KMS_ENCRYPTION_KEY?.trim())
      throw new Error("Invalid configuration");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("Invalid configuration");
    const config = parsed as Record<string, unknown>;
    if (
      Object.keys(config).some(
        (key) =>
          !["activeKeyId", "encryptionKeys", "legacyV1Key", "lookupKey", "writeVersion"].includes(
            key,
          ),
      )
    )
      throw new Error("Unknown option");
    if (
      typeof config.activeKeyId !== "string" ||
      (config.writeVersion !== 1 && config.writeVersion !== 2) ||
      !config.encryptionKeys ||
      typeof config.encryptionKeys !== "object" ||
      Array.isArray(config.encryptionKeys)
    )
      throw new Error("Invalid configuration");
    const decodeKey = (value: unknown): Buffer => {
      if (typeof value !== "string") throw new Error("Invalid key");
      if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, "hex");
      const decoded = Buffer.from(value, "base64");
      if (decoded.length !== 32 || decoded.toString("base64") !== value)
        throw new Error("Invalid key");
      return decoded;
    };
    const keys = Object.fromEntries(
      Object.entries(config.encryptionKeys).map(([id, value]) => [id, decodeKey(value)]),
    );
    const legacy = config.legacyV1Key === undefined ? undefined : decodeKey(config.legacyV1Key);
    const lookup = decodeKey(config.lookupKey);
    // Lookup-key migration is deliberately unsupported; existing v1 hashes must stay identical.
    if ((config.writeVersion === 1 && !legacy) || (legacy && !legacy.equals(lookup)))
      throw new Error("Incompatible lookup key");
    const keyring = createFieldEncryptionKeyring({
      activeKeyId: config.activeKeyId,
      encryptionKeys: keys,
      legacyV1Key: legacy,
      lookupKey: lookup,
    });
    const writeVersion = config.writeVersion;
    return Object.freeze({
      keyring,
      writeVersion,
      encrypt(plaintext: string, purpose: string): string {
        return writeVersion === 1 && legacy
          ? encryptField(plaintext, legacy)
          : keyring.encrypt(plaintext, purpose);
      },
    });
  } catch {
    throw new Error("Invalid KMS_ENCRYPTION_KEYRING configuration.");
  }
}

export type { ConfiguredFieldEncryption };
export { resolveFieldEncryptionKeyring };
