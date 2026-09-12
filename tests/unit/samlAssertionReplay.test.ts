import { afterEach, describe, expect, test } from "bun:test";
import {
  consumeSamlAssertion,
  InMemorySamlAssertionReplayStore,
  setSamlAssertionReplayStoreForTests,
} from "@getstrata/core/auth/saml/samlServiceProvider";
import {
  bindDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";

afterEach(() => {
  setSamlAssertionReplayStoreForTests(null);
  resetBoundDatabaseConnection();
});

describe("SAML assertion replay store", () => {
  test("memory store rejects a second consume of the same assertion", async () => {
    const store = new InMemorySamlAssertionReplayStore();
    await store.consume("assert-1");
    await expect(store.consume("assert-1")).rejects.toThrow("replay");
  });

  test("SQL store maps unique constraint errors to replay", async () => {
    const seen = new Set<string>();
    bindDatabaseConnection({
      async unsafe(_query: string, params: readonly unknown[] = []) {
        const id = String(params[0]);
        if (seen.has(id)) {
          throw { code: "23505" };
        }
        seen.add(id);
        return [];
      },
    } as never);
    setSamlAssertionReplayStoreForTests(null);
    await consumeSamlAssertion("assert-sql");
    await expect(consumeSamlAssertion("assert-sql")).rejects.toThrow("replay");
  });
});
