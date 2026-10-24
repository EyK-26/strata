import { expect, test } from "bun:test";
import {
  commitOrRollbackScope,
  requestTransactionRollback,
  runWithTransactionScope,
  settleTransaction,
} from "../../src/core/database/transactionControl";

test("rollback requests without a frame are harmless and nested frames retain their own result", async () => {
  requestTransactionRollback();
  expect(await commitOrRollbackScope("outside")).toBe("outside");
  const result = await settleTransaction(() =>
    runWithTransactionScope(async () => {
      const nested = await settleTransaction(() =>
        runWithTransactionScope(async () => {
          requestTransactionRollback();
          return commitOrRollbackScope("nested");
        }),
      );
      expect(nested).toBe("nested");
      return commitOrRollbackScope("outer");
    }),
  );
  expect(result).toBe("outer");
});
