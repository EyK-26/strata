import { afterEach, describe, expect, test } from "bun:test";
import { protectEmail } from "@getstrata/core/crypto/fieldEncryption";
import {
  LOAD_WORKHUB_SESSION_USER_SQL,
  loadWorkhubSessionUser,
  mapWorkhubSessionUser,
} from "../../src/modules/user/loadWorkhubSessionUser";
import { restoreEnvVar } from "../helpers/restoreEnv";

const previousEncryptionKey = process.env.KMS_ENCRYPTION_KEY;
const previousFeatureFlag = process.env.FEATURE_FIELD_ENCRYPTION;

afterEach(() => {
  if (previousEncryptionKey === undefined) {
    delete process.env.KMS_ENCRYPTION_KEY;
  } else {
    restoreEnvVar("KMS_ENCRYPTION_KEY", previousEncryptionKey);
  }

  if (previousFeatureFlag === undefined) {
    delete process.env.FEATURE_FIELD_ENCRYPTION;
  } else {
    restoreEnvVar("FEATURE_FIELD_ENCRYPTION", previousFeatureFlag);
  }
});

type SessionRow = {
  id: number;
  name: string;
  email: string;
  role: string;
};

function createSql(rows: SessionRow[]) {
  return {
    lastQuery: "",
    lastParams: [] as readonly unknown[],
    async unsafe<T>(query: string, params: readonly unknown[] = []): Promise<T[]> {
      this.lastQuery = query;
      this.lastParams = params;
      return rows as T[];
    },
  };
}

describe("loadWorkhubSessionUser", () => {
  test("maps WorkHub admin role and decrypts stored email", async () => {
    process.env.KMS_ENCRYPTION_KEY = "a".repeat(64);
    process.env.FEATURE_FIELD_ENCRYPTION = "true";
    const stored = protectEmail("admin@workhub.test");
    const sql = createSql([
      {
        id: 1,
        name: "Admin User",
        email: stored.storedEmail,
        role: "admin",
      },
    ]);

    await expect(loadWorkhubSessionUser(sql, "session-1")).resolves.toEqual({
      id: 1,
      name: "Admin User",
      email: "admin@workhub.test",
      is_admin: true,
    });
    expect(sql.lastQuery).toBe(LOAD_WORKHUB_SESSION_USER_SQL);
    expect(sql.lastParams).toEqual(["session-1"]);
  });

  test("maps member role and leaves plaintext email unchanged", async () => {
    delete process.env.KMS_ENCRYPTION_KEY;
    process.env.FEATURE_FIELD_ENCRYPTION = "false";
    const sql = createSql([
      {
        id: 2,
        name: "Member User",
        email: "member@workhub.test",
        role: "member",
      },
    ]);

    await expect(loadWorkhubSessionUser(sql, "session-2")).resolves.toEqual({
      id: 2,
      name: "Member User",
      email: "member@workhub.test",
      is_admin: false,
    });
  });

  test("returns null when the session row is missing or expired", async () => {
    const sql = createSql([]);

    await expect(loadWorkhubSessionUser(sql, "missing")).resolves.toBeNull();
  });
});

describe("mapWorkhubSessionUser", () => {
  test("maps is_admin onto AuthUser.role", () => {
    expect(
      mapWorkhubSessionUser({
        id: 1,
        name: "Admin User",
        email: "admin@workhub.test",
        is_admin: true,
      }),
    ).toEqual({ id: 1, role: "admin" });
    expect(
      mapWorkhubSessionUser({
        id: 2,
        name: "Member User",
        email: "member@workhub.test",
        is_admin: false,
      }),
    ).toEqual({ id: 2, role: "member" });
  });
});
